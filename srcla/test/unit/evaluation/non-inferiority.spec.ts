/**
 * P21 part 2, P22, P27 — non-inferiority among SUSTAINABLE policies, and the
 * skill window that says whether a yield statement means anything at all.
 *
 * The measured fact this file encodes: on the calibration era the entire
 * cross-sectional return available from reallocating among the three admitted
 * venues is 18–43 bps a year, against 494 bps lost by not deploying at all. A
 * criterion requiring SRCLA to BEAT every deployable baseline over a 43 bps
 * window is not a demanding test — it is an unattainable one, and what it
 * actually measures is estimation noise.
 *
 * So the release criterion becomes NON-INFERIORITY at a registered margin,
 * scored only among comparators that are themselves sustainable, and the
 * skill window is published beside it.
 *
 * THE THING THAT MUST NOT BE GOT WRONG: the window applies to the two yield
 * statements in OPPOSITE directions, and they must not share a branch.
 *
 *   - A SUPERIORITY claim inside the window is NOT INFORMATIVE: no policy
 *     could have demonstrated yield superiority at that resolution.
 *   - A NON-INFERIORITY pass inside the window is never converted to NOT
 *     INFORMATIVE. A narrow window makes non-inferiority EASIER, so
 *     suppressing it would excuse the candidate from a test it can pass. The
 *     window is published alongside as a power disclosure instead.
 *   - The window may never touch the demonstration, completeness or
 *     sustainability checks. Yield can be beyond reach; redeemability cannot.
 */
import {
  evaluateRegisteredRelease,
  skillWindow,
  type ForkReplayResult,
} from '../../../src/evaluation/kernel/gates.js';
import {
  REGISTERED_TIERS,
  type PolicyRunResult,
  type RegisteredEvaluationResult,
} from '../../../src/evaluation/kernel/harness.js';
import { REGISTERED_POLICIES, SRCLA_POLICY } from '../../../src/evaluation/kernel/registry.js';
import {
  nonInferiorityTest,
  REGISTERED_NONINFERIORITY_MARGIN,
  mulberry32,
} from '../../../src/evaluation/metrics/significance.js';
import { REGISTERED_COVERAGE_FLOOR } from '../../../src/policy/steps/coverage.js';
import type { PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const PERIODS = 120;
const DAY_MS = 86_400_000;

function artifact(): PolicyArtifact {
  return {
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
}

/**
 * A DAILY per-period return series whose mean is `apy / 365`, with a small
 * seeded idiosyncratic wobble so the difference series is not degenerate.
 *
 * Daily on purpose: the registered margin is quoted per YEAR, so a test that
 * fed it straight onto a per-period difference would be shifting by 43 bps a
 * DAY. The scaling is the part most likely to be got wrong.
 */
function seriesAt(apy: number, seed = 7): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < PERIODS; i++) out.push(apy / 365 + (rng() - 0.5) * 2e-6);
  return out;
}

/** Share prices whose per-period returns are exactly `seriesAt(apy, seed)`. */
function pricesAt(apy: number, seed: number): bigint[] {
  const out = [WAD];
  for (const r of seriesAt(apy, seed)) {
    const prev = out[out.length - 1]!;
    out.push(prev + (prev * BigInt(Math.round(r * 1e15))) / 10n ** 15n);
  }
  return out;
}

interface RunOverride {
  realizedNetApy?: number;
  capitalAtWorkFraction?: number;
  minStressedLiquidCoverage?: number;
  seed?: number;
}

function run(policyId: string, tier: bigint, o: RunOverride = {}): PolicyRunResult {
  const policy = REGISTERED_POLICIES.find((p) => p.id === policyId) ?? SRCLA_POLICY;
  const apy = o.realizedNetApy ?? 0;
  const path = pricesAt(apy, o.seed ?? 1);
  return {
    policy,
    tier,
    decisionHashes: ['0xd'],
    rebalances: 1,
    inertVsSrcla: false,
    replay: {
      policyId,
      tier,
      cohortId: `tier-${tier}`,
      snapshots: path.map((p, i) => ({
        timestamp: new Date(Date.UTC(2026, 5, 1) + i * DAY_MS),
        totalAssets: tier,
        totalShares: tier,
        sharePriceWad: p,
        totalReturn: 0,
        idleBase: tier,
        stressedLiquidCoverage: 1,
      })),
      realizedNetApy: apy,
      totalTurnover: 0n,
      withdrawalSuccessRate: 1,
      withdrawals: [],
      totalCosts: 0n,
      minStressedLiquidCoverage: o.minStressedLiquidCoverage ?? 1,
      coverageDistribution: { min: 1, p05: 1, median: 1 },
      capitalAtWorkFraction: o.capitalAtWorkFraction ?? 1,
      deploymentLatencyOrigins: 0,
      idleDragApy: null,
      hurdleBlocks: {},
      timeToFullExitOrigins: 0,
      timeToFullExitCensored: false,
      venueStressContribution: { 'compound-usdc': 0.05 },
      displayedVsRealizedGapApy: 0,
      policyViolations: 0,
    },
  } as unknown as PolicyRunResult;
}

/** A COMPLETE evaluation: every registered policy at every registered tier. */
function runResult(overrides: Record<string, RunOverride> = {}): RegisteredEvaluationResult {
  const results: PolicyRunResult[] = [];
  for (const tier of REGISTERED_TIERS) {
    for (const [i, p] of REGISTERED_POLICIES.entries()) {
      results.push(run(p.id, tier, { seed: 100 + i, ...(overrides[p.id] ?? {}) }));
    }
  }
  return {
    results,
    withdrawalSource: 'observed',
    artifact: artifact(),
    provisional: false,
    missingPolicyIds: [],
    missingTiers: [],
  } as unknown as RegisteredEvaluationResult;
}

function completeForkResults(): ForkReplayResult[] {
  const out: ForkReplayResult[] = [];
  for (const tier of REGISTERED_TIERS) {
    for (const p of REGISTERED_POLICIES) {
      out.push({ policyId: p.id, tier, prestateBlock: 30_000_000, executed: true, detail: 'ok' });
    }
  }
  return out;
}

const runRegisteredGate = evaluateRegisteredRelease;
const gateOpts = {
  minPairedObservations: 20,
  bootstrapIterations: 300,
  forkResults: completeForkResults(),
};

/**
 * A NARROW-WINDOW universe: bounded hindsight (B5) buys essentially nothing
 * over the best sustainable baseline, which is what the calibration era
 * actually measured.
 */
function narrowWindowRun(opts: {
  claimYieldSuperiority?: boolean;
  srclaWorseThanBaseline?: boolean;
} = {}): RegisteredEvaluationResult {
  const baseline = 0.05;
  const srcla = opts.srclaWorseThanBaseline
    ? baseline - 0.25 // trails by 25 pp: far outside any plausible margin
    : opts.claimYieldSuperiority
      ? baseline + 0.0005 // 5 bps ahead: a "superiority" claim inside the window
      : baseline;
  const over: Record<string, RunOverride> = { srcla: { realizedNetApy: srcla } };
  for (const p of REGISTERED_POLICIES) {
    if (p.id === SRCLA_POLICY.id) continue;
    // B5's hindsight upper bound sits 10 bps above the baselines — a window
    // far narrower than the registered 43 bps margin.
    over[p.id] = { realizedNetApy: p.shape === 'hindsight' ? baseline + 0.001 : baseline };
  }
  return runResult(over);
}

const named = (g: ReturnType<typeof runRegisteredGate>, prefix: string) =>
  g.checks.find((c) => c.name.startsWith(prefix))!;

describe('nonInferiorityTest: one-sided, HAC-corrected, at an ANNUALIZED margin', () => {
  it('passes when SRCLA trails by less than the margin', () => {
    const t = nonInferiorityTest(seriesAt(0.05, 1), seriesAt(0.051, 2), 0.0043);
    expect(t.usable).toBe(true);
    expect(t.pValue).toBeLessThan(0.05);
    expect(t.nonInferior).toBe(true);
  });

  it('fails when SRCLA trails by more than the margin', () => {
    const t = nonInferiorityTest(seriesAt(0.0, 1), seriesAt(0.2495, 2), 0.0043);
    expect(t.usable).toBe(true);
    expect(t.pValue).toBeGreaterThan(0.05);
    expect(t.nonInferior).toBe(false);
  });

  it('scales the margin per period rather than per observation', () => {
    // 43 bps a YEAR is 43/365 bps a day. A test that shifted the daily
    // difference series by 0.0043 would call a 24.95 pp shortfall
    // non-inferior, which is the failure mode this assertion pins.
    const t = nonInferiorityTest(seriesAt(0.0, 1), seriesAt(0.2495, 2), 0.0043);
    expect(t.marginPerPeriod).toBeCloseTo(0.0043 / 365, 10);
    expect(t.periodsPerYear).toBe(365);
  });

  it('reports UNUSABLE, never a pass, on a degenerate difference series', () => {
    const flat = new Array(60).fill(0.0001) as number[];
    const t = nonInferiorityTest(flat, flat, 0.0043);
    expect(t.usable).toBe(false);
    expect(t.nonInferior).toBeNull();
    expect(t.reason).toMatch(/DEGENERATE/);
  });

  it('registers the margin exactly once, at 43 bps', () => {
    expect(REGISTERED_NONINFERIORITY_MARGIN).toBe(0.0043);
  });
});

describe('skillWindow: bounded hindsight minus the best SUSTAINABLE baseline', () => {
  const tier = REGISTERED_TIERS[0]!;

  it('is the B5 upper bound minus the best sustainable baseline on the same era', () => {
    const atTier = [
      run('srcla', tier, { realizedNetApy: 0.05 }),
      run('b0', tier, { realizedNetApy: 0.01 }),
      run('b1', tier, { realizedNetApy: 0.052 }),
      run('b5', tier, { realizedNetApy: 0.06 }),
    ];
    const w = skillWindow(atTier, new Set(['b0', 'b1']));
    expect(w.hindsightApy).toBeCloseTo(0.06, 6);
    expect(w.bestBaselineApy).toBeCloseTo(0.052, 6);
    expect(w.windowApy).toBeCloseTo(0.008, 6);
    expect(w.informative).toBe(true);
  });

  it('ignores an UNSUSTAINABLE baseline when picking the best one', () => {
    const atTier = [
      run('srcla', tier, { realizedNetApy: 0.05 }),
      run('b0', tier, { realizedNetApy: 0.01 }),
      run('b1', tier, { realizedNetApy: 0.3916 }), // the 39% coverage breacher
      run('b5', tier, { realizedNetApy: 0.06 }),
    ];
    const w = skillWindow(atTier, new Set(['b0'])); // b1 excluded
    expect(w.bestBaselineApy).toBeCloseTo(0.01, 6);
    expect(w.windowApy).toBeCloseTo(0.05, 6);
  });

  it('is NOT INFORMATIVE when the window is inside the registered margin', () => {
    const atTier = [
      run('b0', tier, { realizedNetApy: 0.05 }),
      run('b5', tier, { realizedNetApy: 0.051 }),
    ];
    const w = skillWindow(atTier, new Set(['b0']));
    expect(w.windowApy).toBeCloseTo(0.001, 6);
    expect(w.informative).toBe(false);
  });

  it('is null — never false, never a pass — when B5 or a sustainable baseline is absent', () => {
    const noHindsight = skillWindow([run('b0', tier, { realizedNetApy: 0.05 })], new Set(['b0']));
    expect(noHindsight.informative).toBeNull();
    expect(noHindsight.windowApy).toBeNull();

    const noBaseline = skillWindow([run('b5', tier, { realizedNetApy: 0.05 })], new Set());
    expect(noBaseline.informative).toBeNull();
  });
});

describe('P22: the skill window governs the two yield criteria in OPPOSITE directions', () => {
  it('a narrow window makes a SUPERIORITY claim NOT INFORMATIVE', () => {
    const gate = runRegisteredGate(narrowWindowRun({ claimYieldSuperiority: true }), gateOpts);
    const sup = named(gate, 'Superiority: yield');
    expect(sup.passed).toBeNull();
    expect(sup.detail).toMatch(/NOT INFORMATIVE/);
  });

  it('a narrow window does NOT excuse the non-inferiority test', () => {
    const gate = runRegisteredGate(narrowWindowRun({ srclaWorseThanBaseline: true }), gateOpts);
    const ni = named(gate, 'Non-inferior');
    expect(ni.passed).toBe(false); // still scored, still fails
    expect(ni.detail).toMatch(/weak evidence/); // and disclosed
  });

  it('a narrow window still lets a non-inferior SRCLA PASS, and discloses the weakness', () => {
    const gate = runRegisteredGate(narrowWindowRun(), gateOpts);
    const ni = named(gate, 'Non-inferior');
    expect(ni.passed).toBe(true);
    expect(ni.detail).toMatch(/weak evidence/);
    expect(ni.detail).toMatch(/deploy-and-hold/);
  });

  it('the superiority check is REPORTED, never gating: a NOT INFORMATIVE one blocks nothing', () => {
    const gate = runRegisteredGate(narrowWindowRun({ claimYieldSuperiority: true }), gateOpts);
    expect(gate.blockedReasons).not.toContain(named(gate, 'Superiority: yield').name);
    expect(gate.pass).toBe(true);
  });

  it('scores superiority normally when the window is WIDE enough to resolve it', () => {
    const over: Record<string, RunOverride> = { srcla: { realizedNetApy: 0.09 } };
    for (const p of REGISTERED_POLICIES) {
      if (p.id === SRCLA_POLICY.id) continue;
      over[p.id] = { realizedNetApy: p.shape === 'hindsight' ? 0.20 : 0.05 };
    }
    const gate = runRegisteredGate(runResult(over), gateOpts);
    const sup = named(gate, 'Superiority: yield');
    expect(sup.passed).toBe(true);
    expect(sup.detail).not.toMatch(/NOT INFORMATIVE/);
  });

  it('never lets the window touch demonstration, completeness or sustainability', () => {
    const gate = runRegisteredGate(narrowWindowRun(), gateOpts);
    for (const c of gate.checks) {
      if (
        c.name.startsWith('Demonstration') ||
        c.name.startsWith('Every registered') ||
        c.name.startsWith('Safety') ||
        c.name.startsWith('Sustainability')
      ) {
        expect(c.detail).not.toMatch(/NOT INFORMATIVE|skill window/);
        expect(c.passed).toBe(true);
      }
    }
  });
});

describe('P27: an unsustainable policy is a counterexample, not a comparator', () => {
  /** B1 earning 39% at 0.878 coverage against the 0.99 floor. */
  const breacher = () =>
    runResult({
      srcla: { capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, realizedNetApy: 0.05 },
      b1: {
        capitalAtWorkFraction: 0.95,
        minStressedLiquidCoverage: REGISTERED_COVERAGE_FLOOR - 0.112,
        realizedNetApy: 0.3916,
      },
    });

  it('excludes a coverage-breaching baseline from the yield comparison', () => {
    const gate = runRegisteredGate(breacher(), gateOpts);
    expect(gate.comparisons.some((c) => c.baselineId === 'b1')).toBe(false);
    expect(gate.excludedComparators.some((e) => e.baselineId === 'b1')).toBe(true);
  });

  it('publishes the excluded policy as a priced counterexample', () => {
    const gate = runRegisteredGate(breacher(), gateOpts);
    const b1 = gate.comparatorSustainability.find(
      (v) => v.policyId === 'b1' && v.tier === REGISTERED_TIERS[0]!.toString(),
    )!;
    expect(b1.realizedNetApy).toBeCloseTo(0.3916, 6);
    expect(b1.sustainable).toBe(false);
    expect(b1.breach).toMatch(/S2/);
  });

  it('reports NO SUSTAINABLE COMPARATOR when every deployable baseline breached', () => {
    const over: Record<string, RunOverride> = {
      srcla: { capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0 },
    };
    for (const p of REGISTERED_POLICIES) {
      if (p.id === SRCLA_POLICY.id || p.section !== '11.2' || !p.deployable) continue;
      over[p.id] = { minStressedLiquidCoverage: 0.5, capitalAtWorkFraction: 0.9 };
    }
    const gate = runRegisteredGate(runResult(over), gateOpts);
    const ni = named(gate, 'Non-inferior');
    expect(ni.passed).toBeNull();
    expect(ni.detail).toMatch(/NO SUSTAINABLE COMPARATOR/);
    expect(gate.pass).toBe(false);
  });
});
