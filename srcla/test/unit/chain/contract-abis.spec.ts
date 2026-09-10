/**
 * The pure arithmetic and signature constants behind the collector's venue
 * reads. Every expectation here is a specific nonzero value computed by hand
 * from the protocol's own definition, not a restatement of the code.
 */
import { ethers } from 'ethers';
import {
  ADAPTER_IFACE,
  AAVE_POOL_IFACE,
  COMET_IFACE,
  MTOKEN_IFACE,
  REWARD_EXECUTOR_IFACE,
  VAULT_IFACE,
  WITHDRAW_TOPIC,
  aaveReserveIsBlocked,
  cometBorrowsFromUtilization,
  decodeAaveReserveFlags,
  utilizationWad,
} from '../../../src/chain/contract-abis.js';

const WAD = 10n ** 18n;

describe('utilizationWad', () => {
  it('matches the Compound-V2 definition borrows / (cash + borrows - reserves)', () => {
    // 700 borrowed, 300 liquid, 100 held as reserves ->
    // 700e6 * 1e18 / (300e6 + 700e6 - 100e6) = 0.7777... WAD
    expect(utilizationWad(300_000_000n, 700_000_000n, 100_000_000n)).toBe(777_777_777_777_777_777n);
  });

  it('reduces to borrows / (cash + borrows) when reserves are zero — the Aave V3 form', () => {
    // 800 borrowed against 200 available liquidity -> exactly 0.8
    expect(utilizationWad(200_000_000_000n, 800_000_000_000n, 0n)).toBe(800_000_000_000_000_000n);
  });

  it('is zero for an unborrowed market rather than dividing by the supply', () => {
    expect(utilizationWad(1_000_000n, 0n, 0n)).toBe(0n);
  });

  it('is zero, not negative or NaN, when reserves swallow the whole market', () => {
    expect(utilizationWad(10n, 5n, 15n)).toBe(0n);
    expect(utilizationWad(0n, 0n, 0n)).toBe(0n);
  });

  it('reaches full utilization when there is no cash left', () => {
    expect(utilizationWad(0n, 1_000_000n, 0n)).toBe(WAD);
  });

  it('reports above 100% for a drained market that still holds reserves, without clamping', () => {
    // Observed on Base at block 51,028,435: Moonwell mUSDC getCash() = 0,
    // totalBorrows() = 9,904,753.546257 USDC, totalReserves() = 55,931.682388.
    // The venues' own rate models do not clamp this, and clamping here would
    // make the most stressed possible venue state indistinguishable from an
    // ordinary fully-utilized one.
    expect(utilizationWad(0n, 9_904_753_546_257n, 55_931_682_388n)).toBe(1_005_679_022_644_646_337n);
    expect(utilizationWad(0n, 9_904_753_546_257n, 55_931_682_388n)).toBeGreaterThan(WAD);
  });
});

describe('cometBorrowsFromUtilization', () => {
  it("inverts Comet's own totalBorrow * 1e18 / totalSupply identity", () => {
    // 4,000,000 USDC supplied at 85% utilization -> 3,400,000 USDC borrowed
    expect(cometBorrowsFromUtilization(4_000_000_000_000n, 850_000_000_000_000_000n)).toBe(
      3_400_000_000_000n
    );
  });

  it('is zero for an empty or unborrowed market', () => {
    expect(cometBorrowsFromUtilization(0n, 850_000_000_000_000_000n)).toBe(0n);
    expect(cometBorrowsFromUtilization(4_000_000_000_000n, 0n)).toBe(0n);
  });
});

describe('decodeAaveReserveFlags / aaveReserveIsBlocked', () => {
  const bit = (n: bigint) => 1n << n;

  // E1b 2026-09-10: `decodeAaveReserveFlags` now also returns the reserve
  // factor from bits 64-79 of the same packed word, because the live
  // collector needs it as a rate-model input (it is the multiplicative term
  // in Aave's borrow -> supply conversion) and it is already in the word the
  // caller has read. The expected objects below gain that field; none of the
  // three flag assertions changed.
  it('reads active at bit 56, frozen at 57 and paused at 60 (AaveV3Adapter.sol:130-133)', () => {
    expect(decodeAaveReserveFlags(bit(56n))).toEqual({ active: true, frozen: false, paused: false, reserveFactorBps: 0 });
    expect(decodeAaveReserveFlags(bit(57n))).toEqual({ active: false, frozen: true, paused: false, reserveFactorBps: 0 });
    expect(decodeAaveReserveFlags(bit(60n))).toEqual({ active: false, frozen: false, paused: true, reserveFactorBps: 0 });
  });

  it('ignores the neighbouring configuration bits it does not own', () => {
    // bits 55, 58, 59 and 61 all set, none of the three flags
    const noise = bit(55n) | bit(58n) | bit(59n) | bit(61n);
    expect(decodeAaveReserveFlags(noise)).toEqual({ active: false, frozen: false, paused: false, reserveFactorBps: 0 });
  });

  it('reads the reserve factor from bits 64-79, independently of the flag bits', () => {
    // E1b: Base USDC's real reserve factor is 1000 bps (10%). Packed at bit
    // 64 alongside an active reserve, both must decode.
    const word = bit(56n) | (1000n << 64n);
    expect(decodeAaveReserveFlags(word)).toEqual({ active: true, frozen: false, paused: false, reserveFactorBps: 1000 });
    // A 16-bit field: bit 80 belongs to the borrow cap, not the reserve factor.
    expect(decodeAaveReserveFlags(bit(80n)).reserveFactorBps).toBe(0);
    expect(decodeAaveReserveFlags(0xffffn << 64n).reserveFactorBps).toBe(65535);
  });

  it('treats inactive and frozen reserves as blocked, exactly as maxDeployable does', () => {
    const rf = { reserveFactorBps: 1000 };
    expect(aaveReserveIsBlocked({ active: true, frozen: false, paused: false, ...rf })).toBe(false);
    expect(aaveReserveIsBlocked({ active: false, frozen: false, paused: false, ...rf })).toBe(true);
    expect(aaveReserveIsBlocked({ active: true, frozen: true, paused: false, ...rf })).toBe(true);
    expect(aaveReserveIsBlocked({ active: true, frozen: false, paused: true, ...rf })).toBe(true);
  });
});

describe('signatures pinned against contract/', () => {
  /**
   * These four selectors are copied from the `methodIdentifiers` map of the
   * compiled artifacts under contract/out. They are the exact calls that used
   * to be sent argument-stripped.
   */
  it.each([
    [VAULT_IFACE, 'getDependencyGroup', '0x0212c99f'],
    [VAULT_IFACE, 'strategyAssets', '0x1041cc64'],
    [REWARD_EXECUTOR_IFACE, 'getRoute', '0xe9207600'],
    [REWARD_EXECUTOR_IFACE, 'isRouteApproved', '0xaef92039'],
  ])('%#: selector matches the deployed artifact', (iface, fn, selector) => {
    expect((iface as ethers.Interface).getFunction(fn as string)!.selector).toBe(selector);
  });

  it('encodes arguments into the calldata instead of dropping them', () => {
    const adapter = '0x' + 'a1'.repeat(20);
    const data = VAULT_IFACE.encodeFunctionData('strategyAssets', [adapter]);
    // 4-byte selector + one 32-byte word = 36 bytes = 74 hex chars with 0x.
    expect(data).toHaveLength(74);
    expect(data.slice(0, 10)).toBe('0x1041cc64');
    // The old code produced exactly the 10-character selector of a function
    // that does not exist, with no argument at all.
    expect(data).not.toBe(ethers.id('strategyAssets()').slice(0, 10));
  });

  it('adapter/venue read fragments carry the deployed selectors', () => {
    expect(ADAPTER_IFACE.getFunction('supplyRatePerYear')!.selector).toBe('0x0e943796');
    expect(ADAPTER_IFACE.getFunction('comet')!.selector).toBe('0xba3e9c12');
    expect(ADAPTER_IFACE.getFunction('aToken')!.selector).toBe('0xa0c1f15e');
    expect(ADAPTER_IFACE.getFunction('aavePool')!.selector).toBe('0xa03e4bc3');
    expect(ADAPTER_IFACE.getFunction('mToken')!.selector).toBe('0xc3b6f939');
    expect(ADAPTER_IFACE.getFunction('isMintPaused')!.selector).toBe('0x15839b30');
    expect(AAVE_POOL_IFACE.getFunction('getReserveData')!.selector).toBe('0x35ea6a75');
    // IComet.getUtilization / isSupplyPaused (contract/src/interfaces/IComet.sol)
    expect(COMET_IFACE.getFunction('getUtilization')!.selector).toBe(
      ethers.id('getUtilization()').slice(0, 10)
    );
    expect(MTOKEN_IFACE.getFunction('getCash')!.selector).toBe(ethers.id('getCash()').slice(0, 10));
  });

  it('the Route struct is decoded by name, so routeDigest is not upperBound', () => {
    const route = REWARD_EXECUTOR_IFACE.getFunction('getRoute')!.outputs[0]!;
    const names = route.components!.map((c) => c.name);
    // Guard the two facts Item 3 turned on: routeDigest is LAST, and it is at
    // a different index than upperBound.
    expect(names.indexOf('routeDigest')).toBe(names.length - 1);
    expect(names.indexOf('upperBound')).not.toBe(names.indexOf('routeDigest'));
    // maxRewardFeedAge/maxUsdcFeedAge are the two fields srcla's cached
    // reward-executor.json is missing, and whose absence shifted the digest.
    expect(names).toContain('maxRewardFeedAge');
    expect(names).toContain('maxUsdcFeedAge');
  });
});

describe('WITHDRAW_TOPIC', () => {
  it('is the ERC-4626 Withdraw topic the vault actually emits', () => {
    expect(WITHDRAW_TOPIC).toBe(ethers.id('Withdraw(address,address,address,uint256,uint256)'));
  });

  it('is NOT the Withdrawal(address,uint256,uint256) topic srcla used to filter on', () => {
    // That event exists nowhere in contract/src; filtering on it matched zero
    // logs forever, so the §8.1 demand quantile Q_beta(W_H) was always 0.
    expect(WITHDRAW_TOPIC).not.toBe(ethers.id('Withdrawal(address,uint256,uint256)'));
  });
});
