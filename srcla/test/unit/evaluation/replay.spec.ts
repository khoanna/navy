/**
 * The replay engine after NEW-4 (real per-venue rates, wei/USDC unit error)
 * and NEW-14 (redemptions are executed and the success rate is measured).
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD (1e18) annualized;
 * gas prices wei; ETH/USD 8 dp.
 */
import {
  runReplay,
  accruedYieldBase,
  annualizedSharePriceGrowth,
  DEFAULT_REPLAY_GAS_PRICE_WEI,
  DEFAULT_REPLAY_ETH_USD_E8,
  type BaselineAction,
  type PolicyFn,
  type ReplaySnapshot,
} from '../../../src/evaluation/replay/replay.js';
import { gasCostToUsdcBase, modelExecution } from '../../../src/evaluation/replay/execution.js';
import { VaultReplay } from '../../../src/evaluation/replay/erc4626.js';
import { createInitialState } from '../../../src/evaluation/replay/state.js';
import { withdrawalSuccessRate } from '../../../src/evaluation/metrics/risk.js';
import type { EvaluationDataset, TimeOrderedSnapshot } from '../../../src/evaluation/dataset.js';
import type { MarketSnapshot } from '../../../src/domain/snapshots.js';

const WAD = 10n ** 18n;
const DAY_MS = 86_400_000;
/** 10,000 USDC in base units. */
const TIER = 10_000_000_000n;

function marketSnapshot(
  marketId: string,
  timestamp: Date,
  over: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  return {
    marketId,
    blockHash: '0x' + '11'.repeat(32),
    timestamp,
    totalAssetsBase: 0n,
    idleBase: 0n,
    supplyRateE18: (WAD * 5n) / 100n, // 5% APY
    utilizationE18: (WAD * 70n) / 100n,
    cashBase: 1_000_000_000_000n, // 1,000,000 USDC of venue cash
    borrowsBase: 0n,
    reservesBase: 0n,
    capBps: 10_000,
    paused: false,
    configDigest: '0xd',
    ...over,
  };
}

function dataset(
  days: number,
  build: (day: number, timestamp: Date) => MarketSnapshot[],
): EvaluationDataset {
  const start = Date.UTC(2026, 0, 1);
  const snapshots: TimeOrderedSnapshot[] = [];
  for (let i = 0; i < days; i++) {
    const timestamp = new Date(start + i * DAY_MS);
    snapshots.push({
      index: i,
      timestamp,
      blockHash: `0x${i.toString(16).padStart(64, '0')}`,
      snapshots: build(i, timestamp),
    });
  }
  return { manifestId: 'test', snapshots, labels: [] };
}

/** Deploys every idle base unit into `marketId` on the first snapshot only. */
function deployAllTo(marketId: string): PolicyFn {
  return (state) =>
    state.idleBase > 0n
      ? ([{ kind: 'deploy', adapter: marketId, amount: state.idleBase }] as BaselineAction[])
      : [];
}

/** Deploys all but `reserveBase`, i.e. keeps a cash reserve. */
function deployKeepingReserve(marketId: string, reserveBase: bigint): PolicyFn {
  return (state) => {
    const deployable = state.idleBase > reserveBase ? state.idleBase - reserveBase : 0n;
    return deployable > 0n ? [{ kind: 'deploy', adapter: marketId, amount: deployable }] : [];
  };
}

const HOLD: PolicyFn = () => [];

// ---------------------------------------------------------------------------
// NEW-4a: the wei-into-USDC unit error
// ---------------------------------------------------------------------------

describe('gasCostToUsdcBase', () => {
  it('converts gas to USDC base units, not to wei', () => {
    // 200,000 gas * 30 gwei = 6e15 wei = 0.006 ETH. At $3,000/ETH that is
    // $18.00 = 18_000_000 USDC base units.
    const base = gasCostToUsdcBase(200_000n, 30_000_000_000n, 300_000_000_000n);
    expect(base).toBe(18_000_000n);
  });

  it('is ~3.3e8x smaller than the raw wei product the old model booked', () => {
    const rawWei = 200_000n * 30_000_000_000n; // the old `gasUsed * gasPrice`
    const correct = gasCostToUsdcBase(200_000n, 30_000_000_000n, 300_000_000_000n);
    expect(rawWei).toBe(6_000_000_000_000_000n);
    // The old value, read as USDC base units, was $6,000,000,000 against a
    // 10,000 USDC tier.
    expect(rawWei / 1_000_000n).toBe(6_000_000_000n);
    expect(rawWei / correct).toBeGreaterThan(300_000_000n);
  });

  it('scales linearly with the ETH price', () => {
    const at3k = gasCostToUsdcBase(200_000n, 30_000_000_000n, 300_000_000_000n);
    const at6k = gasCostToUsdcBase(200_000n, 30_000_000_000n, 600_000_000_000n);
    expect(at6k).toBe(at3k * 2n);
  });

  it('is what modelExecution reports as gasCostBase', () => {
    const r = modelExecution(
      { kind: 'deploy', adapter: 'aa', amount: TIER, gasPriceWei: 30_000_000_000n, ethUsdE8: 300_000_000_000n },
      { idleBase: TIER, strategyBalances: new Map() },
    );
    expect(r.gasCostBase).toBe(18_000_000n);
    expect(r.totalCostBase).toBe(18_000_000n);
  });

  it('keeps a whole replay cost far below the tier at Base gas prices', () => {
    const ds = dataset(10, (_d, t) => [marketSnapshot('aa', t)]);
    const result = runReplay({
      dataset: ds,
      evaluationId: 'e',
      startDate: ds.snapshots[0]!.timestamp,
      endDate: ds.snapshots[9]!.timestamp,
      tier: TIER,
      policy: deployAllTo('aa'),
    });
    // The old model booked ~6e15 base units per deploy against a 1e10 tier
    // and drove every mover into calculateNetApy's -100% clamp.
    expect(result.totalCosts).toBeGreaterThan(0n);
    expect(result.totalCosts).toBeLessThan(TIER / 1000n);
    expect(result.realizedNetApy).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// NEW-4b: yield comes from the snapshot, per venue
// ---------------------------------------------------------------------------

describe('accruedYieldBase', () => {
  const stateWith = (balances: Array<[string, bigint]>) => {
    const s = createInitialState(TIER);
    s.strategyBalances = new Map(balances);
    return s;
  };

  it('uses each venue\'s own observed rate', () => {
    const t = new Date();
    const snap: TimeOrderedSnapshot = {
      index: 0,
      timestamp: t,
      blockHash: '0x0',
      snapshots: [
        marketSnapshot('slow', t, { supplyRateE18: (WAD * 1n) / 100n }),
        marketSnapshot('fast', t, { supplyRateE18: (WAD * 10n) / 100n }),
      ],
    };
    const day = 86_400n;
    const slow = accruedYieldBase(stateWith([['slow', TIER]]), snap, day);
    const fast = accruedYieldBase(stateWith([['fast', TIER]]), snap, day);

    // 10x the rate, 10x the yield — the old flat-5%-APY engine returned the
    // same number for both, which is what made venue choice causally
    // irrelevant to the returns the harness reported.
    expect(fast).toBe(slow * 10n);
    expect(slow).toBe((TIER * ((WAD * 1n) / 100n) * day) / (31_557_600n * WAD));
  });

  it('earns nothing on idle and nothing on a venue absent from the snapshot', () => {
    const t = new Date();
    const snap: TimeOrderedSnapshot = {
      index: 0,
      timestamp: t,
      blockHash: '0x0',
      snapshots: [marketSnapshot('aa', t)],
    };
    // All assets idle: strategyBalances empty.
    expect(accruedYieldBase(createInitialState(TIER), snap, 86_400n)).toBe(0n);
    // Held in a venue this snapshot does not observe.
    expect(accruedYieldBase(stateWith([['unknown', TIER]]), snap, 86_400n)).toBe(0n);
  });

  it('has no minimum: zero elapsed time earns exactly zero', () => {
    const t = new Date();
    const snap: TimeOrderedSnapshot = {
      index: 0,
      timestamp: t,
      blockHash: '0x0',
      snapshots: [marketSnapshot('aa', t)],
    };
    expect(accruedYieldBase(stateWith([['aa', TIER]]), snap, 0n)).toBe(0n);
  });

  it('makes a policy that picks the better venue actually earn more', () => {
    const ds = dataset(30, (_d, t) => [
      marketSnapshot('slow', t, { supplyRateE18: (WAD * 1n) / 100n }),
      marketSnapshot('fast', t, { supplyRateE18: (WAD * 8n) / 100n }),
    ]);
    const common = {
      dataset: ds,
      evaluationId: 'e',
      startDate: ds.snapshots[0]!.timestamp,
      endDate: ds.snapshots[29]!.timestamp,
      tier: TIER,
    };
    const slow = runReplay({ ...common, policy: deployAllTo('slow') });
    const fast = runReplay({ ...common, policy: deployAllTo('fast') });
    const idle = runReplay({ ...common, policy: HOLD });

    expect(fast.realizedNetApy).toBeGreaterThan(slow.realizedNetApy);
    expect(slow.realizedNetApy).toBeGreaterThan(idle.realizedNetApy);
    // Holding idle earns no yield at all; it only loses nothing because it
    // also never pays gas.
    expect(idle.realizedNetApy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NEW-14: redemptions are executed, and the rate is measured
// ---------------------------------------------------------------------------

describe('runReplay: executed redemptions', () => {
  const ds = () => dataset(10, (_d, t) => [marketSnapshot('aa', t)]);
  const base = (d: EvaluationDataset) => ({
    dataset: d,
    evaluationId: 'e',
    startDate: d.snapshots[0]!.timestamp,
    endDate: d.snapshots[9]!.timestamp,
    tier: TIER,
  });

  it('reports null — not 1 — when no redemption was attempted', () => {
    const r = runReplay({ ...base(ds()), policy: deployAllTo('aa') });
    expect(r.withdrawals).toHaveLength(0);
    expect(r.withdrawalSuccessRate).toBeNull();
  });

  it('actually executes the redemption: shares are burned and assets leave', () => {
    const d = ds();
    const r = runReplay({
      ...base(d),
      policy: deployAllTo('aa'),
      withdrawals: [{ snapshotIndex: 5, assetsBase: 2_000_000_000n }],
    });

    expect(r.withdrawals).toHaveLength(1);
    expect(r.withdrawals[0]!.success).toBe(true);
    expect(r.withdrawals[0]!.grantedBase).toBe(2_000_000_000n);
    expect(r.withdrawalSuccessRate).toBe(1);

    // The vault is genuinely smaller afterwards, in both assets and shares.
    const before = r.snapshots[4]!;
    const after = r.snapshots[5]!;
    expect(after.totalAssets).toBeLessThan(before.totalAssets);
    expect(after.totalShares).toBeLessThan(before.totalShares);
  });

  it('unwinds a venue when the vault holds no idle cash, and pays gas to do it', () => {
    const d = ds();
    const withdrawals = [{ snapshotIndex: 5, assetsBase: 2_000_000_000n }];
    const noCash = runReplay({ ...base(d), policy: deployAllTo('aa'), withdrawals });
    const withCash = runReplay({
      ...base(d),
      policy: deployKeepingReserve('aa', 3_000_000_000n),
      withdrawals,
    });

    expect(noCash.withdrawals[0]!.divestedFrom).toEqual(['aa']);
    // The reserve-holding policy pays the redemption straight out of idle.
    expect(withCash.withdrawals[0]!.divestedFrom).toEqual([]);

    const divestGas = modelExecution(
      {
        kind: 'divest',
        adapter: 'aa',
        amount: 2_000_000_000n,
        gasPriceWei: DEFAULT_REPLAY_GAS_PRICE_WEI,
        ethUsdE8: DEFAULT_REPLAY_ETH_USD_E8,
      },
      { idleBase: 0n, strategyBalances: new Map() },
    ).totalCostBase;
    expect(divestGas).toBeGreaterThan(0n);
    expect(noCash.totalCosts - withCash.totalCosts).toBe(divestGas);
  });

  it('FAILS the redemption when neither idle nor venue liquidity can cover it', () => {
    // The venue holds almost no cash, so the vault's position there is not
    // synchronously exitable.
    const d = dataset(10, (_x, t) => [marketSnapshot('aa', t, { cashBase: 1_000_000n })]);
    const r = runReplay({
      ...base(d),
      policy: deployAllTo('aa'),
      withdrawals: [{ snapshotIndex: 5, assetsBase: 2_000_000_000n }],
    });

    expect(r.withdrawals[0]!.success).toBe(false);
    expect(r.withdrawals[0]!.grantedBase).toBe(0n);
    expect(r.withdrawals[0]!.reason).toBe('INSUFFICIENT_LIQUIDITY');
    expect(r.withdrawalSuccessRate).toBe(0);
  });

  it('lets the reserve pay off: the same squeeze that fails a zero-cash policy fills for a reserved one', () => {
    const d = dataset(10, (_x, t) => [marketSnapshot('aa', t, { cashBase: 1_000_000n })]);
    const withdrawals = [{ snapshotIndex: 5, assetsBase: 2_000_000_000n }];

    const zeroCash = runReplay({ ...base(d), policy: deployAllTo('aa'), withdrawals });
    const reserved = runReplay({
      ...base(d),
      policy: deployKeepingReserve('aa', 2_500_000_000n),
      withdrawals,
    });

    expect(zeroCash.withdrawalSuccessRate).toBe(0);
    expect(reserved.withdrawalSuccessRate).toBe(1);
  });

  it('measures a mixed rate rather than rounding to a pass', () => {
    const d = dataset(10, (_x, t) => [marketSnapshot('aa', t, { cashBase: 1_000_000n })]);
    const r = runReplay({
      ...base(d),
      policy: deployKeepingReserve('aa', 1_000_000_000n),
      withdrawals: [
        { snapshotIndex: 3, assetsBase: 900_000_000n }, // fits in the reserve
        { snapshotIndex: 6, assetsBase: 5_000_000_000n }, // does not
      ],
    });
    expect(r.withdrawals.map((w) => w.success)).toEqual([true, false]);
    expect(r.withdrawalSuccessRate).toBe(0.5);
  });

  it('reports realized APY from share price, so a redemption does not look like a loss', () => {
    const d = ds();
    const noRedemption = runReplay({ ...base(d), policy: deployAllTo('aa') });
    const withRedemption = runReplay({
      ...base(d),
      policy: deployAllTo('aa'),
      withdrawals: [{ snapshotIndex: 5, assetsBase: 5_000_000_000n }],
    });

    // Half the vault leaves, so a total-assets measure would report roughly
    // -50%; NAV per share is barely touched (only the extra unwind gas).
    const assetsRatio =
      Number(withRedemption.snapshots[9]!.totalAssets) /
      Number(noRedemption.snapshots[9]!.totalAssets);
    expect(assetsRatio).toBeGreaterThan(0.45);
    expect(assetsRatio).toBeLessThan(0.55);

    expect(Math.abs(withRedemption.realizedNetApy - noRedemption.realizedNetApy)).toBeLessThan(0.001);
    expect(withRedemption.realizedNetApy).toBeGreaterThan(0);
    // Share price is what carries the return, and it does not fall on a
    // redemption at NAV.
    expect(withRedemption.snapshots[9]!.sharePriceWad).toBeGreaterThan(
      withRedemption.snapshots[4]!.sharePriceWad,
    );
  });
});

describe('VaultReplay.redeemAssets', () => {
  it('refuses to pay out of a venue position — only idle funds a redemption', () => {
    const v = new VaultReplay(0n);
    v.deposit(TIER, 'c');
    v.deploy('aa', TIER);
    const r = v.redeemAssets('c', 1_000_000_000n);
    expect(r.grantedBase).toBe(0n);
    expect(r.reason).toBe('INSUFFICIENT_LIQUIDITY');
    // No state change on a failed redemption.
    expect(v.getState().totalShares).toBe(TIER);
  });

  it('rounds the burned shares up, never handing back more value than given up', () => {
    const v = new VaultReplay(0n);
    v.deposit(1_000_000n, 'c');
    // 3 assets against a 3:1 share price would be 1 share exactly; make the
    // price awkward so rounding is observable.
    v.addYield(1n);
    const before = v.getState();
    const shares = v.sharesForAssets(7n);
    expect(shares * before.totalAssets).toBeGreaterThanOrEqual(7n * before.totalShares);
  });

  it('fails when the cohort does not hold enough shares', () => {
    const v = new VaultReplay(0n);
    v.deposit(TIER, 'c');
    expect(v.redeemAssets('other', 1n).reason).toBe('INSUFFICIENT_SHARES');
    expect(v.redeemAssets('c', TIER * 10n).reason).toBe('INSUFFICIENT_SHARES');
  });
});

describe('withdrawalSuccessRate (metrics/risk)', () => {
  it('returns null for an empty attempt set instead of a flattering 1', () => {
    expect(withdrawalSuccessRate([])).toBeNull();
  });

  it('ignores zero-asset requests, which are not attempts', () => {
    expect(withdrawalSuccessRate([{ requested: 0n, granted: 0n }])).toBeNull();
  });

  it('counts a fill as >= 99% of the request', () => {
    expect(withdrawalSuccessRate([{ requested: 100n, granted: 99n }])).toBe(1);
    expect(withdrawalSuccessRate([{ requested: 100n, granted: 98n }])).toBe(0);
    expect(
      withdrawalSuccessRate([
        { requested: 100n, granted: 100n },
        { requested: 100n, granted: 0n },
      ]),
    ).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// §11.4 stressed liquid coverage
// ---------------------------------------------------------------------------

// The underlying computation (`stressedCoverage`) is unit-tested directly in
// test/unit/policy/coverage.spec.ts and cross-checked against this module's
// call site in test/unit/evaluation/coverage-parity.spec.ts. This block only
// covers what's specific to the replay: that the per-snapshot field and the
// running minimum are populated from it correctly.
describe('replay stressedLiquidCoverage reporting', () => {
  it('is reported per snapshot and minimised across the replay', () => {
    const d = dataset(4, (day, t) => [
      marketSnapshot('aa', t, { cashBase: day === 2 ? 0n : 1_000_000_000_000n }),
    ]);
    const r = runReplay({
      dataset: d,
      evaluationId: 'e',
      startDate: d.snapshots[0]!.timestamp,
      endDate: d.snapshots[3]!.timestamp,
      tier: TIER,
      policy: deployAllTo('aa'),
    });
    expect(r.snapshots[2]!.stressedLiquidCoverage).toBe(0);
    expect(r.minStressedLiquidCoverage).toBe(0);
  });
});

describe('annualizedSharePriceGrowth', () => {
  const s = (day: number, priceWad: bigint): ReplaySnapshot => ({
    timestamp: new Date(Date.UTC(2026, 0, 1) + day * DAY_MS),
    totalAssets: 0n,
    totalShares: 0n,
    sharePriceWad: priceWad,
    totalReturn: 0,
    idleBase: 0n,
    stressedLiquidCoverage: 1,
  });

  it('annualizes share-price growth over the real elapsed time', () => {
    // +1% over 365.25 days is ~1% annualized.
    const out = annualizedSharePriceGrowth([s(0, WAD), s(365, (WAD * 101n) / 100n)]);
    expect(out).toBeGreaterThan(0.0099);
    expect(out).toBeLessThan(0.0102);
  });

  it('is 0 for a series with fewer than two points', () => {
    expect(annualizedSharePriceGrowth([])).toBe(0);
    expect(annualizedSharePriceGrowth([s(0, WAD)])).toBe(0);
  });
});
