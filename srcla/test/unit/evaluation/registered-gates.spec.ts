/**
 * The §11.5 release gate over a registered run.
 *
 * The theme these tests exist to defend: ABSENCE MUST FAIL. A missing tier,
 * a (policy, tier) that was not run, a withdrawal rate that was never
 * measured, a comparison the test could not compute, and a fork replay that
 * was never produced must each BLOCK the gate — not be skipped by a check
 * that iterates only over what happens to be present.
 */
import {
  ablationContributions,
  compareToBaseline,
  evaluateRegisteredRelease,
  requiredRuns,
  type ForkReplayResult,
} from '../../../src/evaluation/kernel/gates.js';
import { REGISTERED_TIERS, type PolicyRunResult, type RegisteredEvaluationResult } from '../../../src/evaluation/kernel/harness.js';
import { REGISTERED_POLICIES, SRCLA_POLICY } from '../../../src/evaluation/kernel/registry.js';
import { mulberry32 } from '../../../src/evaluation/metrics/significance.js';
import type { PolicyArtifact } from '../../../src/policy/types.js';
import { runForecastGate } from '../../../src/evaluation/kernel/forecast-gate.js';

const WAD = 10n ** 18n;
const PERIODS = 60;

function artifact(provisional = false): PolicyArtifact {
  const a = {
    artifactHash: '0xartifact',
    policyVersion: 1,
    horizonSeconds: 604_800,
    coverageTarget: 0.95,
    method: 'ew-residual',
    methodParams: {},
    residualQuantileWadByMarket: {},
    portfolioResidualQuantileWad: -1n * 10n ** 13n,
    minObservations: 30,
    availabilityLagSeconds: 900,
    noTradeBandK: 1,
    configDigest: '0xcfg',
    pinnedConfigDigests: {},
  } as PolicyArtifact;
  return provisional ? { ...a, _provisional: 'bootstrap' } : a;
}

/**
 * A share-price path: a persistent common factor shared by every policy plus
 * a per-policy edge. Two policies over the same venues on the same days.
 */
function prices(edge: number, seed: number): bigint[] {
  const rng = mulberry32(seed);
  const common = mulberry32(1234);
  const out = [WAD];
  let level = 0.0002;
  for (let i = 0; i < PERIODS; i++) {
    level = 0.95 * level + 0.05 * 0.0002 + (common() - 0.5) * 0.0005;
    const r = level + edge + (rng() - 0.5) * 0.00007;
    const prev = out[out.length - 1]!;
    out.push(prev + (prev * BigInt(Math.round(r * 1e12))) / 10n ** 12n);
  }
  return out;
}

function run(
  policyId: string,
  tier: bigint,
  opts: {
    edge?: number;
    seed?: number;
    withdrawalSuccessRate?: number | null;
    minStressed?: number;
    inert?: boolean;
    capitalAtWork?: number;
    exitOrigins?: number | null;
    exitCensored?: boolean;
    venueShare?: number;
    policyViolations?: number;
  } = {},
): PolicyRunResult {
  const policy = REGISTERED_POLICIES.find((p) => p.id === policyId) ?? SRCLA_POLICY;
  const path = prices(opts.edge ?? 0, opts.seed ?? 1);
  return {
    policy,
    tier,
    decisionHashes: ['0xd'],
    firstProposal: null,
    rebalances: 1,
    inertVsSrcla: opts.inert ?? false,
    replay: {
      policyId,
      tier,
      cohortId: `tier-${tier}`,
      snapshots: path.map((p, i) => ({
        timestamp: new Date(Date.UTC(2026, 5, 1) + i * 86_400_000),
        totalAssets: tier,
        totalShares: tier,
        sharePriceWad: p,
        totalReturn: 0,
        idleBase: tier,
        stressedLiquidCoverage: 1,
      })),
      realizedNetApy: (opts.edge ?? 0) * 365,
      totalTurnover: 0n,
      withdrawalSuccessRate:
        opts.withdrawalSuccessRate === undefined ? 1 : opts.withdrawalSuccessRate,
      withdrawals: [],
      totalCosts: 0n,
      minStressedLiquidCoverage: opts.minStressed ?? 1,
      coverageDistribution: { min: opts.minStressed ?? 1, p05: opts.minStressed ?? 1, median: 1 },
      // §11.4 deployment metrics — not under test here, so fixed/neutral values.
      capitalAtWorkFraction: opts.capitalAtWork ?? 1,
      deploymentLatencyOrigins: 0,
      idleDragApy: null,
      hurdleBlocks: {},
      // §11.5 sustainability metrics — neutral unless a test asks otherwise.
      timeToFullExitOrigins: opts.exitOrigins === undefined ? 0 : opts.exitOrigins,
      timeToFullExitCensored: opts.exitCensored ?? false,
      venueStressContribution: { 'compound-usdc': opts.venueShare ?? 0.05 },
      displayedVsRealizedGapApy: 0,
      policyViolations: opts.policyViolations ?? 0,
    },
  } as unknown as PolicyRunResult;
}

/** A COMPLETE run: every registered policy at every registered tier. */
function completeResults(
  tweak: (policyId: string, tier: bigint) => Parameters<typeof run>[2] = () => ({}),
): PolicyRunResult[] {
  const out: PolicyRunResult[] = [];
  for (const tier of REGISTERED_TIERS) {
    for (const [i, p] of REGISTERED_POLICIES.entries()) {
      const edge = p.id === SRCLA_POLICY.id ? 0.00006 : 0;
      out.push(run(p.id, tier, { edge, seed: 100 + i, ...tweak(p.id, tier) }));
    }
  }
  return out;
}

function evaluation(overrides: Partial<RegisteredEvaluationResult> = {}): RegisteredEvaluationResult {
  const results = overrides.results ?? completeResults();
  const seenPairs = new Set(results.map((r) => `${r.policy.id}@${r.tier}`));
  const seenTiers = new Set(results.map((r) => r.tier.toString()));
  const missingPolicyIds: string[] = [];
  for (const t of REGISTERED_TIERS) {
    for (const p of REGISTERED_POLICIES) {
      if (!seenPairs.has(`${p.id}@${t}`)) missingPolicyIds.push(`${p.id}@${t}`);
    }
  }
  return {
    results,
    withdrawalSource: 'observed',
    artifact: artifact(),
    provisional: false,
    missingPolicyIds,
    missingTiers: REGISTERED_TIERS.filter((t) => !seenTiers.has(t.toString())),
    // §11.5's forecast gate over the same artifact. These fixtures carry no
    // labels, so every measured check reports NOT PRODUCED — which is the
    // right answer for a fixture and is why the POLICY gate is what these
    // specs assert on.
    forecastGate: runForecastGate(artifact(), []),
    ...overrides,
  };
}

/** Every fork replay the registered protocol requires, all successful. */
function completeForkResults(): ForkReplayResult[] {
  return requiredRuns().map((key) => {
    const [policyId, tier] = key.split('@');
    return {
      policyId: policyId!,
      tier: BigInt(tier!),
      prestateBlock: 30_000_000,
      executed: true,
      detail: 'ok',
    };
  });
}

const named = (r: ReturnType<typeof evaluateRegisteredRelease>, name: string) =>
  r.checks.find((c) => c.name === name)!;

/** The yield gate, matched on its prefix so the registered margin can move. */
const nonInferiorityCheck = (r: ReturnType<typeof evaluateRegisteredRelease>) =>
  r.checks.find((c) => c.name.startsWith('Non-inferior'))!;

/** The two-sided statistic, REPORTED since v0.8 rather than gating. */
const DISTINGUISHABILITY = 'Diagnostic: statistical distinguishability from every sustainable baseline';

/**
 * P20/P21 fixture: a COMPLETE evaluation with a few named policies nudged
 * directly on the replay fields those tests care about
 * (`minStressedLiquidCoverage`, `withdrawalSuccessRate`, `realizedNetApy`,
 * `inertVsSrcla`), everything else left at `completeResults()`'s neutral
 * defaults.
 */
function runResult(
  overrides: Record<
    string,
    Partial<{
      minStressedLiquidCoverage: number;
      withdrawalSuccessRate: number | null;
      realizedNetApy: number;
      inertVsSrcla: boolean;
      capitalAtWork: number;
      exitOrigins: number | null;
      exitCensored: boolean;
      venueShare: number;
    }>
  >,
): RegisteredEvaluationResult {
  const results = completeResults((id) => {
    const o = overrides[id];
    if (o === undefined) return {};
    return {
      ...(o.minStressedLiquidCoverage !== undefined ? { minStressed: o.minStressedLiquidCoverage } : {}),
      ...(o.withdrawalSuccessRate !== undefined ? { withdrawalSuccessRate: o.withdrawalSuccessRate } : {}),
      ...(o.inertVsSrcla !== undefined ? { inert: o.inertVsSrcla } : {}),
      ...(o.capitalAtWork !== undefined ? { capitalAtWork: o.capitalAtWork } : {}),
      ...(o.exitOrigins !== undefined ? { exitOrigins: o.exitOrigins } : {}),
      ...(o.exitCensored !== undefined ? { exitCensored: o.exitCensored } : {}),
      ...(o.venueShare !== undefined ? { venueShare: o.venueShare } : {}),
    };
  }).map((r) => {
    const o = overrides[r.policy.id];
    if (o?.realizedNetApy === undefined) return r;
    return { ...r, replay: { ...r.replay, realizedNetApy: o.realizedNetApy } };
  });
  return evaluation({ results });
}

/** Alias matching the brief's naming; identical to `evaluateRegisteredRelease`. */
const runRegisteredGate = evaluateRegisteredRelease;

describe('requiredRuns', () => {
  it('is the full cross product of §11.1 tiers and the registered policy set', () => {
    expect(requiredRuns()).toHaveLength(REGISTERED_TIERS.length * REGISTERED_POLICIES.length);
    expect(REGISTERED_TIERS).toHaveLength(4);
    // The tier the published harness dropped.
    expect(REGISTERED_TIERS.map(String)).toContain('10000000000');
  });
});

describe('evaluateRegisteredRelease: completeness', () => {
  it('passes a complete run with fork replays supplied', () => {
    const gate = evaluateRegisteredRelease(evaluation(), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(gate.blockedReasons).toEqual([]);
    expect(gate.pass).toBe(true);
  });

  // NEW-15: gates written `TIERS.every(...)` over the tiers present could
  // never fail on an absent tier. This is that bug, directly.
  it('BLOCKS when the 10,000 tier is absent', () => {
    const withoutSmallest = completeResults().filter((r) => r.tier !== 10_000_000_000n);
    const gate = evaluateRegisteredRelease(evaluation({ results: withoutSmallest }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(gate.pass).toBe(false);
    expect(named(gate, 'Every registered tier ran').passed).toBe(false);
    expect(named(gate, 'Every registered tier ran').detail).toContain('10000000000');
  });

  // A policy present at three tiers and absent at the fourth: a global
  // "was this id seen anywhere" check reports nothing here.
  it('BLOCKS when one policy is missing at ONE tier only', () => {
    const results = completeResults().filter(
      (r) => !(r.policy.id === 'h7' && r.tier === 10_000_000_000_000n),
    );
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(gate.pass).toBe(false);
    expect(named(gate, 'Every registered policy ran at every tier').detail).toContain(
      'h7@10000000000000',
    );
  });

  it('BLOCKS when a baseline is absent entirely', () => {
    const results = completeResults().filter((r) => r.policy.id !== 'b3');
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(named(gate, 'Every registered policy ran at every tier').passed).toBe(false);
  });

  it('BLOCKS on an empty run rather than passing vacuously', () => {
    const gate = evaluateRegisteredRelease(evaluation({ results: [] }), {
      forkResults: completeForkResults(),
    });

    expect(gate.pass).toBe(false);
    expect(gate.blockedReasons).toContain('Every registered tier ran');
    // The two-sided statistic no longer gates (v0.8), so the yield block on
    // an empty run is the non-inferiority check.
    expect(gate.blockedReasons).toContain(nonInferiorityCheck(gate).name);
    expect(gate.blockedReasons).not.toContain(DISTINGUISHABILITY);
  });
});

describe('evaluateRegisteredRelease: safety', () => {
  // NEW-14: `withdrawalSuccessRate` was hardcoded to 1 because no redemption
  // was ever executed, and the >= 0.99 gate passed on it. It must still
  // BLOCK — as NOT DEMONSTRATED, the same reading `sustainabilityAtTier`
  // gives the identical fact, so the report cannot print two verdicts for one
  // measurement.
  it('BLOCKS when the withdrawal success rate was never measured', () => {
    const results = completeResults((id, tier) =>
      id === 'srcla' && tier === 100_000_000_000n ? { withdrawalSuccessRate: null } : {},
    );
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(gate.pass).toBe(false);
    const c = named(gate, 'Safety: withdrawal success measured and met');
    expect(c.passed).toBeNull();
    expect(c.detail).toContain('NOT DEMONSTRATED');
    expect(c.detail).toContain('no redemption was attempted');
  });

  // P20, the same misattribution the coverage check was rescoped to end: a
  // BASELINE that cannot fill a redemption is not SRCLA's failure. The paper
  // records B1 breaching at all four tiers on one era, so this fires on the
  // registered run.
  it('does NOT fail on a BASELINE\'s failed redemption, but reports it', () => {
    const results = completeResults((id) => (id === 'b1' ? { withdrawalSuccessRate: 0.5 } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    const c = named(gate, 'Safety: withdrawal success measured and met');
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/reported \(not gating\): .*b1/);
  });

  it('reports a baseline\'s UNMEASURED rate without blocking on it', () => {
    const results = completeResults((id) => (id === 'b1' ? { withdrawalSuccessRate: null } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    const c = named(gate, 'Safety: withdrawal success measured and met');
    expect(c.passed).toBe(true);
    expect(c.detail).toContain('b1');
    expect(c.detail).toContain('not measured');
  });

  it('BLOCKS when a measured withdrawal rate falls below the threshold', () => {
    const results = completeResults((id) => (id === 'srcla' ? { withdrawalSuccessRate: 0.9 } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(named(gate, 'Safety: withdrawal success measured and met').passed).toBe(false);
  });

  it('BLOCKS on insufficient stressed liquid coverage', () => {
    const results = completeResults((id) => (id === 'srcla' ? { minStressed: 0.4 } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(named(gate, 'Safety: stressed liquid coverage').passed).toBe(false);
  });
});

describe('§11.4 capacity infeasibility', () => {
  // srcla alone is sub-threshold at the 10,000,000 tier -- §11.4's 50%-of-TVL
  // demand there ($5,000,000) exceeds the supplied worst-case venue universe
  // ($3,617,388), so no policy could have satisfied it.
  const resultWithLowCoverageAt10M: RegisteredEvaluationResult = evaluation({
    results: completeResults((id, tier) =>
      id === 'srcla' && tier === 10_000_000_000_000n ? { minStressed: 0.4 } : {},
    ),
  });

  // Same shape, but at the 10,000 tier: 50% of TVL there is $5,000, trivially
  // covered by any realistic venue universe -- so a low reading is a genuine
  // policy defect, not a capacity ceiling.
  const resultWithLowCoverageAt10k: RegisteredEvaluationResult = evaluation({
    results: completeResults((id, tier) =>
      id === 'srcla' && tier === 10_000_000_000n ? { minStressed: 0.4 } : {},
    ),
  });

  it('names a tier whose stress demand exceeds the venue universe', () => {
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10M, {
      universeLiquidity: { worstTotalCashBase: 3_617_388_000_000n, observedAtIso: '2026-01-01T00:00:00Z' },
    });
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.detail).toMatch(/CAPACITY_INFEASIBLE/);
    expect(check.detail).toContain('3617388');
  });

  it('does NOT pass — the gate still blocks', () => {
    // P12 must not read as gate-softening. `passed: null` never rolls up.
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10M, {
      universeLiquidity: { worstTotalCashBase: 3_617_388_000_000n, observedAtIso: '2026-01-01T00:00:00Z' },
    });
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.passed).not.toBe(true);
    expect(out.pass).toBe(false);
    expect(out.blockedReasons).toContain('Safety: stressed liquid coverage');
  });

  it('still reports a plain FAIL where the tier IS satisfiable', () => {
    // A small tier with poor coverage is a policy failure, not a capacity one.
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10k, {
      universeLiquidity: { worstTotalCashBase: 100_000_000_000_000n, observedAtIso: '2026-01-01T00:00:00Z' },
    });
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.passed).toBe(false);
    expect(check.detail).not.toMatch(/CAPACITY_INFEASIBLE/);
  });

  it('behaves exactly as before when no universeLiquidity is supplied', () => {
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10M);
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.passed).toBe(false);
  });

  it('does not mask a genuine failure at a satisfiable tier with an infeasible tier elsewhere', () => {
    // srcla is sub-threshold at BOTH the 10,000 tier (satisfiable) and the
    // 10,000,000 tier (infeasible against this universe). One genuine
    // failure anywhere in the batch must keep the whole check `false`.
    const mixed = evaluation({
      results: completeResults((id, tier) =>
        id === 'srcla' && (tier === 10_000_000_000n || tier === 10_000_000_000_000n)
          ? { minStressed: 0.4 }
          : {},
      ),
    });
    const out = evaluateRegisteredRelease(mixed, {
      universeLiquidity: { worstTotalCashBase: 3_617_388_000_000n, observedAtIso: '2026-01-01T00:00:00Z' },
    });
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.passed).toBe(false);
    expect(check.detail).not.toMatch(/CAPACITY_INFEASIBLE/);
  });
});

describe('evaluateRegisteredRelease: attribution', () => {
  it('BLOCKS a provisional artifact', () => {
    const gate = evaluateRegisteredRelease(evaluation({ provisional: true, artifact: artifact(true) }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(named(gate, 'Calibrated artifact').passed).toBe(false);
  });

  it('BLOCKS an ablation whose decisions are byte-identical to SRCLA', () => {
    const results = completeResults((id) => (id === 'h5' ? { inert: true } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(named(gate, 'No inert ablation').passed).toBe(false);
    expect(named(gate, 'No inert ablation').detail).toContain('h5');
  });
});

describe('evaluateRegisteredRelease: statistical criterion', () => {
  // v0.8 REMOVED indistinguishability as a gate. The word "indistinguishab*"
  // appears nowhere in the v0.8 paper and the check is absent from §11.5's
  // rejection list; demanding SRCLA be DISTINGUISHABLE from every sustainable
  // baseline over an 18-43 bps universe is the same unattainable yield
  // criterion non-inferiority replaced, re-entering through a second door.
  // The statistic is still published, because it says how much resolution the
  // data had -- it just does not block.
  it('REPORTS, and does not block on, indistinguishability from a baseline', () => {
    const results = completeResults((id) => (id === 'srcla' ? { edge: 0.0000001 } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    const c = named(gate, DISTINGUISHABILITY);
    expect(c.passed).toBe(false);
    expect(c.gating).toBe(false);
    expect(gate.blockedReasons).not.toContain(DISTINGUISHABILITY);
    // A one-basis-point edge is well inside the registered margin, so the
    // criterion that DOES gate is satisfied and the gate passes.
    expect(nonInferiorityCheck(gate).passed).toBe(true);
    expect(gate.pass).toBe(true);
  });

  it('BLOCKS on the NON-INFERIORITY check when the test could not be computed at all', () => {
    // Raising the minimum above the number of periods available makes every
    // comparison unusable. "Could not test" is not "passed the test".
    const gate = evaluateRegisteredRelease(evaluation(), {
      forkResults: completeForkResults(),
      minPairedObservations: PERIODS + 10,
      bootstrapIterations: 200,
    });

    const c = named(gate, DISTINGUISHABILITY);
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('not usable');

    const ni = nonInferiorityCheck(gate);
    expect(ni.passed).toBeNull();
    expect(gate.blockedReasons).toContain(ni.name);
    expect(gate.pass).toBe(false);
  });

  it('excludes the non-deployable B5 from the comparison set', () => {
    const gate = evaluateRegisteredRelease(evaluation(), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(gate.comparisons.map((c) => c.baselineId)).not.toContain('b5');
    expect(gate.comparisons.map((c) => c.baselineId)).toContain('b0');
  });

  // Renamed by P21 part 2: outperformance was replaced by NON-INFERIORITY at
  // a registered margin. An edge of -0.00006/day is -2.19%/yr, two orders of
  // magnitude outside the 43 bps margin, so it still BLOCKS.
  it('BLOCKS when SRCLA trails a sustainable baseline by more than the margin', () => {
    const results = completeResults((id) => (id === 'srcla' ? { edge: -0.00006 } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(nonInferiorityCheck(gate).passed).toBe(false);
  });
});

describe('evaluateRegisteredRelease: §11.1 fork replay', () => {
  // Absence must stay failure: with no replay supplied the check is NOT
  // PRODUCED and blocks, never quietly skipped.
  it('reports NOT PRODUCED and BLOCKS when no fork replay was supplied', () => {
    const gate = evaluateRegisteredRelease(evaluation(), { minPairedObservations: 20, bootstrapIterations: 200 });

    const c = named(gate, '§11.1 pinned-prestate fork replay');
    expect(c.passed).toBeNull();
    expect(c.detail).toContain('fork-runner.ts');
    expect(gate.pass).toBe(false);
  });

  it('BLOCKS when the fork replay is missing for one (policy, tier)', () => {
    const partial = completeForkResults().slice(1);
    const gate = evaluateRegisteredRelease(evaluation(), {
      forkResults: partial,
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(named(gate, '§11.1 pinned-prestate fork replay').passed).toBe(false);
  });

  it('BLOCKS when a fork replay did not execute', () => {
    const fork = completeForkResults();
    fork[0]!.executed = false;
    fork[0]!.detail = 'reverted: CapExceeded';

    const gate = evaluateRegisteredRelease(evaluation(), {
      forkResults: fork,
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    const c = named(gate, '§11.1 pinned-prestate fork replay');
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('CapExceeded');
  });

  // A HOLD is `executed: true` with NO chain interaction. It must never be
  // counted as an execution, or a policy shape that reported no proposal at
  // all would self-certify the whole gate.
  it('counts HOLDs separately from executions in what it claims', () => {
    const fork = completeForkResults();
    fork[0]!.held = true;

    const c = named(
      evaluateRegisteredRelease(evaluation(), {
        forkResults: fork,
        minPairedObservations: 20,
        bootstrapIterations: 200,
      }),
      '§11.1 pinned-prestate fork replay',
    );
    expect(c.passed).toBe(true);
    expect(c.detail).toContain(`${fork.length - 1} of ${fork.length}`);
    expect(c.detail).toContain('1 proposed nothing at any origin (HOLD');
  });

  // THE DEFECT THIS CHECK EXISTED TO AVOID. A HOLD is `executed: true`, so a
  // run in which SRCLA proposed nothing at every replayed origin had a full
  // completeness set and an empty `notExecuted` list, and the check reported
  // PASS from ZERO chain interaction — a §11.1 pass certifying that the chain
  // accepts an allocation that was never submitted. It is now NOT PRODUCED.
  it('reports NOT PRODUCED and BLOCKS when EVERY SRCLA run held', () => {
    const fork = completeForkResults();
    for (const f of fork) if (f.policyId === SRCLA_POLICY.id) f.held = true;

    const gate = evaluateRegisteredRelease(evaluation(), {
      forkResults: fork,
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });
    const c = named(gate, '§11.1 pinned-prestate fork replay');
    expect(c.passed).toBeNull();
    expect(c.detail).toContain('EVERY ONE held');
    expect(gate.pass).toBe(false);
  });

  // ...and the NOT PRODUCED above is about the ABSENCE of an SRCLA execution,
  // not about holds in general: one surviving non-held SRCLA run still passes.
  it('still passes when SRCLA held at some but not all tiers', () => {
    const fork = completeForkResults();
    const srcla = fork.filter((f) => f.policyId === SRCLA_POLICY.id);
    expect(srcla.length).toBeGreaterThan(1);
    for (const f of srcla.slice(1)) f.held = true;

    const c = named(
      evaluateRegisteredRelease(evaluation(), {
        forkResults: fork,
        minPairedObservations: 20,
        bootstrapIterations: 200,
      }),
      '§11.1 pinned-prestate fork replay',
    );
    expect(c.passed).toBe(true);
  });

  // A baseline that holds is a fact about the baseline: §11.1 asks whether the
  // chain accepts SRCLA's allocation, so the scoping is to SRCLA's own runs.
  it('does not report NOT PRODUCED when only baselines held', () => {
    const fork = completeForkResults();
    for (const f of fork) if (f.policyId !== SRCLA_POLICY.id) f.held = true;

    const c = named(
      evaluateRegisteredRelease(evaluation(), {
        forkResults: fork,
        minPairedObservations: 20,
        bootstrapIterations: 200,
      }),
      '§11.1 pinned-prestate fork replay',
    );
    expect(c.passed).toBe(true);
  });

  // The check's detail is the sentence a reader quotes. It must state the
  // scope of the partial, not a bare count that reads as a full §11.1 pass.
  it('states what was NOT replayed alongside what was', () => {
    const c = named(
      evaluateRegisteredRelease(evaluation(), {
        forkResults: completeForkResults(),
        minPairedObservations: 20,
        bootstrapIterations: 200,
      }),
      '§11.1 pinned-prestate fork replay',
    );
    expect(c.detail).toContain('FIRST proposed rebalance');
    expect(c.detail).toContain('verified-restored pinned prestate');
    expect(c.detail).toContain('NOT claimed');
    expect(c.detail).toContain('single vault NAV');
  });
});

describe('compareToBaseline', () => {
  it('pairs the two after-cost return series and reports both tests', () => {
    const srcla = run('srcla', 100_000_000_000n, { edge: 0.00006, seed: 3 });
    const b0 = run('b0', 100_000_000_000n, { edge: 0, seed: 4 });

    const c = compareToBaseline(srcla, b0, { minPairedObservations: 20, bootstrapIterations: 500 });

    expect(c.test.usable).toBe(true);
    expect(c.test.n).toBe(PERIODS);
    expect(c.bootstrap.usable).toBe(true);
    expect(c.test.meanDifference).toBeGreaterThan(0);
  });

  it('is reproducible', () => {
    const srcla = run('srcla', 100_000_000_000n, { edge: 0.00006, seed: 3 });
    const b0 = run('b0', 100_000_000_000n, { edge: 0, seed: 4 });
    const opts = { minPairedObservations: 20, bootstrapIterations: 500 };

    expect(compareToBaseline(srcla, b0, opts)).toEqual(compareToBaseline(srcla, b0, opts));
  });
});

describe('P20: safety is scoped to SRCLA; comparators are measured, not gating', () => {
  const gateOpts = { minPairedObservations: 20, bootstrapIterations: 200 };

  it('PASSES the safety check when only a BASELINE breaches coverage', () => {
    const out = runResult({
      srcla: { minStressedLiquidCoverage: 1.0 },
      b1: { minStressedLiquidCoverage: 0.878 },
    });
    const gate = runRegisteredGate(out, gateOpts);
    const safety = gate.checks.find((c) => c.name.startsWith('Safety: stressed'))!;
    expect(safety.passed).toBe(true);
    expect(safety.detail).toMatch(/b1/); // reported, not silent
  });

  it('FAILS the safety check when SRCLA breaches coverage', () => {
    const out = runResult({ srcla: { minStressedLiquidCoverage: 0.9 } });
    const gate = runRegisteredGate(out, gateOpts);
    expect(gate.checks.find((c) => c.name.startsWith('Safety: stressed'))!.passed).toBe(false);
  });

  it('EXCLUDES a coverage-breaching baseline from the comparison set', () => {
    const out = runResult({
      srcla: { minStressedLiquidCoverage: 1.0 },
      b1: { minStressedLiquidCoverage: 0.878 },
    });
    const gate = runRegisteredGate(out, gateOpts);
    expect(gate.comparisons.some((c) => c.baselineId === 'b1')).toBe(false);
  });

  it('reports NO ADMISSIBLE COMPARATOR when every candidate comparator is excluded', () => {
    // Every non-SRCLA policy breaches coverage here (baselines AND
    // ablations, since ablations are not yet separated out of this loop --
    // that separation is P21/Task 10). What this test pins down is that
    // "every comparator was excluded on safety grounds" and "no comparison
    // was ever attempted" report DIFFERENT detail strings.
    const out = runResult({
      srcla: { minStressedLiquidCoverage: 1.0 },
      b0: { minStressedLiquidCoverage: 0.5 },
      b1: { minStressedLiquidCoverage: 0.5 },
      b2: { minStressedLiquidCoverage: 0.5 },
      b3: { minStressedLiquidCoverage: 0.5 },
      b4: { minStressedLiquidCoverage: 0.5 },
      h1: { minStressedLiquidCoverage: 0.5 },
      h2: { minStressedLiquidCoverage: 0.5 },
      h3: { minStressedLiquidCoverage: 0.5 },
      h4: { minStressedLiquidCoverage: 0.5 },
      h5: { minStressedLiquidCoverage: 0.5 },
      h6: { minStressedLiquidCoverage: 0.5 },
      h7: { minStressedLiquidCoverage: 0.5 },
      h3d: { minStressedLiquidCoverage: 0.5 },
    });
    const gate = runRegisteredGate(out, gateOpts);
    const distinguishable = gate.checks.find((c) => c.name === DISTINGUISHABILITY)!;
    expect(distinguishable.passed).toBeNull();
    expect(distinguishable.detail).toMatch(/NO ADMISSIBLE COMPARATOR/);

    const nonInferior = nonInferiorityCheck(gate);
    expect(nonInferior.passed).toBeNull();
    expect(nonInferior.detail).toMatch(/NO SUSTAINABLE COMPARATOR/);
  });
});

describe('P21: ablations are §11.3 evidence, not §11.2 comparators', () => {
  it('an ablation is not in the baseline comparison set', () => {
    const out = runResult({ h3: { realizedNetApy: 0.39 } });
    const gate = runRegisteredGate(out, { minPairedObservations: 20, bootstrapIterations: 200 });
    expect(gate.comparisons.some((c) => c.baselineId.startsWith('h'))).toBe(false);
  });

  it('an ablation that beats SRCLA is reported as a NEGATIVE contribution', () => {
    const out = runResult({ srcla: { realizedNetApy: 0.008 }, h3: { realizedNetApy: 0.034 } });
    const contribs = ablationContributions(out);
    const h3 = contribs.find((c) => c.policyId === 'h3' && c.tier === '10000000000')!;
    expect(h3.verdict).toBe('NEGATIVE');
    expect(h3.contributionPp).toBeLessThan(0);
  });

  it('a byte-identical ablation is INERT, not a contribution of either sign', () => {
    const out = runResult({
      srcla: { realizedNetApy: 0.05 },
      h5: { realizedNetApy: 0.05, inertVsSrcla: true },
    });
    const h5 = ablationContributions(out).find((c) => c.policyId === 'h5' && c.tier === '10000000000')!;
    expect(h5.verdict).toBe('INERT');
  });
});

/**
 * P24–P26: sustainability is the PRIMARY, ABSOLUTE release criterion, it is
 * scored behind a demonstration floor, and it does not aggregate over tiers.
 */
describe('§11.5: sustainability first, yield second', () => {
  const gateOpts = { minPairedObservations: 20, bootstrapIterations: 200 };

  it('emits the checks in §11.5 order: demonstration, completeness, sustainability, yield, price', () => {
    const gate = runRegisteredGate(evaluation(), {
      ...gateOpts,
      forkResults: completeForkResults(),
      // Superiority is emitted ONLY when the release claims it, so the order
      // test has to make the claim to see the check.
      claimedSuperiorityDimensions: ['yield'],
    });
    const names = gate.checks.map((c) => c.name);
    const at = (needle: string) => names.findIndex((n) => n.includes(needle));

    expect(at('Demonstration')).toBe(0);
    expect(at('Demonstration')).toBeLessThan(at('Every registered tier ran'));
    expect(at('Every registered policy ran')).toBeLessThan(at('Safety: withdrawal success'));
    expect(at('Sustainability S4')).toBeLessThan(at('Diagnostic: statistical distinguishability'));
    expect(at('scale invariance')).toBeLessThan(at('Non-inferior to every sustainable baseline'));
    expect(at('Non-inferior to every sustainable baseline')).toBeLessThan(at('Superiority: yield'));
    expect(at('Price of unsustainability')).toBe(names.length - 1);
  });

  // The v0.6 run: perfect coverage everywhere, 0.000% realized. It must NOT
  // pass, and it must not report a sustainability verdict at all.
  it('an all-idle SRCLA run reports NOT DEMONSTRATED and every criterion null', () => {
    const out = runResult({ srcla: { capitalAtWork: 0, realizedNetApy: 0, minStressedLiquidCoverage: 1 } });
    const gate = runRegisteredGate(out, { ...gateOpts, forkResults: completeForkResults() });

    expect(named(gate, 'Demonstration: sustainability was demonstrated while deployed').passed).toBe(false);
    expect(named(gate, 'Sustainability S1: complete exit within the registered bound').passed).toBeNull();
    expect(named(gate, 'Sustainability S3: venue-stress share (utilization-ceiling clause NOT EVALUATED)').passed).toBeNull();
    expect(named(gate, 'Sustainability S4: action validity (§11.5 violation classes NOT EVALUATED)').passed).toBeNull();
    expect(gate.scaleInvariant).toBeNull();
    expect(gate.pass).toBe(false);
    expect(gate.sustainability.every((v) => v.sustainable === null)).toBe(true);
  });

  it('a RIGHT-CENSORED exit is NOT DEMONSTRATED, not a published breach', () => {
    const out = runResult({ srcla: { exitOrigins: null, exitCensored: true } });
    const gate = runRegisteredGate(out, { ...gateOpts, forkResults: completeForkResults() });
    const c = named(gate, 'Sustainability S1: complete exit within the registered bound');
    expect(c.passed).toBeNull();
    expect(gate.pass).toBe(false);
  });

  it('a run that never fully exits FAILS S1 even at perfect coverage', () => {
    const out = runResult({ srcla: { exitOrigins: null } });
    const gate = runRegisteredGate(out, { ...gateOpts, forkResults: completeForkResults() });
    const c = named(gate, 'Sustainability S1: complete exit within the registered bound');
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/NEVER/);
  });

  it('a vault that IS the venue fails S3 capacity discipline', () => {
    const out = runResult({ srcla: { venueShare: 0.8 } });
    const gate = runRegisteredGate(out, { ...gateOpts, forkResults: completeForkResults() });
    expect(named(gate, 'Sustainability S3: venue-stress share (utilization-ceiling clause NOT EVALUATED)').passed).toBe(false);
  });

  // P26 on the real B4 shape, applied to SRCLA's own runs: sustainable at
  // three tiers, breaching at the fourth. No average over tiers can see it.
  it('a breach at ONE tier makes the run NOT scale invariant', () => {
    const results = completeResults((id, tier) =>
      id === 'srcla' && tier === 10_000_000_000_000n ? { minStressed: 0.59 } : {},
    );
    const gate = runRegisteredGate(evaluation({ results }), { ...gateOpts, forkResults: completeForkResults() });

    expect(gate.scaleInvariant).toBe(false);
    const c = named(gate, 'Sustainability: scale invariance across every registered tier (P26)');
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('10000000000000');
    expect(gate.pass).toBe(false);
  });

  it('three sustainable tiers and one NOT DEMONSTRATED is null, never a pass', () => {
    const results = completeResults((id, tier) =>
      id === 'srcla' && tier === 10_000_000_000n ? { capitalAtWork: 0.1 } : {},
    );
    const gate = runRegisteredGate(evaluation({ results }), { ...gateOpts, forkResults: completeForkResults() });

    expect(gate.scaleInvariant).toBeNull();
    expect(named(gate, 'Sustainability: scale invariance across every registered tier (P26)').passed).toBeNull();
    expect(gate.pass).toBe(false);
  });
});

/**
 * P24: exactly ONE notion of "does this comparator qualify" exists, and it is
 * `sustainabilityAtTier`. The provisional inline coverage test Tasks 9/10
 * left in the comparison loop is gone.
 */
describe('§11.5 part 3: a breaching comparator is a counterexample, not a baseline', () => {
  const gateOpts = { minPairedObservations: 20, bootstrapIterations: 200 };

  it('excludes an UNDEPLOYED baseline and records WHY', () => {
    const out = runResult({ b0: { capitalAtWork: 0.0, realizedNetApy: 0 } });
    const gate = runRegisteredGate(out, gateOpts);

    expect(gate.comparisons.some((c) => c.baselineId === 'b0')).toBe(false);
    const ex = gate.excludedComparators.filter((e) => e.baselineId === 'b0');
    expect(ex.length).toBeGreaterThan(0);
    expect(ex[0]!.reason).toMatch(/NOT DEMONSTRATED/);
  });

  it('excludes a comparator that cannot exit, not merely one that breaches coverage', () => {
    const out = runResult({ b1: { exitOrigins: null } });
    const gate = runRegisteredGate(out, gateOpts);
    expect(gate.comparisons.some((c) => c.baselineId === 'b1')).toBe(false);
    expect(gate.excludedComparators.some((e) => e.baselineId === 'b1')).toBe(true);
  });

  it('publishes the excluded comparator\'s return as the price of unsustainability', () => {
    const out = runResult({ b1: { minStressedLiquidCoverage: 0.878, realizedNetApy: 0.39 } });
    const gate = runRegisteredGate(out, gateOpts);
    const c = named(gate, 'Price of unsustainability published');

    expect(c.passed).toBe(true);
    expect(c.detail).toContain('b1@');
    expect(c.detail).toContain('39.000%');
    expect(gate.comparatorSustainability.some((v) => v.policyId === 'b1' && v.sustainable === false)).toBe(true);
  });

  it('keeps a sustainable deployable baseline in the comparison set', () => {
    const gate = runRegisteredGate(evaluation(), gateOpts);
    expect(gate.comparisons.map((c) => c.baselineId)).toContain('b0');
    expect(gate.excludedComparators).toEqual([]);
  });
});

describe('P37: the amended policy gate (G3, G4, G5)', () => {
  const gateOpts = { minPairedObservations: 20, bootstrapIterations: 200 };
  const p37 = { ...gateOpts, amendment: 'p37' as const };
  const TEN_K = REGISTERED_TIERS[0]!;
  const ONE_M = REGISTERED_TIERS[2]!;
  const TEN_M = REGISTERED_TIERS[3]!;

  /** SRCLA@tier rewritten into the Moonwell shape: 12% of NAV trapped at origin 1, the rest liquid. */
  function withTrappedPosition(
    out: RegisteredEvaluationResult,
    tier: bigint,
    over: { untrapped?: number; deployIntoDry?: boolean } = {},
  ): RegisteredEvaluationResult {
    return {
      ...out,
      results: out.results.map((r) => {
        if (r.policy.id !== SRCLA_POLICY.id || r.tier !== tier) return r;
        const snapshots = r.replay.snapshots.map((s, i) =>
          i === 1
            ? {
                ...s,
                stressedLiquidCoverage: 0.878,
                dryMarketIds: ['moonwell-usdc'],
                holdingsBaseByMarket: { 'moonwell-usdc': (tier * 12n) / 100n },
                executedDeployBaseByMarket: over.deployIntoDry ? { 'moonwell-usdc': 1n } : {},
                untrappedStressedLiquidCoverage: over.untrapped ?? 1,
              }
            : {
                ...s,
                holdingsBaseByMarket: {},
                executedDeployBaseByMarket: {},
                dryMarketIds: [],
                untrappedStressedLiquidCoverage: 1,
              },
        );
        return {
          ...r,
          replay: {
            ...r.replay,
            snapshots,
            minStressedLiquidCoverage: 0.878,
            coverageDistribution: { min: 0.878, p05: 1, median: 1 },
          },
        };
      }),
    };
  }

  /** SRCLA@tier with a plain coverage breach and no dry venue. */
  function withPlainBreach(out: RegisteredEvaluationResult, tier: bigint): RegisteredEvaluationResult {
    return {
      ...out,
      results: out.results.map((r) =>
        r.policy.id === SRCLA_POLICY.id && r.tier === tier
          ? { ...r, replay: { ...r.replay, minStressedLiquidCoverage: 0.5 } }
          : r,
      ),
    };
  }

  it('G3: a VENUE FAILURE blocks neither safety coverage nor scale invariance', () => {
    const gate = evaluateRegisteredRelease(withTrappedPosition(evaluation(), TEN_K), {
      ...p37,
      forkResults: completeForkResults(),
    });
    const coverage = named(gate, 'Safety: stressed liquid coverage');
    expect(coverage.passed).toBe(true);
    expect(coverage.detail).toMatch(/VENUE FAILURE \(P34, reported, not gating\)/);
    expect(named(gate, 'Sustainability: scale invariance across every registered tier (P26)').passed).toBe(
      true,
    );
    expect(gate.amendment).toBe('p37');
  });

  it('G3: the registered v0.10 gate on the same run still blocks', () => {
    const gate = evaluateRegisteredRelease(withTrappedPosition(evaluation(), TEN_K), {
      ...gateOpts,
      forkResults: completeForkResults(),
    });
    expect(named(gate, 'Safety: stressed liquid coverage').passed).toBe(false);
    expect(gate.pass).toBe(false);
    expect(gate.outOfScopeSustainability).toEqual([]);
  });

  it('G3: a deploy into the dry venue still blocks under P37', () => {
    const gate = evaluateRegisteredRelease(
      withTrappedPosition(evaluation(), TEN_K, { deployIntoDry: true }),
      { ...p37, forkResults: completeForkResults() },
    );
    expect(named(gate, 'Safety: stressed liquid coverage').passed).toBe(false);
  });

  it('G4: a refused BASELINE plan passes the P37 fork gate and is reported', () => {
    const fork = completeForkResults();
    const b4 = fork.find((f) => f.policyId === 'b4' && f.tier === TEN_K)!;
    b4.executed = false;
    b4.detail = 'REFUSED BY THE CHAIN';
    const gate = evaluateRegisteredRelease(evaluation(), { ...p37, forkResults: fork });
    const c = named(gate, '§11.1 pinned-prestate fork replay (SRCLA plans, P37)');
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/reported \(not gating\).*b4@10000000000/);
  });

  it('G4: a refused SRCLA plan fails the P37 fork gate', () => {
    const fork = completeForkResults();
    const s = fork.find((f) => f.policyId === SRCLA_POLICY.id && f.tier === TEN_K)!;
    s.executed = false;
    s.detail = 'REFUSED BY THE CHAIN';
    const gate = evaluateRegisteredRelease(evaluation(), { ...p37, forkResults: fork });
    expect(named(gate, '§11.1 pinned-prestate fork replay (SRCLA plans, P37)').passed).toBe(false);
  });

  it('G5: a breach at 10M only does not block P37, and is reported outside the scope', () => {
    const out = withPlainBreach(evaluation(), TEN_M);
    const gate = evaluateRegisteredRelease(out, { ...p37, forkResults: completeForkResults() });
    expect(named(gate, 'Safety: stressed liquid coverage').passed).toBe(true);
    expect(gate.outOfScopeSustainability?.map((v) => v.tier)).toEqual([TEN_M.toString()]);
    expect(gate.outOfScopeSustainability?.[0]!.sustainable).toBe(false);
    expect(evaluateRegisteredRelease(out, { ...gateOpts, forkResults: completeForkResults() }).pass).toBe(false);
  });

  it('G5: the same breach at 1M blocks P37', () => {
    const gate = evaluateRegisteredRelease(withPlainBreach(evaluation(), ONE_M), {
      ...p37,
      forkResults: completeForkResults(),
    });
    expect(named(gate, 'Safety: stressed liquid coverage').passed).toBe(false);
  });
});
