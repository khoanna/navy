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
  compareToBaseline,
  evaluateRegisteredRelease,
  requiredRuns,
  type ForkReplayResult,
} from '../../../src/evaluation/kernel/gates.js';
import { REGISTERED_TIERS, type PolicyRunResult, type RegisteredEvaluationResult } from '../../../src/evaluation/kernel/harness.js';
import { REGISTERED_POLICIES, SRCLA_POLICY } from '../../../src/evaluation/kernel/registry.js';
import { mulberry32 } from '../../../src/evaluation/metrics/significance.js';
import type { PolicyArtifact } from '../../../src/policy/types.js';

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
  } = {},
): PolicyRunResult {
  const policy = REGISTERED_POLICIES.find((p) => p.id === policyId) ?? SRCLA_POLICY;
  const path = prices(opts.edge ?? 0, opts.seed ?? 1);
  return {
    policy,
    tier,
    decisionHashes: ['0xd'],
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
      capitalAtWorkFraction: 1,
      deploymentLatencyOrigins: 0,
      idleDragApy: null,
      hurdleBlocks: {},
    },
  } as PolicyRunResult;
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
    expect(gate.blockedReasons).toContain('Statistically distinguishable from every deployable baseline');
  });
});

describe('evaluateRegisteredRelease: safety', () => {
  // NEW-14: `withdrawalSuccessRate` was hardcoded to 1 because no redemption
  // was ever executed, and the >= 0.99 gate passed on it.
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
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('no redemption was attempted');
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
  // §11.5 fails ON indistinguishability. A bare point comparison would pass
  // this; the paired HAC test does not.
  it('BLOCKS when SRCLA is statistically indistinguishable from a baseline', () => {
    const results = completeResults((id) => (id === 'srcla' ? { edge: 0.0000001 } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(gate.pass).toBe(false);
    expect(named(gate, 'Statistically distinguishable from every deployable baseline').passed).toBe(
      false,
    );
  });

  it('BLOCKS when the test could not be computed at all', () => {
    // Raising the minimum above the number of periods available makes every
    // comparison unusable. "Could not test" is not "passed the test".
    const gate = evaluateRegisteredRelease(evaluation(), {
      forkResults: completeForkResults(),
      minPairedObservations: PERIODS + 10,
      bootstrapIterations: 200,
    });

    const c = named(gate, 'Statistically distinguishable from every deployable baseline');
    expect(c.passed).toBe(false);
    expect(c.detail).toContain('not usable');
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

  it('BLOCKS when SRCLA does not outperform a deployable baseline', () => {
    const results = completeResults((id) => (id === 'srcla' ? { edge: -0.00006 } : {}));
    const gate = evaluateRegisteredRelease(evaluation({ results }), {
      forkResults: completeForkResults(),
      minPairedObservations: 20,
      bootstrapIterations: 200,
    });

    expect(named(gate, 'Outperforms every deployable baseline').passed).toBe(false);
  });
});

describe('evaluateRegisteredRelease: §11.1 fork replay', () => {
  // The fork replay is unimplemented. It must be VISIBLE as NOT PRODUCED,
  // never quietly skipped.
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
    const distinguishable = gate.checks.find(
      (c) => c.name === 'Statistically distinguishable from every deployable baseline',
    )!;
    expect(distinguishable.passed).toBeNull();
    expect(distinguishable.detail).toMatch(/NO ADMISSIBLE COMPARATOR/);

    const outperforms = gate.checks.find((c) => c.name === 'Outperforms every deployable baseline')!;
    expect(outperforms.passed).toBeNull();
    expect(outperforms.detail).toMatch(/NO ADMISSIBLE COMPARATOR/);
  });
});
