/**
 * The one evaluation harness (NEW-2, NEW-12).
 *
 * These tests exist to prove three things the previous harnesses could not:
 *   1. every registered policy's decision comes from `src/policy/decide.ts`,
 *   2. the baseline/ablation table matches the v0.5 paper table, and
 *   3. an ablation that removes nothing is REPORTED as inert rather than
 *      quietly contributing a noise delta.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD annualized.
 */
import {
  runRegisteredEvaluation,
  buildWithdrawalSchedule,
  buildHindsightRates,
  prepareArtifact,
  decideOptsForTier,
  REGISTERED_TIERS,
} from '../../../src/evaluation/kernel/harness.js';
import {
  REGISTERED_POLICIES,
  REGISTERED_BASELINES,
  REGISTERED_ABLATIONS,
  targetToActions,
  frozenEqualWeightTarget,
} from '../../../src/evaluation/kernel/registry.js';
import {
  buildDecisionInput,
  deriveCompletedLabels,
  labelsAvailableAt,
  calibrateResidualQuantiles,
  type HarnessConfig,
} from '../../../src/evaluation/kernel/decision-input.js';
import { createInitialState } from '../../../src/evaluation/replay/state.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import type { EvaluationDataset, TimeOrderedSnapshot } from '../../../src/evaluation/dataset.js';
import type { MarketSnapshot } from '../../../src/domain/snapshots.js';
import type { PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const DAY_MS = 86_400_000;
const DAY = 86_400;
const TIER = 10_000_000_000n; // 10,000 USDC
const HORIZON = 604_800; // 7 days

const VENUES = ['aave-usdc', 'compound-usdc', 'moonwell-usdc'] as const;

function market(
  marketId: string,
  timestamp: Date,
  over: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  return {
    marketId,
    blockHash: '0x' + '22'.repeat(32),
    timestamp,
    totalAssetsBase: TIER,
    idleBase: 0n,
    supplyRateE18: (WAD * 4n) / 100n,
    utilizationE18: (WAD * 60n) / 100n,
    cashBase: 400_000_000_000n, // 400,000 USDC of venue cash
    borrowsBase: 600_000_000_000n,
    reservesBase: 0n,
    capBps: 5_000,
    paused: false,
    configDigest: `digest-${marketId}`,
    ...over,
  };
}

/** 60 daily snapshots over three venues with distinguishable rates. */
function makeDataset(
  days = 60,
  rate: (venue: string, day: number) => bigint = (venue) =>
    venue === 'aave-usdc' ? (WAD * 6n) / 100n : venue === 'compound-usdc' ? (WAD * 4n) / 100n : (WAD * 2n) / 100n,
  extra: (venue: string, day: number) => Partial<MarketSnapshot> = () => ({}),
): EvaluationDataset {
  const start = Date.UTC(2026, 0, 1);
  const snapshots: TimeOrderedSnapshot[] = [];
  for (let d = 0; d < days; d++) {
    const timestamp = new Date(start + d * DAY_MS);
    snapshots.push({
      index: d,
      timestamp,
      blockHash: `0x${d.toString(16).padStart(64, '0')}`,
      snapshots: VENUES.map((v) =>
        market(v, timestamp, { supplyRateE18: rate(v, d), ...extra(v, d) }),
      ),
    });
  }
  return { manifestId: 'm', snapshots, labels: [] };
}

function harnessConfig(over: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    vault: {
      adminReserveBase: 0n,
      minIdleBps: 500, // 5% admin floor
      configurationDigest: '0x' + 'ee'.repeat(32),
    },
    markets: {},
    defaultMarket: {
      capBps: 5_000,
      absoluteCapBase: 10n ** 15n,
      maxLossBps: 50,
      dependencyGroupIds: [],
    },
    dependencyGroups: [],
    gas: {
      l2BaseFeeWei: 30_000_000n,
      l1BaseFeeWei: 8_000_000_000n,
      l1BlobBaseFeeWei: 10_000_000n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    horizonSeconds: HORIZON,
    availabilityLagSeconds: 900,
    ...over,
  };
}

function testArtifact(over: Partial<PolicyArtifact> = {}): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    // The registered value is 30; a 60-day fixture cannot reach it early
    // enough to exercise anything, and this test is about the harness, not
    // about the admission threshold.
    minObservations: 3,
    horizonSeconds: HORIZON,
    // Materially negative: a 6% APY venue's 7-day horizon return is ~1.15e15
    // WAD, so -2e14 is ~17% of it. The bootstrap's -1e13 is deliberately
    // negligible (see its derivation note) and would make H2 inert here for
    // a reason that has nothing to do with the switch.
    portfolioResidualQuantileWad: -2n * 10n ** 14n,
    // §7.2's second forecast target, made an identity here so these cases
    // isolate the rule under test rather than a cash haircut on phi.
    cashResidualQuantileWadByMarket: {},
    cashLowerBoundQuantileWad: 0n,
    noTradeBandK: 0,
    // P15/P17: `paybackSeconds` is the registered window a move must repay its
    // own movement cost within, and `steps/hurdles.ts` throws without it. The
    // bootstrap artifact does not carry one (a payback period is a
    // registration, not a default), so a fixture that drives decide() through
    // the per-leg hurdles has to supply it. 30 days matches
    // scripts/freeze-artifact.ts's PAYBACK_SECONDS.
    paybackSeconds: 30 * 86_400,
    ...over,
  };
}

const OPTS = {
  ...DEFAULT_DECIDE_OPTS,
  cost: {
    ...DEFAULT_DECIDE_OPTS.cost,
    minTurnoverBps: 1,
    maxTurnoverBps: 10_000,
    slippageBps: 0,
    mevBps: 0,
    impactBps: 0,
  },
};

function run(
  over: Partial<Parameters<typeof runRegisteredEvaluation>[0]> = {},
): ReturnType<typeof runRegisteredEvaluation> {
  return runRegisteredEvaluation({
    dataset: makeDataset(40),
    config: harnessConfig(),
    artifact: testArtifact(),
    tiers: [TIER],
    decideOpts: OPTS,
    quantumStepsPerTier: 20,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// NEW-12: the table matches the v0.5 paper
// ---------------------------------------------------------------------------

describe('registered policy table', () => {
  it('is exactly SRCLA + B0-B5 + B2u + H1-H7', () => {
    expect(REGISTERED_POLICIES.map((p) => p.id)).toEqual([
      'srcla',
      'b0',
      'b1',
      'b2',
      'b2u',
      'b3',
      'b4',
      'b5',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'h7',
    ]);
    expect(REGISTERED_BASELINES).toHaveLength(7);
    expect(REGISTERED_ABLATIONS).toHaveLength(7);
  });

  it('marks B5 and B2u non-deployable, per §11.2', () => {
    const nonDeployable = REGISTERED_POLICIES.filter((p) => !p.deployable).map((p) => p.id);
    expect(nonDeployable.sort()).toEqual(['b2u', 'b5']);
  });

  it('gives each ablation exactly one switch, and SRCLA none', () => {
    expect(Object.keys(REGISTERED_POLICIES.find((p) => p.id === 'srcla')!.disable)).toEqual([]);
    for (const h of REGISTERED_ABLATIONS) {
      const on = Object.entries(h.disable).filter(([, v]) => v === true);
      expect(on).toHaveLength(1);
    }
  });

  it('maps each ablation to its paper component', () => {
    const byId = Object.fromEntries(REGISTERED_ABLATIONS.map((h) => [h.id, h.disable]));
    expect(byId['h1']).toEqual({ capacityCurves: true });
    expect(byId['h2']).toEqual({ uncertainty: true });
    expect(byId['h3']).toEqual({ costGate: true });
    expect(byId['h4']).toEqual({ dynamicReserve: true });
    expect(byId['h5']).toEqual({ dependencyCaps: true });
    expect(byId['h6']).toEqual({ liquidityCap: true });
    expect(byId['h7']).toEqual({ exitableWeight: true });
  });

  it('distinguishes B2 (reserve-matched) from B2u (unreserved) — the P7 correction', () => {
    const b2 = REGISTERED_POLICIES.find((p) => p.id === 'b2')!;
    const b2u = REGISTERED_POLICIES.find((p) => p.id === 'b2u')!;
    expect(b2.disable.reserve).toBeUndefined();
    expect(b2u.disable.reserve).toBe(true);
  });

  it('gives B3 the cost gate that B2 lacks, and takes away dependency + netting', () => {
    const b2 = REGISTERED_POLICIES.find((p) => p.id === 'b2')!;
    const b3 = REGISTERED_POLICIES.find((p) => p.id === 'b3')!;
    expect(b2.disable.costGate).toBe(true);
    expect(b3.disable.costGate).toBeUndefined();
    expect(b3.disable.dependencyCaps).toBe(true);
    expect(b3.disable.netting).toBe(true);
  });

  it('lists all four registered tiers', () => {
    expect(REGISTERED_TIERS).toEqual([
      10_000_000_000n,
      100_000_000_000n,
      1_000_000_000_000n,
      10_000_000_000_000n,
    ]);
  });
});

// ---------------------------------------------------------------------------
// NEW-2: the harness reaches decide()
// ---------------------------------------------------------------------------

describe('runRegisteredEvaluation reaches the kernel', () => {
  it('records a kernel decision hash at every origin for every kernel policy', () => {
    const out = run();
    const days = 40;
    for (const r of out.results) {
      if (r.policy.shape !== 'kernel' && r.policy.shape !== 'hindsight') continue;
      expect(r.decisionHashes).toHaveLength(days);
      expect(r.decisionHashes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    }
  });

  it('changes every kernel policy\'s decisions when the ARTIFACT changes', () => {
    // Only decide() folds the artifact hash into a decision hash. If any row
    // were served by a reimplementation, its hashes would not move.
    const a = run();
    const b = run({ artifact: testArtifact({ artifactHash: 'a-different-artifact' }) });

    const hashesOf = (out: typeof a, id: string): string[] =>
      out.results.find((r) => r.policy.id === id)!.decisionHashes;

    for (const p of REGISTERED_POLICIES) {
      if (p.shape === 'idle' || p.shape === 'frozen-equal-weight') continue;
      expect(hashesOf(a, p.id)).not.toEqual(hashesOf(b, p.id));
    }
  });

  it('runs B0 as a genuine no-op: no decisions, no actions, no cost', () => {
    const b0 = run().results.find((r) => r.policy.id === 'b0')!;
    expect(b0.decisionHashes).toHaveLength(0);
    expect(b0.rebalances).toBe(0);
    expect(b0.replay.totalCosts).toBe(0n);
    expect(b0.replay.totalTurnover).toBe(0n);
  });

  it('deploys capital under SRCLA — the fixture is not a silent all-hold', () => {
    const srcla = run().results.find((r) => r.policy.id === 'srcla')!;
    expect(srcla.rebalances).toBeGreaterThan(0);
    expect(srcla.replay.totalTurnover).toBeGreaterThan(0n);
    const last = srcla.replay.snapshots[srcla.replay.snapshots.length - 1]!;
    expect(last.idleBase).toBeLessThan(TIER);
  });

  it('reports missing tiers and produces a result for every registered policy', () => {
    const out = run();
    // Only one of the four registered tiers was run, and §11.5 fails the
    // gate on a missing tier — so the absence has to be visible.
    expect(out.missingTiers).toEqual([
      100_000_000_000n,
      1_000_000_000_000n,
      10_000_000_000_000n,
    ]);
    // Every policy DID run at the tier that ran.
    for (const p of REGISTERED_POLICIES) {
      expect(out.results.some((r) => r.policy.id === p.id && r.tier === TIER)).toBe(true);
      expect(out.missingPolicyIds).not.toContain(`${p.id}@${TIER}`);
    }
  });

  // The absence-reads-as-success shape, at the (policy, tier) level: a
  // GLOBAL "was this id seen anywhere" set reports nothing for a policy that
  // ran at one tier and not at the other three, exactly as `TIERS.every(...)`
  // over the tiers present reports nothing for an absent tier.
  it('reports every registered policy as missing at every tier that did not run', () => {
    const out = run();

    expect(out.missingPolicyIds).toHaveLength(
      REGISTERED_POLICIES.length * out.missingTiers.length,
    );
    for (const t of out.missingTiers) {
      for (const p of REGISTERED_POLICIES) {
        expect(out.missingPolicyIds).toContain(`${p.id}@${t}`);
      }
    }
  });

  it('reports a policy that ran at some tiers but not all', () => {
    const out = run({ tiers: [TIER, 100_000_000_000n] });

    // srcla ran at two of the four registered tiers: it must still be
    // reported missing at the other two.
    expect(out.results.filter((r) => r.policy.id === 'srcla')).toHaveLength(2);
    expect(out.missingPolicyIds).toContain('srcla@1000000000000');
    expect(out.missingPolicyIds).toContain('srcla@10000000000000');
    expect(out.missingPolicyIds).not.toContain('srcla@10000000000');
  });

  it('flags the artifact as provisional when it is not calibrated', () => {
    expect(run().provisional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ablations must actually ablate — and be reported inert when they do not
// ---------------------------------------------------------------------------

describe('ablation inertness is measured, not assumed', () => {
  it('H5 is inert with no registered dependency group, and bites once one exists', () => {
    const noGroups = run();
    const h5NoGroups = noGroups.results.find((r) => r.policy.id === 'h5')!;
    expect(h5NoGroups.inertVsSrcla).toBe(true);

    const withGroups = run({
      config: harnessConfig({
        defaultMarket: {
          capBps: 5_000,
          absoluteCapBase: 10n ** 15n,
          maxLossBps: 50,
          dependencyGroupIds: ['usdc-lending'],
        },
        dependencyGroups: [
          {
            id: 'usdc-lending',
            // 30% of NAV across all three venues jointly — genuinely binding.
            capBps: 3_000,
            absoluteCapBase: 10n ** 15n,
            members: [...VENUES],
          },
        ],
      }),
    });
    const h5WithGroups = withGroups.results.find((r) => r.policy.id === 'h5')!;
    expect(h5WithGroups.inertVsSrcla).toBe(false);
  });

  it('H1 and H4 both bite on this fixture', () => {
    const out = run();
    for (const id of ['h1', 'h4']) {
      const r = out.results.find((x) => x.policy.id === id)!;
      expect({ id, inert: r.inertVsSrcla }).toEqual({ id, inert: false });
    }
  });

  it('H7 bites once a venue the vault is already in loses its liquidity', () => {
    // phi < 1 needs a target LARGER than the venue's exit capacity, which
    // only happens once the vault holds a position and the venue's cash
    // collapses under it. On an abundant-liquidity fixture phi is 1
    // everywhere and H7 is genuinely inert — which the harness would report
    // rather than pass off as a component contribution.
    expect(run().results.find((r) => r.policy.id === 'h7')!.inertVsSrcla).toBe(true);

    const drying = run({
      dataset: makeDataset(40, undefined, (venue, day) =>
        venue === 'compound-usdc' && day >= 20 ? { cashBase: 1_000_000_000n } : {},
      ),
    });
    expect(drying.results.find((r) => r.policy.id === 'h7')!.inertVsSrcla).toBe(false);
  });

  it('H2 bites when the calibrated bound is what excludes a venue', () => {
    // The portfolio residual quantile is a flat per-notional hurdle here —
    // the fixture's rates are constant, so the calibration split observes no
    // dispersion, `buildResidualPanel` reports NO CALIBRATION rather than a
    // fabricated zero, and the artifact's registered conservative quantile
    // governs. It can only bite where a venue's marginal horizon return sits
    // below it. Moonwell is put at 5% utilisation (a very low simulated
    // rate) and the quantile is sized between the two venues' marginal
    // returns.
    const out = run({
      dataset: makeDataset(40, undefined, (venue) =>
        venue === 'moonwell-usdc'
          ? { cashBase: 950_000_000_000n, borrowsBase: 50_000_000_000n, utilizationE18: (WAD * 5n) / 100n }
          : {},
      ),
      artifact: testArtifact({ portfolioResidualQuantileWad: -1n * 10n ** 15n }),
    });
    const srcla = out.results.find((r) => r.policy.id === 'srcla')!;
    const h2 = out.results.find((r) => r.policy.id === 'h2')!;

    // The fallback really is the operative path here, not the panel.
    expect(out.artifact.residualPanel).toBeUndefined();

    // Non-vacuity: SRCLA must still be deploying something, or "H2 differs"
    // would just mean "SRCLA held and H2 did not".
    expect(srcla.rebalances).toBeGreaterThan(0);
    expect(h2.inertVsSrcla).toBe(false);
  });

  it('builds a calibrated residual panel when the calibration split shows dispersion', () => {
    // The same harness over a dataset whose rates actually move: the panel
    // exists, is drawn from the calibration split only, and carries a
    // non-zero residual for the venue that moved.
    const out = run({
      dataset: makeDataset(40, (venue, day) =>
        venue === 'aave-usdc' ? (day < 20 ? (WAD * 8n) / 100n : (WAD * 2n) / 100n) : (WAD * 4n) / 100n,
      ),
    });

    const panel = out.artifact.residualPanel!;
    expect(panel).toBeDefined();
    expect(panel.marketIds).toContain('aave-usdc');
    expect(panel.rows.length).toBeGreaterThan(0);

    const aaveIdx = panel.marketIds.indexOf('aave-usdc');
    expect(panel.rows.some((r) => r[aaveIdx] !== 0n)).toBe(true);

    // §7.3's no-look-ahead boundary: every origin in the panel is inside the
    // calibration split, not the held-out remainder.
    const splitSeconds = Math.floor(
      out.results[0]!.replay.snapshots[Math.floor(40 * 0.7)]!.timestamp.getTime() / 1000,
    );
    for (const t of panel.originsSeconds) expect(t).toBeLessThanOrEqual(splitSeconds);
  });

  it('H6 bites when a venue is past its utilisation kink', () => {
    const stressed = run({
      // 95% utilisation with 4,000 USDC of cash puts P5's structural cap at
      // 4,000 * (1-0.95)/(1-0.80) = 1,000 USDC, BELOW the 50%-of-NAV
      // percentage cap of 5,000 USDC — so the structural cap is the binding
      // one and removing it must change the target.
      dataset: makeDataset(40, undefined, (venue) =>
        venue === 'aave-usdc'
          ? { utilizationE18: (WAD * 95n) / 100n, cashBase: 4_000_000_000n }
          : {},
      ),
    });
    const h6 = stressed.results.find((r) => r.policy.id === 'h6')!;
    expect(h6.inertVsSrcla).toBe(false);
  });

  it('B5 hindsight ranks on the realized future, not the displayed present', () => {
    // The best venue today is the worst over the coming week and vice versa.
    const flipping = makeDataset(40, (venue, day) => {
      const early = day < 20;
      if (venue === 'aave-usdc') return early ? (WAD * 8n) / 100n : (WAD * 1n) / 100n;
      if (venue === 'moonwell-usdc') return early ? (WAD * 1n) / 100n : (WAD * 8n) / 100n;
      return (WAD * 4n) / 100n;
    });
    const out = run({ dataset: flipping });
    const b5 = out.results.find((r) => r.policy.id === 'b5')!;
    const b1 = out.results.find((r) => r.policy.id === 'b1')!;
    expect(b5.decisionHashes).not.toEqual(b1.decisionHashes);
  });
});

// ---------------------------------------------------------------------------
// NEW-14 at the harness level
// ---------------------------------------------------------------------------

describe('the harness measures withdrawal success for every policy', () => {
  it('attempts redemptions and reports a measured rate, never null', () => {
    const out = run();
    for (const r of out.results) {
      expect(r.replay.withdrawals.length).toBeGreaterThan(0);
      expect(r.replay.withdrawalSuccessRate).not.toBeNull();
    }
  });

  it('says whether the withdrawal series was observed or a registered schedule', () => {
    expect(run().withdrawalSource).toBe('registered-schedule');

    const withObserved = run({
      dataset: {
        ...makeDataset(),
        withdrawals: [
          { timestampSeconds: Math.floor(Date.UTC(2026, 0, 10) / 1000), assetsBase: 1_000_000_000n },
        ],
      },
    });
    expect(withObserved.withdrawalSource).toBe('observed');
  });
});

describe('buildWithdrawalSchedule', () => {
  it('scales an observed event from the reference NAV to the tier', () => {
    const ds: EvaluationDataset = {
      ...makeDataset(10),
      // The fixture's market rows carry totalAssetsBase = TIER, so a
      // TIER-sized withdrawal is 100% of NAV.
      withdrawals: [{ timestampSeconds: Math.floor(Date.UTC(2026, 0, 3) / 1000), assetsBase: TIER / 10n }],
    };
    const small = buildWithdrawalSchedule(ds, TIER);
    const large = buildWithdrawalSchedule(ds, TIER * 100n);
    expect(small.source).toBe('observed');
    expect(small.requests[0]!.assetsBase).toBe(TIER / 10n);
    expect(large.requests[0]!.assetsBase).toBe((TIER / 10n) * 100n);
    expect(small.requests[0]!.snapshotIndex).toBe(2);
  });

  it('falls back to a labelled registered schedule when nothing was observed', () => {
    // makeDataset is DAILY, so a 7-day cadence lands on indices 7/14/21/28 --
    // which is exactly why the old snapshot-counted API looked correct here.
    const s = buildWithdrawalSchedule(makeDataset(30), TIER, {
      redemptionBps: 500,
      cadenceSeconds: 7 * 86_400,
    });
    expect(s.source).toBe('registered-schedule');
    expect(s.requests.map((r) => r.snapshotIndex)).toEqual([7, 14, 21, 28]);
    expect(s.requests.every((r) => r.assetsBase === TIER / 20n)).toBe(true);
  });

  it('holds its cadence in TIME, so an hourly dataset is not redeemed hourly', () => {
    // The regression this exists for. The cadence used to be counted in
    // SNAPSHOTS, so `7` meant "weekly" on this daily fixture and "every seven
    // hours" on the hourly dataset the archive backfill produces: 5% of NAV
    // seventeen times a day, ~240% of the vault demanded inside one 14-day
    // reserve horizon. §8.1 then correctly required the whole vault in cash,
    // nothing was ever deployable, and all seventeen policies realised
    // exactly 0.000% net APY -- a total that reads like a policy result and
    // is a unit error in the harness.
    const start = Date.UTC(2026, 0, 1);
    const hourly: EvaluationDataset = {
      manifestId: 'm',
      labels: [],
      snapshots: Array.from({ length: 24 * 30 }, (_, i) => {
        const timestamp = new Date(start + i * 3_600_000);
        return {
          index: i,
          timestamp,
          blockHash: `0x${i.toString(16).padStart(64, '0')}`,
          snapshots: VENUES.map((v) => market(v, timestamp, {})),
        };
      }),
    };

    const s = buildWithdrawalSchedule(hourly, TIER, {
      redemptionBps: 500,
      cadenceSeconds: 7 * 86_400,
    });
    // 30 days at a 7-day cadence: four redemptions, not 102.
    expect(s.requests).toHaveLength(4);
    expect(s.requests.map((r) => r.snapshotIndex)).toEqual([168, 336, 504, 672]);
    // Total demand over the window stays a small fraction of the tier.
    const demanded = s.requests.reduce((a, r) => a + r.assetsBase, 0n);
    expect(demanded).toBe((TIER * 4n) / 20n);
    expect(demanded).toBeLessThan(TIER);
  });

  it('sizes the registered schedule against LIVE NAV, not the initial tier', () => {
    // The defect this replaces: a fixed 5% of the tier every 7 days demands
    // 190% of the vault over a 267-day era. The cohort's shares are exhausted
    // after 20 of 38 redemptions and the remaining 18 fail for want of SHARES,
    // not liquidity -- which reported an identical 52.6% withdrawal-success
    // rate for all fifteen policies at all four tiers, including the all-cash
    // baseline that cannot fail a redemption for liquidity reasons, and left
    // the last ~90 days of the era running on an empty vault.
    const s = buildWithdrawalSchedule(makeDataset(30), TIER, {
      redemptionBps: 500,
      cadenceSeconds: 7 * 86_400,
    });
    expect(s.source).toBe('registered-schedule');
    for (const r of s.requests) expect(r.navFractionBps).toBe(500);
  });

  it('cannot demand more than the vault holds, however long the window', () => {
    // A NAV fraction is self-limiting by construction: each request takes 5%
    // of what remains, so cumulative demand converges instead of growing
    // linearly with the number of redemptions.
    const long = buildWithdrawalSchedule(makeDataset(300), TIER, {
      redemptionBps: 500,
      cadenceSeconds: 7 * 86_400,
    });
    expect(long.requests.length).toBeGreaterThan(38);

    let nav = TIER;
    let demanded = 0n;
    for (const r of long.requests) {
      const sized = (nav * BigInt(r.navFractionBps!)) / 10_000n;
      demanded += sized;
      nav -= sized;
    }
    // Under the OLD fixed-fraction rule this would be 42 x 5% = 210% of the
    // tier. Under a NAV fraction it stays below the vault, always.
    expect(demanded).toBeLessThan(TIER);
    expect(nav).toBeGreaterThan(0n);
  });

  it('demands the same total from a daily and an hourly view of one window', () => {
    // The invariant the snapshot-counted version broke: the schedule
    // describes user behaviour over TIME and must not change because the
    // observer sampled the market more often.
    const start = Date.UTC(2026, 0, 1);
    const hourly: EvaluationDataset = {
      manifestId: 'm',
      labels: [],
      snapshots: Array.from({ length: 24 * 30 }, (_, i) => {
        const timestamp = new Date(start + i * 3_600_000);
        return {
          index: i,
          timestamp,
          blockHash: `0x${i.toString(16).padStart(64, '0')}`,
          snapshots: VENUES.map((v) => market(v, timestamp, {})),
        };
      }),
    };
    const opts = { redemptionBps: 500, cadenceSeconds: 7 * 86_400 };
    const daily = buildWithdrawalSchedule(makeDataset(30), TIER, opts);
    const perHour = buildWithdrawalSchedule(hourly, TIER, opts);
    const total = (s: { requests: Array<{ assetsBase: bigint }> }): bigint =>
      s.requests.reduce((a, r) => a + r.assetsBase, 0n);
    expect(total(perHour)).toBe(total(daily));
  });
});

// ---------------------------------------------------------------------------
// Inputs: labels, pinning, calibration, action translation
// ---------------------------------------------------------------------------

describe('deriveCompletedLabels', () => {
  const ds = makeDataset(30);

  it('makes a label available only after horizon + availability lag', () => {
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 900);
    const first = labels[0]!;
    expect(first.availableAtSeconds).toBe(first.originSeconds + HORIZON + 900);
    expect(first.horizonEndSeconds).toBe(first.originSeconds + HORIZON);
  });

  it('shows no label to an origin before its availability time', () => {
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 900);
    const originSeconds = Math.floor(ds.snapshots[3]!.timestamp.getTime() / 1000);
    for (const l of labelsAvailableAt(labels, originSeconds)) {
      expect(l.availableAtSeconds).toBeLessThanOrEqual(originSeconds);
      expect(l.horizonEndSeconds).toBeLessThan(originSeconds);
    }
  });

  it('carries the regime the venue was in at the origin', () => {
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 900);
    expect(labels.every((l) => l.regimeId === `digest-${l.marketId}`)).toBe(true);
  });

  it('converts the mean observed rate to a horizon return', () => {
    const flat = makeDataset(30, () => (WAD * 6n) / 100n);
    const labels = deriveCompletedLabels(flat.snapshots, HORIZON, 0);
    const expected = (((WAD * 6n) / 100n) * BigInt(HORIZON)) / 31_557_600n;
    expect(labels[0]!.realizedReturnWad).toBe(expected);
  });

  it('emits nothing for a window that never reaches the horizon end', () => {
    // Three daily snapshots cannot complete a 7-day horizon.
    expect(deriveCompletedLabels(makeDataset(3).snapshots, HORIZON, 0)).toHaveLength(0);
  });
});

describe('calibrateResidualQuantiles', () => {
  const label = (marketId: string, r: bigint) => ({
    marketId,
    regimeId: 'x',
    originSeconds: 0,
    horizonSeconds: HORIZON as 604800,
    horizonEndSeconds: HORIZON,
    availableAtSeconds: HORIZON,
    realizedReturnWad: r,
    realizedMinCashBase: 0n,
    originCashBase: 0n,
  });

  it('returns a non-positive quantile', () => {
    const labels = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 100n].map((r) => label('aa', r * 10n ** 12n));
    const q = calibrateResidualQuantiles(labels, 0.95, 3);
    expect(q['aa']).toBeLessThan(0n);
  });

  it('gives 0n — not a fabricated dispersion — below minObservations', () => {
    const q = calibrateResidualQuantiles([label('aa', 1n), label('aa', 2n)], 0.95, 3);
    expect(q['aa']).toBe(0n);
  });

  it('widens as the residuals widen', () => {
    const tight = [10n, 11n, 12n, 13n, 14n].map((r) => label('aa', r * 10n ** 12n));
    const wide = [1n, 11n, 12n, 13n, 40n].map((r) => label('aa', r * 10n ** 12n));
    const qt = calibrateResidualQuantiles(tight, 0.95, 3)['aa']!;
    const qw = calibrateResidualQuantiles(wide, 0.95, 3)['aa']!;
    expect(qw).toBeLessThan(qt);
  });
});

describe('prepareArtifact', () => {
  it('pins every IDENTITY observed, not the first digest seen', () => {
    // This test used to assert the opposite -- "pins the FIRST observed
    // configuration digest" -- and that was the defect. Governance
    // re-parameterises these venues routinely (the registered window holds 6
    // Compound, 14 Aave and 11 Moonwell parameter regimes), so pinning day
    // one's digest made every venue permanently inadmissible at its first
    // rate change and all seventeen policies realised 0.000% net APY. The
    // digest is `identity|parameters`; only the identity half is pinned, and
    // every identity observed during calibration is registered.
    const ds = makeDataset(10);
    for (let d = 5; d < 10; d++) {
      ds.snapshots[d]!.snapshots[0]!.configDigest = 'aave:0xpool|different-params';
    }
    for (let d = 0; d < 5; d++) {
      ds.snapshots[d]!.snapshots[0]!.configDigest = 'aave:0xpool|original-params';
    }
    const a = prepareArtifact(testArtifact(), ds, [], 0.7);
    // A re-parameterisation adds NO new identity: one pin, not two.
    expect(a.pinnedConfigDigests['aave-usdc']).toBe('aave:0xpool');
  });

  it('registers BOTH identities when the market contract itself changes', () => {
    const ds = makeDataset(10);
    for (let d = 0; d < 5; d++) {
      ds.snapshots[d]!.snapshots[0]!.configDigest = 'aave:0xold|p';
    }
    for (let d = 5; d < 10; d++) {
      ds.snapshots[d]!.snapshots[0]!.configDigest = 'aave:0xnew|p';
    }
    const a = prepareArtifact(testArtifact(), ds, [], 0.7);
    expect(a.pinnedConfigDigests['aave-usdc']!.split(',').sort()).toEqual([
      'aave:0xnew',
      'aave:0xold',
    ]);
  });

  it('returns a REGISTERED artifact untouched — it is frozen', () => {
    // Against a held-out era, re-fitting would train the policy on the data
    // the run exists to test, which is the look-ahead §2.2 rejects. It would
    // also discard the calibration era's registration, so the manifest's
    // artifact hash would describe something the run did not use.
    const registered = { ...testArtifact() };
    delete (registered as { _provisional?: string })._provisional;

    const ds = makeDataset(20, (venue, day) =>
      venue === 'aave-usdc' ? (WAD * BigInt(1 + (day % 7))) / 100n : (WAD * 4n) / 100n,
    );
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 0);
    const out = prepareArtifact(registered, ds, labels, 0.5);

    expect(out).toBe(registered);
    expect(out.pinnedConfigDigests).toEqual(registered.pinnedConfigDigests);
    expect(out.residualQuantileWadByMarket).toEqual(registered.residualQuantileWadByMarket);
  });

  it('still calibrates a PROVISIONAL artifact, which has nothing to preserve', () => {
    const ds = makeDataset(20, (venue, day) =>
      venue === 'aave-usdc' ? (WAD * BigInt(1 + (day % 7))) / 100n : (WAD * 4n) / 100n,
    );
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 0);
    const base = testArtifact();
    expect(base._provisional).toBeDefined();
    const out = prepareArtifact(base, ds, labels, 0.5);
    expect(out).not.toBe(base);
    expect(Object.keys(out.pinnedConfigDigests).length).toBeGreaterThan(0);
  });

  it('calibrates on the calibration split only', () => {
    // Rates must MOVE, or every residual is zero and both splits calibrate
    // to 0n regardless of which labels they saw.
    const ds = makeDataset(20, (venue, day) =>
      venue === 'aave-usdc' ? (WAD * BigInt(1 + (day % 7))) / 100n : (WAD * 4n) / 100n,
    );
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 0);
    const withHeldOut = prepareArtifact(testArtifact(), ds, labels, 0.5);
    const withEverything = prepareArtifact(testArtifact(), ds, labels, 1.0);
    // Non-vacuity: the two splits see different label counts, so a
    // calibration that ignored the split would produce identical quantiles.
    const splitSeconds = Math.floor(ds.snapshots[10]!.timestamp.getTime() / 1000);
    expect(labels.filter((l) => l.availableAtSeconds <= splitSeconds).length).toBeLessThan(
      labels.length,
    );
    expect(withHeldOut.residualQuantileWadByMarket).not.toEqual(
      withEverything.residualQuantileWadByMarket,
    );
  });

  // §7.2's SECOND registered target (audit NEW-11): before this it was never
  // registered, calibrated or applied — `realizedMinCashBase` existed as a
  // label column with no consumer anywhere in src.
  it('calibrates the second (withdrawable-cash) target on the same split', () => {
    // Cash must MOVE for a residual to exist at all.
    const ds = makeDataset(20, undefined, (venue, day) =>
      venue === 'aave-usdc' ? { cashBase: BigInt(1_000_000 - day * 20_000) * 1_000_000n } : {},
    );
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 0);
    const a = prepareArtifact({ ...testArtifact(), minObservations: 1 }, ds, labels, 1.0);
    expect(a.cashResidualQuantileWadByMarket['aave-usdc']).toBeLessThan(0n);
  });

  it('gives the second target the same calibration/held-out split as the first', () => {
    // The drain happens only in the HELD-OUT half, so a calibration that
    // ignored the split would see it and produce the same quantile as one
    // trained on everything.
    const ds = makeDataset(20, undefined, (venue, day) =>
      venue === 'aave-usdc'
        ? { cashBase: (day >= 15 ? 100_000n : 1_000_000n) * 1_000_000n }
        : {},
    );
    const labels = deriveCompletedLabels(ds.snapshots, HORIZON, 0);
    const withHeldOut = prepareArtifact({ ...testArtifact(), minObservations: 1 }, ds, labels, 0.5);
    const withEverything = prepareArtifact({ ...testArtifact(), minObservations: 1 }, ds, labels, 1.0);
    expect(withHeldOut.cashResidualQuantileWadByMarket).not.toEqual(
      withEverything.cashResidualQuantileWadByMarket,
    );
  });
});

describe('targetToActions', () => {
  it('emits divests before deploys, in sorted market order', () => {
    const target = new Map([
      ['zz', 300n],
      ['aa', 100n],
      ['mm', 0n],
    ]);
    const positions = new Map([
      ['aa', 500n],
      ['mm', 200n],
      ['zz', 0n],
    ]);
    expect(targetToActions(target, positions)).toEqual([
      { kind: 'divest', adapter: 'aa', amount: 400n },
      { kind: 'divest', adapter: 'mm', amount: 200n },
      { kind: 'deploy', adapter: 'zz', amount: 300n },
    ]);
  });

  it('emits nothing when the target is already held', () => {
    const m = new Map([['aa', 100n]]);
    expect(targetToActions(m, new Map(m))).toEqual([]);
  });
});

describe('frozenEqualWeightTarget (B4)', () => {
  it('returns the already-frozen target unchanged', () => {
    const frozen = new Map([['aa', 1n]]);
    const same = frozenEqualWeightTarget(
      null as never,
      null as never,
      frozen,
      { quantile: 0.95, horizonSeconds: DAY },
    );
    expect(same).toBe(frozen);
  });

  it('never moves once chosen, even as rates change', () => {
    const flipping = makeDataset(40, (venue, day) =>
      venue === 'aave-usdc' && day > 20 ? (WAD * 1n) / 100n : (WAD * 6n) / 100n,
    );
    // No redemptions here: a redemption shrinks NAV, and a FROZEN-WEIGHT
    // allocation legitimately re-deploys to restore its weights. This test
    // is about re-RANKING, so the vault is left undisturbed.
    const b4 = run({
      dataset: flipping,
      withdrawals: { requests: [], source: 'registered-schedule' },
    }).results.find((r) => r.policy.id === 'b4')!;
    // One allocation, then nothing: the old b4-fixed-robust.ts re-sorted by
    // live rate on every call, which was neither fixed nor robust.
    expect(b4.rebalances).toBe(1);
  });
});

describe('decideOptsForTier', () => {
  it('scales the quantum with the tier and samples the whole deployable range', () => {
    const small = decideOptsForTier(DEFAULT_DECIDE_OPTS, 10_000_000_000n, 100);
    const large = decideOptsForTier(DEFAULT_DECIDE_OPTS, 10_000_000_000_000n, 100);
    expect(small.quantumBase).toBe(100_000_000n);
    expect(large.quantumBase).toBe(small.quantumBase * 1000n);
    expect(small.maxCurvePoints).toBe(101);
    // The curve must reach 100% of NAV, or rateAt clamps and the optimiser
    // cannot see capacity decay past the sampled range.
    expect(small.quantumBase * BigInt(small.maxCurvePoints - 1)).toBe(10_000_000_000n);
  });

  it('never produces a zero quantum', () => {
    expect(decideOptsForTier(DEFAULT_DECIDE_OPTS, 10n, 100).quantumBase).toBe(1n);
  });
});

describe('buildHindsightRates', () => {
  it('averages forward over the horizon, not backward', () => {
    const rising = makeDataset(20, (venue, day) =>
      venue === 'aave-usdc' ? (WAD * BigInt(day)) / 100n : (WAD * 4n) / 100n,
    );
    const rates = buildHindsightRates(rising.snapshots, HORIZON);
    // Origin day 0 sees days 0..7 -> mean of 0..7 = 3.5% (integer WAD math).
    const expected = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n].reduce((s, d) => s + (WAD * d) / 100n, 0n) / 8n;
    expect(rates.get('0:aave-usdc')).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// buildDecisionInput: the two headroom fields are NOT the same quantity
// ---------------------------------------------------------------------------

describe('buildDecisionInput headroom fields', () => {
  const snapshot = () => makeDataset(1).snapshots[0]!;
  const state = () => {
    const s = createInitialState(TIER);
    s.strategyBalances = new Map([['aave-usdc', 2_000_000_000n]]);
    return s;
  };

  it('reports the venue exit capacity, not the current position\'s exit', () => {
    const input = buildDecisionInput(state(), snapshot(), [], [], harnessConfig(), {
      timestampSeconds: null,
      turnoverWindowBase: 0n,
      recentMoves: [],
    });
    const aave = input.markets.find((m) => m.marketId === 'aave-usdc')!;
    const moonwell = input.markets.find((m) => m.marketId === 'moonwell-usdc')!;

    // 400,000 USDC of venue cash, whatever the vault currently holds there.
    expect(aave.maxWithdrawableBase).toBe(400_000_000_000n);
    // And it is NOT min(position, cash): the vault holds only 2,000 USDC here,
    // and a venue with a zero position must not report a zero exit capacity —
    // exitableFraction(x, 0) = 0 would zero the objective for every candidate.
    expect(aave.maxWithdrawableBase).not.toBe(aave.positionBase);
    expect(moonwell.positionBase).toBe(0n);
    expect(moonwell.maxWithdrawableBase).toBeGreaterThan(0n);
  });

  it('does not equate deployable headroom with exit capacity', () => {
    const input = buildDecisionInput(state(), snapshot(), [], [], harnessConfig(), {
      timestampSeconds: null,
      turnoverWindowBase: 0n,
      recentMoves: [],
    });
    const aave = input.markets.find((m) => m.marketId === 'aave-usdc')!;

    // Supply headroom is NOT observed, so the registered absolute cap governs.
    // Setting it to venue cash instead would make maxDeployable == maxWithdrawable
    // for every venue, and P4's phi could then never be anything but 1 — H7
    // would be an ablation that removes nothing by construction.
    expect(aave.maxDeployableBase).toBe(harnessConfig().defaultMarket.absoluteCapBase);
    expect(aave.maxDeployableBase).not.toBe(aave.maxWithdrawableBase);
  });
});

// ---------------------------------------------------------------------------
// buildDecisionInput: the LIVE rate-model seams (E1b, 2026-09-10)
//
// `MarketObservation.irmParams` existed and NOTHING FILLED IT, so every
// Compound and Moonwell curve in every replay came from
// `DEFAULT_COMPOUND_CONFIG` / `DEFAULT_MOONWELL_CONFIG` -- measured at
// 7.5689 pp MAE and 7.2538 pp MAE respectively against the archive's own
// stored supply rate over the calibration era. These tests pin that the
// archive's per-origin reading now reaches the kernel, in the right seam for
// each protocol's model SHAPE, and that a partial reading is refused rather
// than half-populated.
// ---------------------------------------------------------------------------

describe('buildDecisionInput rate-model seams', () => {
  const IRM = {
    irmBaseRateWad: 0n,
    irmKinkRay: (10n ** 27n * 90n) / 100n,
    irmSlopeLowWad: 54_036_986_297_479_200n,
    irmSlopeHighWad: 3_036_078_082_168_372_800n,
    reserveFactorBps: 1000,
  };
  const AAVE_ONLY = {
    irmOptimalUtilizationRay: (10n ** 27n * 90n) / 100n,
    irmMaxUtilizationRay: 10n ** 27n,
  };

  const inputWith = (extra: (venue: string) => Partial<MarketSnapshot>) =>
    buildDecisionInput(
      createInitialState(TIER),
      makeDataset(1, undefined, extra).snapshots[0]!,
      [],
      [],
      harnessConfig(),
      { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
    );

  it('routes a kinked reading into irmParams for compound and moonwell, and not into aaveIrmParams', () => {
    const input = inputWith((v) => (v === 'aave-usdc' ? {} : IRM));
    for (const marketId of ['compound-usdc', 'moonwell-usdc']) {
      const m = input.markets.find((x) => x.marketId === marketId)!;
      expect(m.irmParams).toEqual({
        baseRateWad: IRM.irmBaseRateWad,
        kinkRay: IRM.irmKinkRay,
        slopeLowWad: IRM.irmSlopeLowWad,
        slopeHighWad: IRM.irmSlopeHighWad,
        reserveFactorBps: IRM.reserveFactorBps,
      });
      expect(m.aaveIrmParams).toBeUndefined();
    }
  });

  it('routes an Aave reading into aaveIrmParams ONLY -- irmParams on an Aave market is a throw', () => {
    // `resolveConfig` throws if an Aave market supplies irmParams, so this is
    // not a stylistic preference: populating the wrong seam here would make
    // every Aave origin of every replay raise.
    const input = inputWith((v) => (v === 'aave-usdc' ? { ...IRM, ...AAVE_ONLY } : {}));
    const aave = input.markets.find((m) => m.marketId === 'aave-usdc')!;
    expect(aave.irmParams).toBeUndefined();
    expect(aave.aaveIrmParams).toBeDefined();
    expect(aave.aaveIrmParams!.optimalUtilizationRay).toBe(AAVE_ONLY.irmOptimalUtilizationRay);
  });

  it('refuses a PARTIAL reading rather than half-populating it', () => {
    // reserveFactorBps missing: on Moonwell it is a multiplicative term in
    // the borrow -> supply conversion, so a half-populated object reading it
    // as 0 would overstate the supply rate by exactly that factor.
    const { reserveFactorBps: _dropped, ...withoutRf } = IRM;
    const input = inputWith((v) => (v === 'moonwell-usdc' ? withoutRf : {}));
    expect(input.markets.find((m) => m.marketId === 'moonwell-usdc')!.irmParams).toBeUndefined();
  });

  it('leaves both seams undefined when the origin carries no reading at all', () => {
    const input = inputWith(() => ({}));
    for (const m of input.markets) {
      expect(m.irmParams).toBeUndefined();
      expect(m.aaveIrmParams).toBeUndefined();
    }
  });
});
