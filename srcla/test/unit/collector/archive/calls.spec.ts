/**
 * Decoder tests against RAW BYTES the chain actually produced.
 *
 * The fixtures are the verbatim `aggregate3` `returnData` from Base at blocks
 * 19_300_000 (2024-09-03) and 35_338_178 (2025-09-10), captured once. That
 * matters: a test that re-encodes its expectation with the same `Interface`
 * the implementation decodes with proves self-consistency, not correctness --
 * it cannot catch a shared misunderstanding of the ABI. These assert against
 * values independently read off the chain and quoted in the assertions.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildOriginCalls,
  compoundSupplyRateWad,
  decodeAaveConfiguration,
  decodeOrigin,
  utilizationWad,
  MARKET_IDS,
  type ArchiveAddresses,
  type Multicall3Result,
} from '../../../../src/collector/archive/calls.js';

interface Fixture {
  blockNumber: number;
  blockHash: string;
  timestampSeconds: number;
  baseFeePerGasWei: string;
  addresses: ArchiveAddresses;
  results: Multicall3Result[];
}

const load = (block: number): Fixture =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'test/fixtures', `archive-origin-${block}.json`), 'utf8'),
  ) as Fixture;

const decode = (f: Fixture) =>
  decodeOrigin(f.addresses, buildOriginCalls(f.addresses, f.blockNumber), f.results, {
    blockNumber: f.blockNumber,
    blockHash: f.blockHash,
    timestampSeconds: f.timestampSeconds,
    baseFeePerGasWei: BigInt(f.baseFeePerGasWei),
  });

const OLD = load(19_300_000);
const NEW = load(35_338_178);

describe('decodeOrigin — venue state', () => {
  it('decodes all three registered venues with no failed leg at either block', () => {
    for (const f of [OLD, NEW]) {
      const out = decode(f);
      expect(out.failures).toEqual([]);
      expect(out.markets.map((m) => m.marketId).sort()).toEqual(
        [MARKET_IDS.aave, MARKET_IDS.compound, MARKET_IDS.moonwell].sort(),
      );
    }
  });

  it("reports Compound's utilization as Comet reports it, not recomputed", () => {
    // comet.getUtilization() at block 19_300_000, read directly.
    const c = decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.compound)!;
    expect(c.utilizationE18).toBe(591_542_423_036_707_633n);
  });

  it('decodes Moonwell cash, borrows and reserves in USDC base units', () => {
    // mUSDC.getCash()/totalBorrows()/totalReserves() at block 35_338_178.
    const m = decode(NEW).markets.find((x) => x.marketId === MARKET_IDS.moonwell)!;
    expect(m.cashBase).toBe(5_508_257_205_721n);
    expect(m.borrowsBase).toBe(45_227_849_763_779n);
    expect(m.reservesBase).toBe(481_854_950_069n);
  });

  it("uses Aave's exact variable debt rather than inferring it from aToken supply", () => {
    // variableDebtUSDC.totalSupply() at block 35_338_178.
    const a = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.aave)!;
    expect(a.borrowsBase).toBe(240_574_171_711_328n);
    expect(a.cashBase).toBe(64_747_532_922_868n); // USDC.balanceOf(aToken)
  });

  it('converts every venue to the same WAD-annualized rate scale', () => {
    // All three lending USDC in the same market at the same instant, so any
    // unit error shows up as an order-of-magnitude outlier rather than
    // needing an exact expected value.
    for (const f of [OLD, NEW]) {
      for (const m of decode(f).markets) {
        expect(m.supplyRateE18).toBeGreaterThan(5n * 10n ** 15n); // > 0.5% APY
        expect(m.supplyRateE18).toBeLessThan(2n * 10n ** 17n); // < 20% APY
      }
    }
  });
});

describe('decodeOrigin — IRM parameters (paper §6.3-6.5)', () => {
  it("reads Compound's real kink and slopes rather than DEFAULT_COMPOUND_CONFIG's placeholders", () => {
    const c = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.compound)!;
    // The chain says 90%. DEFAULT_COMPOUND_CONFIG asserts 80%.
    expect(c.irm!.kinkRay).toBe(900_000_000_000_000_000n * 10n ** 9n);
    // supplyPerSecondInterestRateSlopeLow = 1_141_552_511 at this block;
    // x 31_557_600 s/yr = 3.6021e16 WAD/yr, i.e. ~3.60% -- against the
    // placeholder's 6.25%. Reading it is not a refinement, it is the
    // difference between simulating this market and a fictional one.
    expect(c.irm!.slopeLowWad).toBe(1_141_552_511n * 31_557_600n);
    expect(c.irm!.baseRateWad).toBe(0n);
  });

  it("decodes Aave's V3.2 bps strategy at both blocks, with the observed values", () => {
    // getInterestRateDataBps(USDC): (9000, 0, 650, 6000) then (9000, 175, 625, 4000).
    const old = decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.aave)!;
    expect(old.irm!.baseRateWad).toBe(0n);
    expect(old.irm!.slopeLowWad).toBe((650n * 10n ** 18n) / 10_000n);
    expect(old.irm!.slopeHighWad).toBe((6000n * 10n ** 18n) / 10_000n);

    const now = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.aave)!;
    expect(now.irm!.baseRateWad).toBe((175n * 10n ** 18n) / 10_000n);
    expect(now.irm!.slopeLowWad).toBe((625n * 10n ** 18n) / 10_000n);
    expect(now.irm!.slopeHighWad).toBe((4000n * 10n ** 18n) / 10_000n);
  });

  it('records the rate-model address, which is NOT constant across the window', () => {
    // This is why resolveAddresses runs per chunk rather than once per run:
    // pinning one address would attribute one model's parameters to the
    // other model's blocks.
    const oldMw = decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.moonwell)!;
    const newMw = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.moonwell)!;
    expect(oldMw.irm!.address.toLowerCase()).toBe('0x54dc357f7461bceee5bdba80996f5cb7d7512445');
    expect(newMw.irm!.address.toLowerCase()).toBe('0x0f704fd3a00780779551046d492b1c64d15e6cab');
    expect(oldMw.irm!.address).not.toBe(newMw.irm!.address);

    const oldAave = decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.aave)!;
    const newAave = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.aave)!;
    expect(oldAave.irm!.address).not.toBe(newAave.irm!.address);
  });

  it('makes the config digest change when the rate model does, and not otherwise', () => {
    // §6.2 treats a regime AS a configuration digest and admit's
    // REGIME_MIN_HISTORY resets on change, so a digest derived from the whole
    // snapshot would make every origin its own regime and no venue would ever
    // accumulate history.
    const oldMw = decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.moonwell)!;
    const newMw = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.moonwell)!;
    expect(oldMw.configDigest).not.toBe(newMw.configDigest);
    expect(oldMw.configDigest).toContain('moonwell');
    // Same origin decoded twice is the same regime.
    expect(decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.moonwell)!.configDigest).toBe(
      oldMw.configDigest,
    );
  });
});

describe('decodeOrigin — measured execution cost (paper §9.1)', () => {
  it('takes the L2 base fee from the header, never from multicall3 getBasefee()', () => {
    // Under eth_call on OP-Stack the BASEFEE opcode reads 0. The headers
    // carry 3_869_277 and 714_160 wei. A zero would price L2 execution free
    // and the §9.1 gate would pass every candidate move.
    expect(decode(OLD).cost!.l2BaseFeeWei).toBe(3_869_277n);
    expect(decode(NEW).cost!.l2BaseFeeWei).toBe(714_160n);
    expect(decode(OLD).cost!.l2BaseFeeWei).toBeGreaterThan(0n);
  });

  it('reads both Chainlink feeds and the OP-Stack L1 fee parameters', () => {
    const cost = decode(NEW).cost!;
    expect(cost.ethUsdE8).toBe(428_896_010_000n); // $4288.96
    expect(cost.usdcUsdE8).toBe(99_981_794n); // $0.99982
    expect(cost.l1BaseFeeWei).toBe(151_566_405n);
    expect(cost.baseFeeScalar).toBe(2269);
    expect(cost.blobBaseFeeScalar).toBe(1_055_762);
    expect(cost.ethUsdRoundId).not.toBeNull();
  });
});

describe('decodeOrigin — failure handling', () => {
  it('OMITS a venue with a failed leg rather than emitting substituted zeros', () => {
    const calls = buildOriginCalls(NEW.addresses, NEW.blockNumber);
    const cashLeg = calls.findIndex((c) => c.key === 'moonwell.cash');
    expect(cashLeg).toBeGreaterThanOrEqual(0);

    const broken = NEW.results.map((r, i) =>
      i === cashLeg ? { success: false, returnData: '0x' } : r,
    );
    const out = decodeOrigin(NEW.addresses, calls, broken, {
      blockNumber: NEW.blockNumber,
      blockHash: NEW.blockHash,
      timestampSeconds: NEW.timestampSeconds,
      baseFeePerGasWei: BigInt(NEW.baseFeePerGasWei),
    });

    expect(out.failures).toContain('moonwell.cash');
    expect(out.markets.map((m) => m.marketId)).not.toContain(MARKET_IDS.moonwell);
    // The other two venues are unaffected -- one dead leg degrades its venue,
    // not the origin.
    expect(out.markets).toHaveLength(2);
  });

  it('reports a null cost rather than a free one when a feed is unreadable', () => {
    const calls = buildOriginCalls(NEW.addresses, NEW.blockNumber);
    const ethLeg = calls.findIndex((c) => c.key === 'cost.ethUsd');
    const broken = NEW.results.map((r, i) => (i === ethLeg ? { success: false, returnData: '0x' } : r));
    const out = decodeOrigin(NEW.addresses, calls, broken, {
      blockNumber: NEW.blockNumber,
      blockHash: NEW.blockHash,
      timestampSeconds: NEW.timestampSeconds,
      baseFeePerGasWei: BigInt(NEW.baseFeePerGasWei),
    });
    expect(out.cost).toBeNull();
    expect(out.failures).toContain('cost');
  });

  it('throws when the result count does not match the call count', () => {
    const calls = buildOriginCalls(NEW.addresses, NEW.blockNumber);
    expect(() =>
      decodeOrigin(NEW.addresses, calls, NEW.results.slice(0, 5), {
        blockNumber: NEW.blockNumber,
        blockHash: NEW.blockHash,
        timestampSeconds: NEW.timestampSeconds,
        baseFeePerGasWei: 1n,
      }),
    ).toThrow(/results for/i);
  });
});

describe('cometSupplyRatePerSecond', () => {
  it("reproduces Comet's own getSupplyRate EXACTLY at both probe blocks", () => {
    // comet.getSupplyRate(getUtilization()) read directly from chain:
    //   block 19_300_000 -> 975_399_733 per second
    //   block 35_338_178 -> 1_443_495_598 per second
    // The kinked model must reproduce those, because the batch cannot call
    // getSupplyRate (its argument is fetched by the same batch).
    const SPY = 31_557_600n;
    const old = decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.compound)!;
    const now = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.compound)!;
    expect(old.supplyRateE18).toBe(975_399_733n * SPY);
    expect(now.supplyRateE18).toBe(1_443_495_598n * SPY);
  });

  it('is why the decoder does NOT annualize the slopes first', () => {
    // Annualizing before applying utilization skips Comet's truncation to an
    // integer wei-per-second, and the year then scales that error up 31.5
    // million times. The two forms must therefore DISAGREE here -- if they
    // ever stop disagreeing, one of them has been changed.
    const c = decode(OLD).markets.find((m) => m.marketId === MARKET_IDS.compound)!;
    const annualizedFirst = compoundSupplyRateWad(c.irm!, c.utilizationE18);
    expect(annualizedFirst).not.toBe(c.supplyRateE18);
    // ...but only in the last ~9 significant figures, so the annualized form
    // remains safe to reason with.
    const relativeError =
      Number(annualizedFirst > c.supplyRateE18 ? annualizedFirst - c.supplyRateE18 : c.supplyRateE18 - annualizedFirst) /
      Number(c.supplyRateE18);
    expect(relativeError).toBeLessThan(1e-8);
  });

  it('is continuous at the kink', () => {
    const irm = {
      address: '0x0',
      baseRateWad: 10n ** 16n,
      kinkRay: 9n * 10n ** 26n,
      slopeLowWad: 4n * 10n ** 16n,
      slopeHighWad: 3n * 10n ** 18n,
    };
    const kinkWad = irm.kinkRay / 10n ** 9n;
    expect(compoundSupplyRateWad(irm, kinkWad)).toBe(compoundSupplyRateWad(irm, kinkWad));
    expect(compoundSupplyRateWad(irm, kinkWad + 1n)).toBeGreaterThan(
      compoundSupplyRateWad(irm, kinkWad),
    );
  });

  it('rises steeply above the kink, which is what makes capacity bind', () => {
    const irm = {
      address: '0x0',
      baseRateWad: 0n,
      kinkRay: 9n * 10n ** 26n,
      slopeLowWad: 4n * 10n ** 16n,
      slopeHighWad: 3n * 10n ** 18n,
    };
    const below = compoundSupplyRateWad(irm, 8n * 10n ** 17n);
    const above = compoundSupplyRateWad(irm, 95n * 10n ** 16n);
    expect(above).toBeGreaterThan(below * 3n);
  });
});

describe('utilizationWad', () => {
  it('nets reserves out of the denominator', () => {
    expect(utilizationWad(100n, 100n, 0n)).toBe(5n * 10n ** 17n);
    expect(utilizationWad(100n, 100n, 100n)).toBe(10n ** 18n);
  });

  it('returns 0 for an empty market rather than dividing by zero', () => {
    expect(utilizationWad(0n, 0n, 0n)).toBe(0n);
    expect(utilizationWad(0n, 0n, 10n)).toBe(0n);
  });
});

describe('decodeAaveConfiguration', () => {
  it('decodes the flag bits and the reserve factor from the real bitmap', () => {
    // The USDC reserve at block 35_338_178 is active, unfrozen, unpaused,
    // with a 10% reserve factor -- matching the decoded reserveFactorBps.
    const a = decode(NEW).markets.find((m) => m.marketId === MARKET_IDS.aave)!;
    expect(a.paused).toBe(false);
    expect(a.reserveFactorBps).toBe(1000);
  });

  it('treats frozen and inactive as blocking, exactly as paused is', () => {
    // AaveV3Adapter.maxDeployable rejects all three identically.
    const active = 1n << 56n;
    expect(decodeAaveConfiguration(active).active).toBe(true);
    expect(decodeAaveConfiguration(active | (1n << 57n)).frozen).toBe(true);
    expect(decodeAaveConfiguration(active | (1n << 60n)).paused).toBe(true);
    expect(decodeAaveConfiguration(active | (1000n << 64n)).reserveFactorBps).toBe(1000);
  });
});
