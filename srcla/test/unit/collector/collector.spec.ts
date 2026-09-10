import { ethers } from 'ethers';
import { SnapshotCollector } from '../../../src/collector/snapshot-collector.js';
import { CollectorConfig, type VaultSnapshot, type CollectedSnapshot } from '../../../src/collector/types.js';
import {
  ADAPTER_IFACE,
  AAVE_POOL_IFACE,
  AAVE_STRATEGY_V32_IFACE,
  COMET_IFACE,
  ERC20_IFACE,
  MOONWELL_IRM_IFACE,
  MTOKEN_IFACE,
  REWARD_EXECUTOR_IFACE,
  VAULT_IFACE,
} from '../../../src/chain/contract-abis.js';
import type { ChainClient } from '../../../src/chain/client.js';

/**
 * A ChainClient stand-in that answers `eth_call` from an explicit routing
 * table keyed on the FULL calldata — selector *and* encoded arguments.
 *
 * That keying is deliberate and is what gives these tests their teeth. The
 * collector used to build calldata as `ethers.id(name + '()').slice(0, 10)`,
 * dropping every argument, so `strategyAssets(0xabc…)` went out as a bare
 * 4-byte selector for a nonexistent `strategyAssets()`. Against a table keyed
 * on full calldata that lands on no route and throws, exactly as the real
 * chain reverts — so a regression to the old encoding fails the test instead
 * of quietly returning a plausible zero.
 */

class FakeChain {
  private routes = new Map<string, string>();
  /** Every (address, calldata) pair the collector actually asked for. */
  readonly seen: Array<{ to: string; data: string }> = [];
  /** Addresses whose every call should revert, simulating an unreachable venue. */
  private reverting = new Set<string>();

  private static key(to: string, data: string): string {
    return `${to.toLowerCase()}|${data.toLowerCase()}`;
  }

  /** Register the return value of `iface.fn(...args)` at `address`. */
  on(
    iface: ethers.Interface,
    address: string,
    fn: string,
    args: ReadonlyArray<unknown>,
    values: ReadonlyArray<unknown>
  ): this {
    const data = iface.encodeFunctionData(fn, args as unknown[]);
    this.routes.set(FakeChain.key(address, data), iface.encodeFunctionResult(fn, values as unknown[]));
    return this;
  }

  /** Make every call to `address` revert. */
  revertAll(address: string): this {
    this.reverting.add(address.toLowerCase());
    return this;
  }

  async call(to: string, data: string): Promise<string> {
    this.seen.push({ to, data });
    if (this.reverting.has(to.toLowerCase())) {
      throw new Error(`execution reverted at ${to}`);
    }
    const hit = this.routes.get(FakeChain.key(to, data));
    if (hit === undefined) {
      throw new Error(`unstubbed eth_call: ${to} ${data}`);
    }
    return hit;
  }

  /**
   * `blockNumber` is the finalized head; `nativeBalance` is what
   * `eth_getBalance` would report for any address (deliberately a wei-scale
   * figure, so a snapshot field that mistakenly reads it is unmistakable).
   */
  asChainClient(opts?: {
    blockNumber?: number;
    blockHash?: string;
    timestamp?: number;
    nativeBalance?: bigint;
  }): ChainClient {
    const blockNumber = opts?.blockNumber ?? 100;
    const client = {
      chainId: 8453,
      getFinalizedBlock: async () => ({
        number: blockNumber,
        hash: opts?.blockHash ?? '0x' + 'aa'.repeat(32),
        timestamp: opts?.timestamp ?? 1_000_000,
      }),
      getBlockNumber: async () => blockNumber,
      getBalance: async () => opts?.nativeBalance ?? 7_000_000_000_000_000_000n,
      call: (to: string, data: string) => this.call(to, data),
    };
    return client as unknown as ChainClient;
  }
}

/**
 * Build an Aave `ReserveConfigurationMap.data` word with the three flag bits
 * AaveV3Adapter.sol:130-133 reads: bit 56 active, bit 57 frozen, bit 60 paused.
 */
function aaveConfigWord(flags: {
  active?: boolean;
  frozen?: boolean;
  paused?: boolean;
  /** Bits 64-79. E1b: a rate-model input, not a flag -- see decodeAaveReserveFlags. */
  reserveFactorBps?: number;
}): bigint {
  let word = 0n;
  if (flags.active) word |= 1n << 56n;
  if (flags.frozen) word |= 1n << 57n;
  if (flags.paused) word |= 1n << 60n;
  word |= BigInt(flags.reserveFactorBps ?? 0) << 64n;
  return word;
}

/**
 * The 15-field `IAaveV3Pool.ReserveData` tuple, with only the fields the
 * collector reads made meaningful.
 */
function aaveReserveData(
  configWord: bigint,
  variableDebtToken: string,
  // E1b: the collector now reaches through to the rate strategy for the
  // venue's live IRM parameters, so this field can no longer be a zero
  // address in a fixture that expects a reading.
  interestRateStrategy: string = ethers.ZeroAddress,
): unknown[] {
  return [
    [configWord], // configuration
    0n, // liquidityIndex
    0n, // currentLiquidityRate
    0n, // variableBorrowIndex
    0n, // currentVariableBorrowRate
    0n, // currentStableBorrowRate
    0n, // lastUpdateTimestamp
    0, // id
    ethers.ZeroAddress, // aTokenAddress
    ethers.ZeroAddress, // stableDebtTokenAddress
    variableDebtToken,
    interestRateStrategy,
    0n, // accruedToTreasury
    0n, // unbacked
    0n, // isolationModeTotalDebt
  ];
}

describe('SnapshotCollector', () => {
  const mockConfig: CollectorConfig = {
    vaultAddress: '0x0000000000000000000000000000000000000001',
    strategyAddresses: {
      aave: '0x0000000000000000000000000000000000000002',
      compound: '0x0000000000000000000000000000000000000003',
      moonwell: '0x0000000000000000000000000000000000000004',
    },
    usdcAddress: '0x0000000000000000000000000000000000000005',
    rewardAccountantAddress: '0x0000000000000000000000000000000000000006',
    rewardExecutorAddress: '0x0000000000000000000000000000000000000007',
  };

  it('should create collector with config', () => {
    const client = { chainId: 8453 } as any;
    const collector = new SnapshotCollector(client as any, mockConfig);
    expect(collector).toBeDefined();
  });

  it('should have collect method', () => {
    const client = { chainId: 8453 } as any;
    const collector = new SnapshotCollector(client as any, mockConfig);
    expect(typeof collector.collect).toBe('function');
  });
});

describe('CollectorConfig', () => {
  it('should require vault address', () => {
    expect(() => {
      const config: CollectorConfig = {
        vaultAddress: '',
        strategyAddresses: { aave: '', compound: '', moonwell: '' },
        usdcAddress: '',
        rewardAccountantAddress: '',
        rewardExecutorAddress: '',
      };
      void config;
    }).not.toThrow();
  });
});

describe('VaultSnapshot - Extended Fields', () => {
  it('should include absolute caps fields', () => {
    const snapshot: VaultSnapshot = {
      totalAssets: 10_000_000_000_000n,
      synchronousLiquidity: 9_500_000_000_000n,
      idleBase: 500_000_000_000n,
      minIdleBps: 100n,
      paused: false,
      // Extended fields from production vault
      absoluteCaps: {
        totalCap: 100_000_000_000_000n,
        perUserCap: 1_000_000_000_000n,
        minDeposit: 10_000_000n, // 10 USDC
      },
      groups: [
        { id: 'compound-group', exposure: 5_000_000_000_000n, cap: 10_000_000_000_000n },
        { id: 'aave-group', exposure: 4_500_000_000_000n, cap: 8_000_000_000_000n },
      ],
      reserve: {
        admin: 100_000_000_000n,
        dynamic: 400_000_000_000n,
      },
      rewardCacheTimestamp: 1_000_000_000n,
      rewardCacheValue: 50_000_000_000n,
      rewardReady: true,
      rewardPolicyDigest: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      routeDigest: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      routeStatus: 'active',
      sequencerRound: 1_000_000n,
      feedRounds: [
        { feed: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', round: 999_999n, staleness: false },
      ],
    };

    expect(snapshot.absoluteCaps?.totalCap).toBe(100_000_000_000_000n);
    expect(snapshot.absoluteCaps?.perUserCap).toBe(1_000_000_000_000n);
    expect(snapshot.absoluteCaps?.minDeposit).toBe(10_000_000n);
    expect(snapshot.groups).toHaveLength(2);
    expect(snapshot.groups?.[0]?.id).toBe('compound-group');
    expect(snapshot.groups?.[0]?.exposure).toBe(5_000_000_000_000n);
    expect(snapshot.groups?.[0]?.cap).toBe(10_000_000_000_000n);
    expect(snapshot.reserve?.admin).toBe(100_000_000_000n);
    expect(snapshot.reserve?.dynamic).toBe(400_000_000_000n);
    expect(snapshot.rewardCacheTimestamp).toBe(1_000_000_000n);
    expect(snapshot.rewardCacheValue).toBe(50_000_000_000n);
    expect(snapshot.rewardReady).toBe(true);
    expect(snapshot.rewardPolicyDigest).toBeDefined();
    expect(snapshot.routeDigest).toBeDefined();
    expect(snapshot.routeStatus).toBe('active');
    expect(snapshot.sequencerRound).toBe(1_000_000n);
    expect(snapshot.feedRounds).toHaveLength(1);
    expect(snapshot.feedRounds?.[0]?.staleness).toBe(false);
  });

  it('should support route status values', () => {
    const statuses: ('active' | 'inactive' | 'stale')[] = ['active', 'inactive', 'stale'];
    for (const status of statuses) {
      const snapshot: VaultSnapshot = {
        totalAssets: 0n,
        synchronousLiquidity: 0n,
        idleBase: 0n,
        minIdleBps: 0n,
        paused: false,
        reserve: { admin: 0n, dynamic: 0n },
        routeStatus: status,
      };
      expect(snapshot.routeStatus).toBe(status);
    }
  });

  it('should track staleness in feed rounds', () => {
    const snapshot: VaultSnapshot = {
      totalAssets: 0n,
      synchronousLiquidity: 0n,
      idleBase: 0n,
      minIdleBps: 0n,
      paused: false,
      reserve: { admin: 0n, dynamic: 0n },
      feedRounds: [
        { feed: '0x1111', round: 100n, staleness: false },
        { feed: '0x2222', round: 50n, staleness: true }, // stale feed
      ],
    };
    expect(snapshot.feedRounds?.[0]?.staleness).toBe(false);
    expect(snapshot.feedRounds?.[1]?.staleness).toBe(true);
  });
});

describe('CollectedSnapshot - Full Production Snapshot', () => {
  it('should include all production vault fields', () => {
    const snapshot: CollectedSnapshot = {
      blockNumber: 12345678,
      blockHash: '0xabc123def456',
      timestamp: new Date(),
      vault: {
        totalAssets: 10_000_000_000_000n,
        synchronousLiquidity: 9_500_000_000_000n,
        idleBase: 500_000_000_000n,
        minIdleBps: 100n,
        paused: false,
        absoluteCaps: {
          totalCap: 100_000_000_000_000n,
          perUserCap: 1_000_000_000_000n,
          minDeposit: 10_000_000n,
        },
        groups: [
          { id: 'defi-blue', exposure: 8_000_000_000_000n, cap: 15_000_000_000_000n },
        ],
        reserve: {
          admin: 100_000_000_000n,
          dynamic: 400_000_000_000n,
        },
        rewardCacheTimestamp: 1_000_000_000n,
        rewardCacheValue: 50_000_000_000n,
        rewardReady: true,
        rewardPolicyDigest: '0xdigest123',
        routeDigest: '0xroute456',
        routeStatus: 'active',
        sequencerRound: 1_000_000n,
        feedRounds: [
          { feed: '0xfeed123', round: 999n, staleness: false },
        ],
      },
      strategies: [],
      incomplete: false,
      missingMarkets: [],
    };

    expect(snapshot.vault.absoluteCaps).toBeDefined();
    expect(snapshot.vault.groups).toBeDefined();
    expect(snapshot.vault.reserve).toBeDefined();
    expect(snapshot.vault.rewardCacheTimestamp).toBeDefined();
    expect(snapshot.vault.rewardReady).toBeDefined();
    expect(snapshot.vault.routeStatus).toBeDefined();
    expect(snapshot.vault.sequencerRound).toBeDefined();
  });
});


/* -------------------------------------------------------------------------
 * End-to-end collection against an ABI-encoding fake chain.
 *
 * Everything below exists because `collectStrategy` used to return
 *   supplyRate: 0n, utilization: 0n, cash: 0n, paused: false
 * for every venue, and because every argument-taking call sent the selector
 * of a nonexistent zero-argument function. The fixtures therefore use
 * distinct nonzero values throughout: a test that would still pass with the
 * old hardcoded zeros is worth nothing.
 * ---------------------------------------------------------------------- */

const VAULT = '0x' + '11'.repeat(20);
const AAVE_ADAPTER = '0x' + '22'.repeat(20);
const COMPOUND_ADAPTER = '0x' + '33'.repeat(20);
const MOONWELL_ADAPTER = '0x' + '44'.repeat(20);
const USDC = '0x' + '55'.repeat(20);
const COMET = '0x' + '66'.repeat(20);
const ATOKEN = '0x' + '77'.repeat(20);
const AAVE_POOL = '0x' + '88'.repeat(20);
const VARIABLE_DEBT = '0x' + '99'.repeat(20);
const MTOKEN = '0x' + 'ab'.repeat(20);
const MOONWELL_IRM = '0x' + 'be'.repeat(20);
const AAVE_STRATEGY = '0x' + 'ef'.repeat(20);
const EXECUTOR = '0x' + 'cd'.repeat(20);

const AAVE_DIGEST = '0x' + 'a1'.repeat(32);
const COMPOUND_DIGEST = '0x' + 'c2'.repeat(32);
const MOONWELL_DIGEST = '0x' + 'd3'.repeat(32);

/** Vault core state, with every value distinct so a mixed-up read is visible. */
function stubVaultCore(chain: FakeChain, over: Partial<Record<string, unknown>> = {}): FakeChain {
  chain
    .on(VAULT_IFACE, VAULT, 'totalAssets', [], [over.totalAssets ?? 10_000_000_000_000n])
    .on(VAULT_IFACE, VAULT, 'synchronousLiquidity', [], [9_000_000_000_000n])
    .on(VAULT_IFACE, VAULT, 'minIdleBps', [], [100n])
    .on(VAULT_IFACE, VAULT, 'paused', [], [over.paused ?? false])
    .on(VAULT_IFACE, VAULT, 'adminReserve', [], [over.adminReserve ?? 123_000_000_000n])
    .on(VAULT_IFACE, VAULT, 'dynamicReserve', [], [over.dynamicReserve ?? 456_000_000_000n])
    .on(ERC20_IFACE, USDC, 'balanceOf', [VAULT], [over.idle ?? 250_000_000n]);
  return chain;
}

/** Compound: 4,000,000 USDC supplied at 85% utilization, 600,000 liquid, supply paused. */
function stubCompound(chain: FakeChain, withIrm = true): FakeChain {
  chain
    .on(ADAPTER_IFACE, COMPOUND_ADAPTER, 'totalAssets', [], [1_000_000_000n])
    .on(ADAPTER_IFACE, COMPOUND_ADAPTER, 'maxWithdrawable', [], [900_000_000n])
    .on(ADAPTER_IFACE, COMPOUND_ADAPTER, 'maxDeployable', [], [115792089237316195423570985008687907853269984665640564039457584007913129639935n])
    .on(ADAPTER_IFACE, COMPOUND_ADAPTER, 'configurationDigest', [], [COMPOUND_DIGEST])
    .on(ADAPTER_IFACE, COMPOUND_ADAPTER, 'supplyRatePerYear', [], [52_000_000_000_000_000n])
    .on(ADAPTER_IFACE, COMPOUND_ADAPTER, 'comet', [], [COMET])
    .on(COMET_IFACE, COMET, 'getUtilization', [], [850_000_000_000_000_000n])
    .on(ERC20_IFACE, COMET, 'totalSupply', [], [4_000_000_000_000n])
    .on(ERC20_IFACE, USDC, 'balanceOf', [COMET], [600_000_000_000n])
    .on(COMET_IFACE, COMET, 'isSupplyPaused', [], [true]);
  if (withIrm) stubCompoundIrm(chain);
  return chain;
}

/**
 * Comet's SUPPLY-side rate model, PER SECOND at WAD scale — the four getters
 * `getSupplyRate` is built from. Values are Base mainnet Comet USDC's at
 * archive block 28,359,726, divided back to per-second from the annualized
 * figures the archive stores (kink 90%, slopeLow ~5.40%/yr, slopeHigh
 * ~303.6%/yr).
 */
function stubCompoundIrm(chain: FakeChain): FakeChain {
  return chain
    .on(COMET_IFACE, COMET, 'supplyKink', [], [900_000_000_000_000_000n])
    .on(COMET_IFACE, COMET, 'supplyPerSecondInterestRateBase', [], [0n])
    .on(COMET_IFACE, COMET, 'supplyPerSecondInterestRateSlopeLow', [], [1_712_328_767n])
    .on(COMET_IFACE, COMET, 'supplyPerSecondInterestRateSlopeHigh', [], [96_207_020_547n]);
}

/** Aave: 800,000 borrowed against 200,000 liquid; reserve active and healthy. */
function stubAave(
  chain: FakeChain,
  configWord = aaveConfigWord({ active: true, reserveFactorBps: 1000 }),
  withIrm = true,
): FakeChain {
  chain
    .on(ADAPTER_IFACE, AAVE_ADAPTER, 'totalAssets', [], [2_000_000_000n])
    .on(ADAPTER_IFACE, AAVE_ADAPTER, 'maxWithdrawable', [], [1_800_000_000n])
    .on(ADAPTER_IFACE, AAVE_ADAPTER, 'maxDeployable', [], [5_000_000_000_000n])
    .on(ADAPTER_IFACE, AAVE_ADAPTER, 'configurationDigest', [], [AAVE_DIGEST])
    .on(ADAPTER_IFACE, AAVE_ADAPTER, 'supplyRatePerYear', [], [41_000_000_000_000_000n])
    .on(ADAPTER_IFACE, AAVE_ADAPTER, 'aToken', [], [ATOKEN])
    .on(ADAPTER_IFACE, AAVE_ADAPTER, 'aavePool', [], [AAVE_POOL])
    .on(ERC20_IFACE, USDC, 'balanceOf', [ATOKEN], [200_000_000_000n])
    .on(AAVE_POOL_IFACE, AAVE_POOL, 'getReserveData', [USDC], [
      aaveReserveData(configWord, VARIABLE_DEBT, AAVE_STRATEGY),
    ])
    .on(ERC20_IFACE, VARIABLE_DEBT, 'totalSupply', [], [800_000_000_000n]);
  if (withIrm) {
    // Aave V3.2's packed bps getter: optimal 90%, base 0, slope1 4.7%,
    // slope2 10% — Base USDC's live values.
    chain.on(AAVE_STRATEGY_V32_IFACE, AAVE_STRATEGY, 'getInterestRateDataBps', [USDC], [
      [9000, 0, 470, 1000],
    ]);
  }
  return chain;
}

/** Moonwell: cash 300, borrows 700, reserves 100 (base units x1e6). */
function stubMoonwell(chain: FakeChain, mintPaused = false, withIrm = true): FakeChain {
  chain
    .on(ADAPTER_IFACE, MOONWELL_ADAPTER, 'totalAssets', [], [3_000_000_000n])
    .on(ADAPTER_IFACE, MOONWELL_ADAPTER, 'maxWithdrawable', [], [2_700_000_000n])
    .on(ADAPTER_IFACE, MOONWELL_ADAPTER, 'maxDeployable', [], [7_000_000_000_000n])
    .on(ADAPTER_IFACE, MOONWELL_ADAPTER, 'configurationDigest', [], [MOONWELL_DIGEST])
    .on(ADAPTER_IFACE, MOONWELL_ADAPTER, 'supplyRatePerYear', [], [33_000_000_000_000_000n])
    .on(ADAPTER_IFACE, MOONWELL_ADAPTER, 'mToken', [], [MTOKEN])
    .on(ADAPTER_IFACE, MOONWELL_ADAPTER, 'isMintPaused', [], [mintPaused])
    .on(MTOKEN_IFACE, MTOKEN, 'getCash', [], [300_000_000n])
    .on(MTOKEN_IFACE, MTOKEN, 'totalBorrows', [], [700_000_000n])
    .on(MTOKEN_IFACE, MTOKEN, 'totalReserves', [], [100_000_000n]);
  if (withIrm) {
    // mUSDC's JumpRateModel: a BORROW curve, per timestamp, plus the reserve
    // cut. Values are Base mUSDC's at archive block 16,659,726 (kink 90%,
    // multiplier ~6.10%/yr, jumpMultiplier ~900.6%/yr, reserve factor 15%).
    chain
      .on(MTOKEN_IFACE, MTOKEN, 'interestRateModel', [], [MOONWELL_IRM])
      .on(MTOKEN_IFACE, MTOKEN, 'reserveFactorMantissa', [], [150_000_000_000_000_000n])
      .on(MOONWELL_IRM_IFACE, MOONWELL_IRM, 'kink', [], [900_000_000_000_000_000n])
      .on(MOONWELL_IRM_IFACE, MOONWELL_IRM, 'baseRatePerTimestamp', [], [0n])
      .on(MOONWELL_IRM_IFACE, MOONWELL_IRM, 'multiplierPerTimestamp', [], [1_934_302_557n])
      .on(MOONWELL_IRM_IFACE, MOONWELL_IRM, 'jumpMultiplierPerTimestamp', [], [285_400_000_000n]);
  }
  return chain;
}

const FULL_CONFIG: CollectorConfig = {
  vaultAddress: VAULT,
  strategyAddresses: { aave: AAVE_ADAPTER, compound: COMPOUND_ADAPTER, moonwell: MOONWELL_ADAPTER },
  usdcAddress: USDC,
};

function fullChain(): FakeChain {
  const chain = new FakeChain();
  stubVaultCore(chain);
  stubAave(chain);
  stubCompound(chain);
  stubMoonwell(chain);
  return chain;
}

describe('SnapshotCollector.collect — vault core', () => {
  it('populates vault.reserve from adminReserve()/dynamicReserve() with no reward contracts configured', async () => {
    // Production (src/index.ts) wires neither reward address; the reserve must
    // not be gated behind them (whole-branch review, HIGH 5).
    const snap = await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect();
    expect(snap?.vault.reserve).toEqual({ admin: 123_000_000_000n, dynamic: 456_000_000_000n });
  });

  it('reports a genuinely zero on-chain reserve as zero, not as "not collected"', async () => {
    const chain = new FakeChain();
    stubVaultCore(chain, { adminReserve: 0n, dynamicReserve: 0n });
    stubAave(chain);
    stubCompound(chain);
    stubMoonwell(chain);
    const snap = await new SnapshotCollector(chain.asChainClient(), FULL_CONFIG).collect();
    expect(snap?.vault.reserve).toEqual({ admin: 0n, dynamic: 0n });
  });

  it('reads idleBase as the vault USDC balance, never eth_getBalance', async () => {
    // The fake reports 7 ETH (7e18 wei) for eth_getBalance and 250 USDC for
    // the ERC-20 balance. Before this fix `idleBase` was
    // ChainClient.getBalance(vault) -- native ETH, in wei -- fed straight into
    // DecisionInput.vault.idleBase as if it were 6-decimal USDC.
    const chain = fullChain();
    const snap = await new SnapshotCollector(
      chain.asChainClient({ nativeBalance: 7_000_000_000_000_000_000n }),
      FULL_CONFIG
    ).collect();
    expect(snap?.vault.idleBase).toBe(250_000_000n);
    expect(snap?.vault.idleBase).not.toBe(7_000_000_000_000_000_000n);
  });

  it('decodes the vault pause flag as a bool', async () => {
    const chain = new FakeChain();
    stubVaultCore(chain, { paused: true });
    stubAave(chain);
    stubCompound(chain);
    stubMoonwell(chain);
    const snap = await new SnapshotCollector(chain.asChainClient(), FULL_CONFIG).collect();
    expect(snap?.vault.paused).toBe(true);
  });
});

describe('SnapshotCollector.collect — per-venue market state', () => {
  it('reads Compound rate, utilization, cash, borrows and pause state off Comet', async () => {
    const snap = await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect();
    const compound = snap!.strategies.find((s) => s.name === 'Compound')!;

    expect(compound.supplyRate).toBe(52_000_000_000_000_000n); // 5.2% APY, WAD
    expect(compound.utilization).toBe(850_000_000_000_000_000n); // Comet's own figure
    expect(compound.cash).toBe(600_000_000_000n); // USDC held by the Comet
    // totalSupply 4,000,000 x 0.85 -> 3,400,000 borrowed
    expect(compound.borrows).toBe(3_400_000_000_000n);
    expect(compound.paused).toBe(true); // comet.isSupplyPaused()
    expect(compound.configDigest).toBe(COMPOUND_DIGEST);
  });

  it('reads Aave cash from the aToken and borrows from the variable debt token', async () => {
    const snap = await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect();
    const aave = snap!.strategies.find((s) => s.name === 'Aave')!;

    expect(aave.supplyRate).toBe(41_000_000_000_000_000n);
    expect(aave.cash).toBe(200_000_000_000n);
    expect(aave.borrows).toBe(800_000_000_000n);
    // 800 / (200 + 800) = 0.8
    expect(aave.utilization).toBe(800_000_000_000_000_000n);
    expect(aave.paused).toBe(false);
  });

  it.each([
    ['frozen', aaveConfigWord({ active: true, frozen: true })],
    ['paused', aaveConfigWord({ active: true, paused: true })],
    ['inactive', aaveConfigWord({})],
  ])('marks an Aave reserve that is %s as paused', async (_label, configWord) => {
    const chain = new FakeChain();
    stubVaultCore(chain);
    stubAave(chain, configWord);
    stubCompound(chain);
    stubMoonwell(chain);
    const snap = await new SnapshotCollector(chain.asChainClient(), FULL_CONFIG).collect();
    expect(snap!.strategies.find((s) => s.name === 'Aave')!.paused).toBe(true);
  });

  it('reads the Moonwell cash/borrows/reserves triple its own rate model uses', async () => {
    const snap = await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect();
    const moonwell = snap!.strategies.find((s) => s.name === 'Moonwell')!;

    expect(moonwell.supplyRate).toBe(33_000_000_000_000_000n);
    expect(moonwell.cash).toBe(300_000_000n);
    expect(moonwell.borrows).toBe(700_000_000n);
    expect(moonwell.reserves).toBe(100_000_000n);
    // 700 / (300 + 700 - 100)
    expect(moonwell.utilization).toBe(777_777_777_777_777_777n);
    expect(moonwell.paused).toBe(false);
  });

  it('propagates a Moonwell mint pause', async () => {
    const chain = new FakeChain();
    stubVaultCore(chain);
    stubAave(chain);
    stubCompound(chain);
    stubMoonwell(chain, true);
    const snap = await new SnapshotCollector(chain.asChainClient(), FULL_CONFIG).collect();
    expect(snap!.strategies.find((s) => s.name === 'Moonwell')!.paused).toBe(true);
  });

  it('never reports the old hardcoded zeros for a venue that answered', async () => {
    const snap = await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect();
    expect(snap!.strategies).toHaveLength(3);
    for (const s of snap!.strategies) {
      expect(s.supplyRate).toBeGreaterThan(0n);
      expect(s.utilization).toBeGreaterThan(0n);
      expect(s.cash).toBeGreaterThan(0n);
      expect(s.borrows).toBeGreaterThan(0n);
    }
  });

  it('reads deployable headroom separately from withdrawable exit capacity', async () => {
    // `maxWithdrawable()` is min(our position, venue cash) and is 0 for a
    // venue the vault has not entered; `maxDeployable()` is
    // position-independent. Conflating them is the deployable half of audit
    // NEW-11's cold-start deadlock, and it was invisible while nothing read
    // maxDeployable at all.
    const snap = await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect();
    const byName = new Map(snap!.strategies.map((s) => [s.name, s]));

    // Compound III's base supply is uncapped when not paused.
    expect(byName.get('Compound')!.maxDeployable).toBe(2n ** 256n - 1n);
    expect(byName.get('Aave')!.maxDeployable).toBe(5_000_000_000_000n);
    expect(byName.get('Moonwell')!.maxDeployable).toBe(7_000_000_000_000n);

    for (const s of snap!.strategies) {
      expect(s.maxDeployable).not.toBe(s.maxWithdrawable);
    }
  });
});

describe('SnapshotCollector.collect — live interest-rate models (E1b)', () => {
  /**
   * Until 2026-09-10 the collector read no rate model at all, so
   * `runtime/decision-driver.ts` had nothing to put in
   * `MarketObservation.irmParams` and every live cycle simulated every venue
   * from `DefaultConfigs` — measured at 7.5689 pp MAE (Compound), 7.2538 pp
   * (Moonwell) and 3.9769 pp (Aave) against the archive's own stored supply
   * rates. These fixtures are Base mainnet's real parameters at pinned
   * archive blocks, so a decoding or scaling regression fails against a
   * measurement rather than against the code's own opinion.
   */
  const SECONDS_PER_YEAR = 31_557_600n;
  const RAY = 10n ** 27n;

  it("reads Comet's SUPPLY curve and annualizes it, with reserveFactorBps 0 by design", async () => {
    const snap = (await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect())!;
    const irm = snap.strategies.find((s) => s.name === 'Compound')!.irm!;
    expect(irm.address).toBe(COMET);
    // Per-second getters x 365.25 days, and the WAD kink lifted to RAY.
    expect(irm.baseRateWad).toBe(0n);
    expect(irm.kinkRay).toBe((RAY * 90n) / 100n);
    expect(irm.slopeLowWad).toBe(1_712_328_767n * SECONDS_PER_YEAR);
    expect(irm.slopeHighWad).toBe(96_207_020_547n * SECONDS_PER_YEAR);
    // Comet's supply curve is already net of reserves; charging one here
    // would be a second cut.
    expect(irm.reserveFactorBps).toBe(0);
    // Not Aave's shape: no bounds, which is what keeps the two apart.
    expect(irm.optimalUtilizationRay).toBeUndefined();
  });

  it("reads Moonwell's BORROW curve off the mToken's OWN interestRateModel(), plus the reserve cut", async () => {
    const snap = (await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect())!;
    const irm = snap.strategies.find((s) => s.name === 'Moonwell')!.irm!;
    // Resolved per read, never pinned: mUSDC's model has been redeployed by
    // governance repeatedly, and pinning it is the archive-side defect that
    // misattributes a swap to the previous model.
    // ethers returns a checksummed address; compare case-insensitively.
    expect(irm.address.toLowerCase()).toBe(MOONWELL_IRM);
    expect(irm.kinkRay).toBe((RAY * 90n) / 100n);
    expect(irm.slopeLowWad).toBe(1_934_302_557n * SECONDS_PER_YEAR);
    expect(irm.slopeHighWad).toBe(285_400_000_000n * SECONDS_PER_YEAR);
    // reserveFactorMantissa 0.15e18 -> 1500 bps. A 0 here would overstate
    // every Moonwell supply rate by exactly this factor.
    expect(irm.reserveFactorBps).toBe(1500);
    expect(irm.optimalUtilizationRay).toBeUndefined();
  });

  it("reads Aave's V3.2 packed bps strategy and converts it, carrying the reserve factor from the config word", async () => {
    const snap = (await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect())!;
    const irm = snap.strategies.find((s) => s.name === 'Aave')!.irm!;
    expect(irm.address.toLowerCase()).toBe(AAVE_STRATEGY);
    expect(irm.baseRateWad).toBe(0n);
    expect(irm.slopeLowWad).toBe((470n * 10n ** 18n) / 10_000n); // 4.7%
    expect(irm.slopeHighWad).toBe((1000n * 10n ** 18n) / 10_000n); // 10%
    expect(irm.kinkRay).toBe((RAY * 90n) / 100n);
    // The two Aave-only bounds ARE present, and they are what
    // `irmSeamFor` requires before routing this into `aaveIrmParams`.
    expect(irm.optimalUtilizationRay).toBe((RAY * 90n) / 100n);
    expect(irm.maxUtilizationRay).toBe(RAY);
    // Bits 64-79 of the reserve configuration word.
    expect(irm.reserveFactorBps).toBe(1000);
  });

  it('omits the reading, but keeps the snapshot COMPLETE, when a rate model does not answer', async () => {
    // A failed rate-model read is not a failed venue read: the state is still
    // sound, so §12's "do not decide" rule must not trip. What must happen
    // instead is that `irm` is ABSENT — never a substituted default — so
    // `simulateCurves` falls back loudly, naming the market.
    const chain = new FakeChain();
    stubVaultCore(chain);
    stubAave(chain, aaveConfigWord({ active: true, reserveFactorBps: 1000 }), false);
    stubCompound(chain, false);
    stubMoonwell(chain, false, false);
    const snap = (await new SnapshotCollector(chain.asChainClient(), FULL_CONFIG).collect())!;

    expect(snap.incomplete).toBe(false);
    expect(snap.missingMarkets).toEqual([]);
    for (const s of snap.strategies) {
      expect(s.irm).toBeUndefined();
      // The venue state itself is untouched.
      expect(s.cash).toBeGreaterThan(0n);
    }
  });
});

describe('SnapshotCollector.collect — snapshot completeness (paper §12)', () => {
  it('is complete when every configured venue answered', async () => {
    const snap = await new SnapshotCollector(fullChain().asChainClient(), FULL_CONFIG).collect();
    expect(snap!.incomplete).toBe(false);
    expect(snap!.missingMarkets).toEqual([]);
  });

  it('flags the snapshot incomplete and names the venue when a venue read reverts', async () => {
    // Previously this venue was logged and silently dropped, and the kernel
    // reallocated the whole vault across the two markets that happened to
    // answer, with nothing downstream able to tell.
    const chain = fullChain();
    chain.revertAll(MOONWELL_ADAPTER);
    const snap = await new SnapshotCollector(chain.asChainClient(), FULL_CONFIG).collect();

    expect(snap!.incomplete).toBe(true);
    expect(snap!.missingMarkets).toEqual(['Moonwell']);
    expect(snap!.strategies.map((s) => s.name)).toEqual(['Aave', 'Compound']);
  });

  it('flags the snapshot incomplete when only the deep venue call fails', async () => {
    // The adapter answers; the protocol behind it does not. This is exactly
    // the case the old hardcoded zeros could not distinguish from a healthy
    // idle venue.
    const chain = fullChain();
    chain.revertAll(COMET);
    const snap = await new SnapshotCollector(chain.asChainClient(), FULL_CONFIG).collect();
    expect(snap!.incomplete).toBe(true);
    expect(snap!.missingMarkets).toEqual(['Compound']);
  });

  it('does not treat an unconfigured venue as missing', async () => {
    const chain = new FakeChain();
    stubVaultCore(chain);
    stubAave(chain);
    const snap = await new SnapshotCollector(chain.asChainClient(), {
      ...FULL_CONFIG,
      strategyAddresses: { aave: AAVE_ADAPTER, compound: '', moonwell: '' },
    }).collect();
    expect(snap!.incomplete).toBe(false);
    expect(snap!.strategies.map((s) => s.name)).toEqual(['Aave']);
  });
});

describe('SnapshotCollector — argument-taking vault reads (audit Item 3 / NEW-3b)', () => {
  const GROUP_ID = '0x' + 'e1'.repeat(32);

  it('encodes getDependencyGroup(bytes32) and strategyAssets(address), so exposure is not always 0n', async () => {
    // Both calls used to go out as bare selectors for `getDependencyGroup()`
    // and `strategyAssets()`. FakeChain routes on full calldata, so the old
    // encoding lands on no route, throws, and this expectation fails.
    const chain = fullChain();
    chain
      .on(
        VAULT_IFACE,
        VAULT,
        'getDependencyGroup',
        [GROUP_ID],
        [2_500, 5_000_000_000n, [AAVE_ADAPTER, COMPOUND_ADAPTER]]
      )
      .on(VAULT_IFACE, VAULT, 'strategyAssets', [AAVE_ADAPTER], [111_000_000n])
      .on(VAULT_IFACE, VAULT, 'strategyAssets', [COMPOUND_ADAPTER], [222_000_000n])
      .on(REWARD_EXECUTOR_IFACE, EXECUTOR, 'getRouteIds', [], [[]]);

    const snap = await new SnapshotCollector(chain.asChainClient(), {
      ...FULL_CONFIG,
      rewardExecutorAddress: EXECUTOR,
      dependencyGroupIds: [GROUP_ID],
    }).collect();

    expect(snap!.vault.groups).toEqual([
      { id: GROUP_ID, exposure: 333_000_000n, cap: 5_000_000_000n },
    ]);
  });
});

describe('SnapshotCollector — RewardExecutor route reads (audit Item 3)', () => {
  const ROUTE_ID = '0x' + 'f0'.repeat(32);
  const OTHER_ROUTE_ID = '0x' + 'f1'.repeat(32);
  const ROUTE_DIGEST = '0x' + 'de'.repeat(32);
  const UPPER_BOUND_DECOY = 999_999_999n;

  function route(): unknown[] {
    return [
      '0x' + '01'.repeat(20), // inputToken
      '0x' + '02'.repeat(20), // outputToken
      ['0x' + '01'.repeat(20), '0x' + '02'.repeat(20)], // path
      [500], // fees
      ['0x' + '03'.repeat(20)], // pools
      '0x' + '04'.repeat(20), // rewardFeed
      '0x' + '05'.repeat(20), // usdcFeed
      3600n, // maxRewardFeedAge
      3600n, // maxUsdcFeedAge
      1_000_000n, // maxInput
      9900n, // minOutputBps
      100n, // maxPriceImpactBps
      50_000_000n, // maxDailyNotional
      1n, // lowerBound
      UPPER_BOUND_DECOY, // upperBound  <-- what index 11 of the old layout read
      '0x' + 'bb'.repeat(32), // activationBlockHash
      ROUTE_DIGEST, // routeDigest
    ];
  }

  function chainWithRoutes(approved: boolean): FakeChain {
    const chain = fullChain();
    chain
      .on(REWARD_EXECUTOR_IFACE, EXECUTOR, 'getRouteIds', [], [[ROUTE_ID, OTHER_ROUTE_ID]])
      .on(REWARD_EXECUTOR_IFACE, EXECUTOR, 'isRouteApproved', [ROUTE_ID], [approved])
      .on(REWARD_EXECUTOR_IFACE, EXECUTOR, 'getRoute', [ROUTE_ID], [route()]);
    return chain;
  }

  const config = { ...FULL_CONFIG, rewardExecutorAddress: EXECUTOR };

  it('decodes getRouteIds() as bytes32[] and asks about the real first route id', async () => {
    // `getRouteIds()`'s raw hex used to be cast to string[] and indexed, so
    // routeIds[0] was the CHARACTER "0" and every subsequent call was
    // malformed. Only the true route id is stubbed here.
    const snap = await new SnapshotCollector(chainWithRoutes(true).asChainClient(), config).collect();
    expect(snap!.vault.routeStatus).toBe('active');
  });

  it('reports inactive when the route is not approved, instead of always active', async () => {
    // The old code treated the raw hex return of the malformed
    // `isRouteApproved` call as truthy and set 'active' unconditionally.
    const snap = await new SnapshotCollector(chainWithRoutes(false).asChainClient(), config).collect();
    expect(snap!.vault.routeStatus).toBe('inactive');
  });

  it('reads routeDigest by name, not as a positional word', async () => {
    const snap = await new SnapshotCollector(chainWithRoutes(true).asChainClient(), config).collect();
    expect(snap!.vault.routeDigest).toBe(ROUTE_DIGEST);
    // The decoy upperBound is what index 11 of the pre-Phase-2 layout held.
    expect(snap!.vault.routeDigest).not.toBe(ethers.toBeHex(UPPER_BOUND_DECOY, 32));
  });

  it('reports inactive, not stale, when the executor has no routes at all', async () => {
    const chain = fullChain();
    chain.on(REWARD_EXECUTOR_IFACE, EXECUTOR, 'getRouteIds', [], [[]]);
    const snap = await new SnapshotCollector(chain.asChainClient(), config).collect();
    expect(snap!.vault.routeStatus).toBe('inactive');
    expect(snap!.vault.routeDigest).toBeUndefined();
  });
});
