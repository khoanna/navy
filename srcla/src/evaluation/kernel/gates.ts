/**
 * The §11.5 release gate over a registered evaluation run.
 *
 * §11.5 says the policy gate "fails on ... a missing tier", on any safety
 * violation, and on statistical indistinguishability from the deployable
 * baselines. The harness that produced SRCLA-REPORT.md instead:
 *
 *   - ran three tiers where §11.1 registers four, and wrote its gates as
 *     `TIERS.every(...)` over the tiers that were present, so the missing
 *     10,000 tier could not fail anything;
 *   - computed a Welch table its gate list never referenced, leaving
 *     "SRCLA beat B2" as a bare point comparison a one-basis-point noise
 *     advantage would pass;
 *   - gated withdrawal success on a rate that was hardcoded to 1 because no
 *     redemption was ever executed.
 *
 * The rule this file enforces everywhere: **absence is failure**. Every
 * check is `true` (verified), `false` (failed) or `null` (NOT PRODUCED), and
 * the overall verdict is `checks.every(c => c.passed === true)`. A `null`
 * never rolls up into a pass.
 *
 * PURE: no I/O, no Date.now(), no unseeded randomness.
 * UNITS: money is bigint USDC base units (6 dp); APYs are dimensionless.
 */
import {
  movingBlockBootstrap,
  pairedDifferences,
  pairedHacTTest,
  periodReturns,
  REGISTERED_BOOTSTRAP_SEED,
  type BlockBootstrapResult,
  type PairedTestResult,
} from '../metrics/significance.js';
import { REGISTERED_TIERS, type PolicyRunResult, type RegisteredEvaluationResult } from './harness.js';
import { REGISTERED_POLICIES, SRCLA_POLICY } from './registry.js';

export interface RegisteredGateCheck {
  name: string;
  /**
   * `true` verified, `false` FAILED, `null` NOT PRODUCED.
   *
   * `null` is for a property the run did not measure at all — the §11.1 fork
   * replay, for instance. It is never a pass; see `pass` below.
   */
  passed: boolean | null;
  detail: string;
}

/** One SRCLA-vs-baseline comparison at one tier. */
export interface BaselineComparison {
  tier: string;
  baselineId: string;
  srclaNetApy: number;
  baselineNetApy: number;
  /** Paired, HAC-corrected, on after-cost per-period returns. */
  test: PairedTestResult;
  /** Distribution-free cross-check on the same difference series. */
  bootstrap: BlockBootstrapResult;
}

export interface RegisteredGateResult {
  pass: boolean;
  checks: RegisteredGateCheck[];
  comparisons: BaselineComparison[];
  /** Names of every check that did not verify, in order. */
  blockedReasons: string[];
}

/**
 * A §11.1 pinned-prestate fork replay outcome for one (policy, tier).
 *
 * The scaffold that would produce these is `src/evaluation/fork-runner.ts`,
 * which is currently wired to nothing — so in practice `forkResults` is
 * absent and the fork check reports NOT PRODUCED and blocks the gate. That
 * is the correct behaviour for an unimplemented paper requirement: it is
 * visible in the gate output rather than silently skipped.
 */
export interface ForkReplayResult {
  policyId: string;
  tier: bigint;
  /** The block the fork was pinned at. */
  prestateBlock: number;
  /** Whether every action the policy proposed executed on the fork. */
  executed: boolean;
  detail: string;
}

export interface RegisteredGateOptions {
  /** §11.4: fraction of attempted redemptions that must fill. */
  minWithdrawalSuccess?: number;
  /** §11.4: worst acceptable stressed liquid coverage. */
  minStressedLiquidCoverage?: number;
  /** Significance level for the paired test. */
  significanceLevel?: number;
  /** Minimum paired periods for a usable comparison. */
  minPairedObservations?: number;
  /** §11.1 fork replay outcomes, one per (policy, tier). */
  forkResults?: readonly ForkReplayResult[];
  /** Registered bootstrap seed; exposed so a report can restate it. */
  bootstrapSeed?: number;
  bootstrapIterations?: number;
}

const check = (name: string, passed: boolean | null, detail: string): RegisteredGateCheck => ({
  name,
  passed,
  detail,
});

/**
 * Every (policy, tier) the registered protocol requires, whether or not the
 * run produced it.
 */
export function requiredRuns(): string[] {
  const out: string[] = [];
  for (const t of REGISTERED_TIERS) {
    for (const p of REGISTERED_POLICIES) out.push(`${p.id}@${t}`);
  }
  return out;
}

/**
 * Compare SRCLA against one baseline at one tier, paired on the after-cost
 * per-period return series both replays produced.
 */
export function compareToBaseline(
  srcla: PolicyRunResult,
  baseline: PolicyRunResult,
  opts: { minPairedObservations?: number; bootstrapSeed?: number; bootstrapIterations?: number } = {},
): BaselineComparison {
  const a = periodReturns(srcla.replay.snapshots.map((s) => s.sharePriceWad));
  const b = periodReturns(baseline.replay.snapshots.map((s) => s.sharePriceWad));

  const testOpts =
    opts.minPairedObservations !== undefined
      ? { minObservations: opts.minPairedObservations }
      : {};
  const test = pairedHacTTest(a, b, testOpts);

  // `pairedDifferences` throws on a length mismatch, so reaching here means
  // the two replays covered the same periods.
  const bootstrap = movingBlockBootstrap(pairedDifferences(a, b), {
    seed: opts.bootstrapSeed ?? REGISTERED_BOOTSTRAP_SEED,
    iterations: opts.bootstrapIterations ?? 2000,
    ...(opts.minPairedObservations !== undefined
      ? { minObservations: opts.minPairedObservations }
      : {}),
  });

  return {
    tier: srcla.tier.toString(),
    baselineId: baseline.policy.id,
    srclaNetApy: srcla.replay.realizedNetApy,
    baselineNetApy: baseline.replay.realizedNetApy,
    test,
    bootstrap,
  };
}

/**
 * Run the §11.5 gate over a completed registered evaluation.
 */
export function evaluateRegisteredRelease(
  out: RegisteredEvaluationResult,
  opts: RegisteredGateOptions = {},
): RegisteredGateResult {
  const minWithdrawalSuccess = opts.minWithdrawalSuccess ?? 0.99;
  const minStressed = opts.minStressedLiquidCoverage ?? 0.99;
  const alpha = opts.significanceLevel ?? 0.05;

  const checks: RegisteredGateCheck[] = [];

  // 1. Completeness. A tier or a (policy, tier) that was not run cannot be
  //    checked, so it FAILS. `TIERS.every(...)` over the tiers that happened
  //    to be present is what made the missing 10,000 tier invisible.
  checks.push(
    check(
      'Every registered tier ran',
      out.missingTiers.length === 0,
      out.missingTiers.length === 0
        ? `all ${REGISTERED_TIERS.length} of §11.1's tiers`
        : `missing tiers: ${out.missingTiers.map((t) => t.toString()).join(', ')}`,
    ),
  );

  checks.push(
    check(
      'Every registered policy ran at every tier',
      out.missingPolicyIds.length === 0,
      out.missingPolicyIds.length === 0
        ? `all ${requiredRuns().length} required (policy, tier) runs`
        : `missing: ${out.missingPolicyIds.join(', ')}`,
    ),
  );

  // 2. The artifact must be calibrated. A provisional one makes every number
  //    below non-citable, so it blocks rather than annotating.
  checks.push(
    check(
      'Calibrated artifact',
      !out.provisional,
      out.provisional
        ? `artifact ${out.artifact.artifactHash} is PROVISIONAL: ${out.artifact._provisional ?? ''}`
        : out.artifact.artifactHash,
    ),
  );

  // 3. §11.4 safety, per (policy, tier). An UNMEASURED withdrawal rate
  //    (null: no redemption attempted) fails; the previous replay returned a
  //    hardcoded 1.0 here, which let a zero-cash policy clear a liquidity
  //    gate it was never subjected to.
  const unmeasured = out.results.filter((r) => r.replay.withdrawalSuccessRate === null);
  const failedWithdrawals = out.results.filter(
    (r) => r.replay.withdrawalSuccessRate !== null && r.replay.withdrawalSuccessRate < minWithdrawalSuccess,
  );
  checks.push(
    check(
      'Safety: withdrawal success measured and met',
      unmeasured.length === 0 && failedWithdrawals.length === 0,
      unmeasured.length > 0
        ? `not measured for ${unmeasured.map(label).join(', ')}: no redemption was attempted`
        : failedWithdrawals.length > 0
          ? failedWithdrawals
              .map((r) => `${label(r)} ${(r.replay.withdrawalSuccessRate! * 100).toFixed(1)}%`)
              .join(', ')
          : `>= ${(minWithdrawalSuccess * 100).toFixed(0)}% across ${out.results.length} runs`,
    ),
  );

  const squeezed = out.results.filter((r) => r.replay.minStressedLiquidCoverage < minStressed);
  checks.push(
    check(
      'Safety: stressed liquid coverage',
      squeezed.length === 0,
      squeezed.length === 0
        ? `>= ${minStressed} across ${out.results.length} runs`
        : squeezed.map((r) => `${label(r)} ${r.replay.minStressedLiquidCoverage.toFixed(3)}`).join(', '),
    ),
  );

  // 4. An INERT ablation removed nothing on this dataset: its decision
  //    sequence is byte-identical to SRCLA's, so any delta reported for it is
  //    noise and attributing it to the removed component is a
  //    misattribution.
  const inert = [...new Set(out.results.filter((r) => r.inertVsSrcla).map((r) => r.policy.id))];
  checks.push(
    check(
      'No inert ablation',
      inert.length === 0,
      inert.length === 0
        ? 'every ablation changed at least one decision'
        : `these made byte-identical decisions to SRCLA: ${inert.join(', ')}`,
    ),
  );

  // 5. §11.5's statistical criterion, per deployable baseline per tier, on
  //    AFTER-COST per-period returns. B5 is excluded: §11.2 says it "cannot
  //    establish deployability".
  const comparisons: BaselineComparison[] = [];
  const tiers = [...new Set(out.results.map((r) => r.tier.toString()))].sort((x, y) =>
    BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0,
  );

  const compareOpts: Parameters<typeof compareToBaseline>[2] = {};
  if (opts.minPairedObservations !== undefined) compareOpts.minPairedObservations = opts.minPairedObservations;
  if (opts.bootstrapSeed !== undefined) compareOpts.bootstrapSeed = opts.bootstrapSeed;
  if (opts.bootstrapIterations !== undefined) compareOpts.bootstrapIterations = opts.bootstrapIterations;

  for (const tier of tiers) {
    const atTier = out.results.filter((r) => r.tier.toString() === tier);
    const srcla = atTier.find((r) => r.policy.id === SRCLA_POLICY.id);
    if (srcla === undefined) continue; // already failed the completeness check
    for (const b of atTier) {
      if (b.policy.id === SRCLA_POLICY.id || !b.policy.deployable) continue;
      comparisons.push(compareToBaseline(srcla, b, compareOpts));
    }
  }

  const indistinguishable = comparisons.filter((c) => c.test.usable && c.test.pValue >= alpha);
  const unusable = comparisons.filter((c) => !c.test.usable);
  checks.push(
    comparisons.length === 0
      ? check(
          'Statistically distinguishable from every deployable baseline',
          null,
          'NOT PRODUCED: no SRCLA-vs-baseline comparison was available',
        )
      : check(
          'Statistically distinguishable from every deployable baseline',
          indistinguishable.length === 0 && unusable.length === 0,
          unusable.length > 0
            ? `test not usable for ${unusable.map((c) => `${c.baselineId}@${c.tier} (${c.test.reason})`).join(', ')}`
            : indistinguishable.length > 0
              ? indistinguishable
                  .map((c) => `${c.baselineId}@${c.tier} p=${c.test.pValue.toFixed(3)}`)
                  .join(', ')
              : `p < ${alpha} against all ${comparisons.length} deployable comparisons`,
        ),
  );

  // 6. Outperformance, on the same deployable set.
  const notBeaten = comparisons.filter((c) => c.srclaNetApy <= c.baselineNetApy);
  checks.push(
    comparisons.length === 0
      ? check('Outperforms every deployable baseline', null, 'NOT PRODUCED: no comparison available')
      : check(
          'Outperforms every deployable baseline',
          notBeaten.length === 0,
          notBeaten.length === 0
            ? `ahead of all ${comparisons.length} deployable comparisons`
            : notBeaten
                .map(
                  (c) =>
                    `${c.baselineId}@${c.tier}: SRCLA ${(c.srclaNetApy * 100).toFixed(3)}% vs ${(c.baselineNetApy * 100).toFixed(3)}%`,
                )
                .join(', '),
        ),
  );

  // 7. §11.1's per-policy pinned-prestate fork replay. Unimplemented today:
  //    `src/evaluation/fork-runner.ts` is the scaffold and nothing calls it,
  //    so this reports NOT PRODUCED and blocks. Skipping it silently is how
  //    a paper requirement gets quietly dropped.
  const fork = opts.forkResults;
  if (fork === undefined) {
    checks.push(
      check(
        '§11.1 pinned-prestate fork replay',
        null,
        'NOT PRODUCED: no fork replay was supplied. src/evaluation/fork-runner.ts is the ' +
          'scaffold for this and is wired to nothing.',
      ),
    );
  } else {
    const required = new Set(requiredRuns());
    for (const f of fork) required.delete(`${f.policyId}@${f.tier}`);
    const notExecuted = fork.filter((f) => !f.executed);
    checks.push(
      check(
        '§11.1 pinned-prestate fork replay',
        required.size === 0 && notExecuted.length === 0,
        required.size > 0
          ? `no fork replay for: ${[...required].sort().join(', ')}`
          : notExecuted.length > 0
            ? `did not execute on fork: ${notExecuted.map((f) => `${f.policyId}@${f.tier} (${f.detail})`).join(', ')}`
            : `${fork.length} fork replays executed`,
      ),
    );
  }

  // `=== true`, not truthiness: NOT PRODUCED must not verify.
  const pass = checks.every((c) => c.passed === true);
  return {
    pass,
    checks,
    comparisons,
    blockedReasons: checks.filter((c) => c.passed !== true).map((c) => c.name),
  };
}

const label = (r: PolicyRunResult): string => `${r.policy.id}@${r.tier}`;
