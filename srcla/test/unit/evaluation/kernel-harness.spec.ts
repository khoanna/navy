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
    noTradeBandK: 0,
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
    const s = buildWithdrawalSchedule(makeDataset(30), TIER, { redemptionBps: 500, cadenceSnapshots: 7 });
    expect(s.source).toBe('registered-schedule');
    expect(s.requests.map((r) => r.snapshotIndex)).toEqual([7, 14, 21, 28]);
    expect(s.requests.every((r) => r.assetsBase === TIER / 20n)).toBe(true);
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
  it('pins each market\'s FIRST observed configuration digest', () => {
    const ds = makeDataset(10);
    // The venue re-configures halfway through; §6.2 pins at registration.
    for (let d = 5; d < 10; d++) {
      ds.snapshots[d]!.snapshots[0]!.configDigest = 'changed';
    }
    const a = prepareArtifact(testArtifact(), ds, [], 0.7);
    expect(a.pinnedConfigDigests['aave-usdc']).toBe('digest-aave-usdc');
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
