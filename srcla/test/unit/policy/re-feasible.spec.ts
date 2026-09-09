import { reFeasible } from '../../../src/policy/decide.js';
import { requiredReserve } from '../../../src/policy/steps/reserve.js';
import type {
  DecisionInput,
  MarketObservation,
  PolicyArtifact,
  RateCurve,
} from '../../../src/policy/types.js';

/**
 * `reFeasible` re-runs `optimize`'s guardrails against a vector `optimize` did
 * not produce — the leg-filtered subset and the partial adjustment toward it.
 * Unlike `optimize`'s own predicate it is applied to vectors that CONTAIN the
 * current position, so every bound is evaluated as "no worse than current": a
 * percentage cap is a fraction of TVL and the §8.1 scenarios are a function of
 * live venue cash, so the vault can be in breach with no move at all, and
 * demanding absolute compliance would hold forever in the state that most
 * needs a move.
 *
 * "No worse" has to mean no worse BY MAGNITUDE, not merely "the same set of
 * things is broken" (P17 review I3) — otherwise a shortfall drifts upward
 * unboundedly, one origin at a time, while every step reports itself
 * compliant.
 */

const U = 1_000_000n; // 1 USDC in base units
const TVL = 10_000n * U;

function market(id: string, positionBase: bigint, maxWithdrawableBase: bigint): MarketObservation {
  return {
    marketId: id,
    adapter: `0x${id.padEnd(40, '0')}`,
    protocol: 'aave',
    cash: 10n ** 13n,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: 10n ** 16n,
    utilizationWad: 0n,
    positionBase,
    maxDeployableBase: 10n ** 13n,
    maxWithdrawableBase,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 10_000,
    absoluteCapBase: 10n ** 13n,
    maxLossBps: 50,
    dependencyGroupIds: [],
  };
}

/**
 * 10,000 USDC of NAV. 'aa' holds 6,000 but can only ever release 100 of it;
 * 'bb' holds 2,000 and is fully liquid. 2,000 is idle. That combination
 * already FAILS the w50 stress scenario (50% of NAV demanded against a 50%
 * liquidity haircut) — which is the whole point: the comparisons under test
 * only exist for a vault that starts out in breach.
 */
function input(): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: TVL,
      idleBase: 2_000n * U,
      sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0xv',
    },
    markets: [market('aa', 6_000n * U, 100n * U), market('bb', 2_000n * U, 6_000n * U)],
    dependencyGroups: [],
    // Empty, so `demandQuantileBase` is 0 and `requiredBase` is driven purely
    // by the stress shortfall — the quantity under test.
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,
      l1BaseFeeWei: 1n,
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    history: [],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

/** Identity cash forecast, so `e_i^cons` is exactly `maxWithdrawableBase`. */
function artifact(): PolicyArtifact {
  return {
    artifactHash: '0xrefeasible',
    policyVersion: 1,
    horizonSeconds: 604_800,
    coverageTarget: 0.95,
    method: 'rolling',
    methodParams: {},
    residualQuantileWadByMarket: {},
    cashResidualQuantileWadByMarket: {},
    cashLowerBoundQuantileWad: 0n,
    portfolioResidualQuantileWad: 0n,
    minObservations: 0,
    availabilityLagSeconds: 0,
    noTradeBandK: 0,
    paybackSeconds: 2_592_000,
    adjustmentRate: 1,
    edgeWindowEffective: 1,
    configDigest: '0xd',
    pinnedConfigDigests: {},
  };
}

function curves(): RateCurve[] {
  const flat = (marketId: string): RateCurve => ({
    marketId,
    quantumBase: 1_000n * U,
    points: Array.from({ length: 11 }, () => 10n ** 16n),
    maxXBase: TVL,
  });
  return [flat('aa'), flat('bb')];
}

const RESERVE_OPTS = { reserveQuantile: 0.95, reserveHorizonSeconds: 86_400 };
const current = () => new Map([['aa', 6_000n * U], ['bb', 2_000n * U]]);

const check = (candidate: Map<string, bigint>): boolean =>
  reFeasible(input(), artifact(), curves(), current(), candidate, {}, RESERVE_OPTS);

/** The w50 shortfall and the idle slack a candidate would leave. */
function metrics(candidate: Map<string, bigint>): { shortfall: bigint; slack: bigint } {
  const r = requiredReserve(input(), artifact(), candidate, {
    quantile: RESERVE_OPTS.reserveQuantile,
    horizonSeconds: RESERVE_OPTS.reserveHorizonSeconds,
  });
  let deployed = 0n;
  for (const v of candidate.values()) deployed += v;
  return {
    shortfall: r.scenarioFeasible.find((s) => s.scenario === 'w50')!.shortfallBase,
    slack: TVL - deployed - r.requiredBase,
  };
}

describe('reFeasible: the guardrails are monotone against the current position', () => {
  it('the fixture starts out in breach — otherwise nothing below is under test', () => {
    const r = requiredReserve(input(), artifact(), current(), {
      quantile: RESERVE_OPTS.reserveQuantile,
      horizonSeconds: RESERVE_OPTS.reserveHorizonSeconds,
    });
    const w50 = r.scenarioFeasible.find((s) => s.scenario === 'w50')!;
    expect(w50.feasible).toBe(false);
    expect(w50.shortfallBase).toBe(3_950n * U);
    // And the current position is accepted despite that breach: an absolute
    // check would refuse it and `decide` would hold forever.
    expect(check(current())).toBe(true);
  });

  // I3. The candidate deploys LESS than today (6,000 vs 8,000), so it leaves
  // more idle and its reserve slack is strictly BETTER (-950 vs -1,950 USDC) —
  // the idle inequality accepts it. But it abandons the liquid venue entirely,
  // so the w50 shortfall grows from 3,950 to 4,950 USDC. Comparing only WHICH
  // scenarios fail (both fail w50, so the failing SET is unchanged) accepted
  // this, every origin, without bound.
  it('REFUSES a candidate that fails the same scenario by a LARGER shortfall', () => {
    const worse = new Map([['aa', 6_000n * U], ['bb', 0n]]);

    const before = metrics(current());
    const after = metrics(worse);
    // Non-vacuity, both halves: the shortfall genuinely grows, and the idle
    // inequality genuinely does not catch it.
    expect(after.shortfall).toBeGreaterThan(before.shortfall);
    expect(after.slack).toBeGreaterThan(before.slack);
    expect(after.shortfall).toBe(4_950n * U);

    expect(check(worse)).toBe(false);
  });

  it('ACCEPTS a candidate that fails the same scenario by the same shortfall', () => {
    // 1,000 USDC pulled out of the illiquid venue. `aa` could only ever
    // release 100, so the exit capacity — and therefore the shortfall — is
    // unchanged, while idle improves. This must not be refused: it is a
    // strict de-risking of exactly the position that is in breach.
    const same = new Map([['aa', 5_000n * U], ['bb', 2_000n * U]]);

    const before = metrics(current());
    const after = metrics(same);
    expect(after.shortfall).toBe(before.shortfall);
    expect(after.slack).toBeGreaterThan(before.slack);

    expect(check(same)).toBe(true);
  });

  it('ACCEPTS a candidate that repairs the breach outright', () => {
    // Exiting the illiquid venue entirely puts 8,000 in idle, and §8.1's
    // feasibility test is `idle + stressed exits >= stressed demand`, so w50
    // passes. NOTE the shortfall itself does NOT fall — `shortfallBase` is
    // `demand - exits` and ignores idle — which is exactly why the comparison
    // under test only inspects scenarios the CANDIDATE fails: a repaired
    // scenario is skipped, not compared.
    const repaired = new Map([['aa', 0n], ['bb', 2_000n * U]]);
    const r = requiredReserve(input(), artifact(), repaired, {
      quantile: RESERVE_OPTS.reserveQuantile,
      horizonSeconds: RESERVE_OPTS.reserveHorizonSeconds,
    });
    expect(r.scenarioFeasible.every((x) => x.feasible)).toBe(true);
    expect(metrics(repaired).shortfall).toBeGreaterThan(metrics(current()).shortfall);
    expect(check(repaired)).toBe(true);
  });

  it('REFUSES a candidate that fails a scenario the current position passes', () => {
    // Everything into the illiquid venue: w25 passes today and fails here.
    const newFailure = new Map([['aa', 9_500n * U], ['bb', 0n]]);
    const r = requiredReserve(input(), artifact(), newFailure, {
      quantile: RESERVE_OPTS.reserveQuantile,
      horizonSeconds: RESERVE_OPTS.reserveHorizonSeconds,
    });
    expect(r.scenarioFeasible.find((s) => s.scenario === 'w25')!.feasible).toBe(false);
    expect(check(newFailure)).toBe(false);
  });

  it('REFUSES a candidate that allocates more than the vault holds', () => {
    expect(check(new Map([['aa', 9_000n * U], ['bb', 9_000n * U]]))).toBe(false);
  });

  it('REFUSES a negative allocation', () => {
    expect(check(new Map([['aa', -1n], ['bb', 0n]]))).toBe(false);
  });
});
