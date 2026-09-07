import { requiredReserve, demandQuantileBase, STRESS_SCENARIOS } from '../../../src/policy/steps/reserve.js';
import type { DecisionInput, MarketObservation } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

function market(over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: 'aave', adapter: '0xa', protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function input(markets: MarketObservation[], withdrawals: Array<{ timestampSeconds: number; assetsBase: bigint }> = []): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 1_000_000_000_000n, idleBase: 100_000_000_000n, sharesOutstanding: 10n ** 12n,
      adminReserveBase: 10_000_000_000n, dynamicReserveBase: 0n, minIdleBps: 50,
      paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals,
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

const OPTS = { quantile: 0.95, horizonSeconds: 86_400 };

describe('demandQuantileBase', () => {
  it('is zero with no observed withdrawals', () => {
    expect(demandQuantileBase([], 1_000_000, 86_400, 0.95)).toBe(0n);
  });

  it('takes the quantile of rolling horizon demand', () => {
    const w = Array.from({ length: 20 }, (_, i) => ({
      timestampSeconds: 1_000_000 - i * 3600,
      assetsBase: BigInt(i + 1) * 1_000_000n,
    }));
    expect(demandQuantileBase(w, 1_000_000, 86_400, 0.95)).toBeGreaterThan(0n);
  });
});

describe('requiredReserve (P3)', () => {
  it('never falls below the admin floor', () => {
    const r = requiredReserve(input([market()]), new Map([['aave', 0n]]), OPTS);
    expect(r.requiredBase).toBeGreaterThanOrEqual(10_000_000_000n);
    expect(r.floorBase).toBe(10_000_000_000n);
  });

  // Whole-branch review, HIGH 5: the vault enforces
  // `requiredIdle() = max(adminReserve, dynamicReserve)` on chain
  // (NavyVaultSRCLA.sol). Before this fix, requiredReserve read
  // `input.vault.adminReserveBase` and `minIdleBps` but never
  // `dynamicReserveBase`, so a dynamic reserve activated by a PRIOR plan
  // (which persists past that plan's expiry per §8.1) would not raise the
  // off-chain floor here, and a later, lower-computed reserve could size a
  // deploy the on-chain call then rejects with InsufficientIdle. This test
  // fails under the old implementation: dynamicReserveBase (80B) exceeds
  // both adminReserveBase (10B) and the minIdleBps floor, so the old code's
  // floorBase/requiredBase would incorrectly stay at 10B.
  it('never falls below the dynamic reserve activated by a prior plan', () => {
    const i = input([market()]);
    i.vault.dynamicReserveBase = 80_000_000_000n; // > adminReserveBase (10B) and > the bps floor
    const r = requiredReserve(i, new Map([['aave', 0n]]), OPTS);
    expect(r.floorBase).toBe(80_000_000_000n);
    expect(r.requiredBase).toBeGreaterThanOrEqual(80_000_000_000n);
  });

  it('the dynamic reserve floor still yields to a higher admin floor or demand/stress term', () => {
    const i = input([market()]);
    i.vault.dynamicReserveBase = 5_000_000_000n; // < adminReserveBase (10B)
    const r = requiredReserve(i, new Map([['aave', 0n]]), OPTS);
    expect(r.floorBase).toBe(10_000_000_000n); // admin floor still wins
  });

  it('nets demand against executable venue exits, so deep liquidity lowers the reserve', () => {
    const w = [{ timestampSeconds: 999_000, assetsBase: 50_000_000_000n }];
    const liquid = requiredReserve(
      input([market({ maxWithdrawableBase: 10n ** 12n })], w),
      new Map([['aave', 500_000_000_000n]]),
      OPTS
    );
    const illiquid = requiredReserve(
      input([market({ maxWithdrawableBase: 0n })], w),
      new Map([['aave', 500_000_000_000n]]),
      OPTS
    );
    // Concrete numbers: liquid nets the full 50e9 demand against a 500e9-deep
    // venue -> netDemandQuantileBase = 0. Illiquid can exit nothing -> the
    // full 50e9 demand stays unnetted.
    expect(liquid.netDemandQuantileBase).toBe(0n);
    expect(illiquid.netDemandQuantileBase).toBe(50_000_000_000n);
    expect(liquid.netDemandQuantileBase).toBeLessThan(illiquid.netDemandQuantileBase);
  });

  it('is candidate-dependent: a different target gives a different reserve', () => {
    // maxWithdrawableBase is set high enough that it is NOT the binding
    // constraint for either candidate — otherwise both targets get clamped
    // to the same executable exit and the test would pass for the wrong
    // reason (this is what the brief's own example numbers did: a
    // maxWithdrawableBase of 1_000_000n bound both a 1_000_000n and a
    // 900_000_000_000n target down to the same 1_000_000n exit, so
    // requiredBase came out identical for both -- see task-7-report.md).
    const w = [{ timestampSeconds: 999_000, assetsBase: 200_000_000_000n }];
    const m = market({ maxWithdrawableBase: 10n ** 12n });
    const small = requiredReserve(input([m], w), new Map([['aave', 1_000_000n]]), OPTS);
    const large = requiredReserve(input([m], w), new Map([['aave', 900_000_000_000n]]), OPTS);
    expect(small.requiredBase).not.toBe(large.requiredBase);
    // Concrete numbers, worked by hand in task-7-report.md:
    // small: netDemand ~= 199_999_000_000, stress dominates at w50 = 499_999_500_000
    // large: netDemand = 0 (900e9 exit covers 200e9 demand), stress w50 = 50_000_000_000
    expect(small.requiredBase).toBe(499_999_500_000n);
    expect(large.requiredBase).toBe(50_000_000_000n);
  });

  it('flags an infeasible scenario when stressed exits cannot meet demand', () => {
    const r = requiredReserve(
      input([market({ maxWithdrawableBase: 0n })]),
      new Map([['aave', 999_000_000_000n]]),
      OPTS
    );
    expect(r.scenarioFeasible.some((s) => !s.feasible)).toBe(true);
  });

  it('is feasible when idle-after-allocation plus stressed exits covers stressed demand', () => {
    // Small allocation leaves most of totalAssetsBase idle, so even a fully
    // illiquid venue (exitsS = 0 at every scenario) is covered by idle cash
    // alone at every stress tier.
    const r = requiredReserve(
      input([market({ maxWithdrawableBase: 0n })]),
      new Map([['aave', 1_000_000n]]),
      OPTS
    );
    expect(r.scenarioFeasible.every((s) => s.feasible)).toBe(true);
  });

  it('registers the stress scenarios used by the H4 ablation', () => {
    expect(STRESS_SCENARIOS.map((s) => s.name)).toEqual(['w5', 'w10', 'w25', 'w50']);
  });
});
