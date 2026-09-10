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
  nonInferiorityTest,
  pairedDifferences,
  pairedHacTTest,
  periodReturns,
  REGISTERED_BOOTSTRAP_SEED,
  REGISTERED_NONINFERIORITY_MARGIN,
  REGISTERED_PERIODS_PER_YEAR,
  type BlockBootstrapResult,
  type NonInferiorityResult,
  type PairedTestResult,
} from '../metrics/significance.js';
import {
  REGISTERED_COVERAGE_FLOOR,
  REGISTERED_STRESS_DEMAND_BPS,
} from '../../policy/steps/coverage.js';
import { REGISTERED_TIERS, type PolicyRunResult, type RegisteredEvaluationResult } from './harness.js';
import { REGISTERED_ABLATIONS, REGISTERED_POLICIES, SRCLA_POLICY } from './registry.js';
import {
  qualifiesAsComparator,
  scaleInvariant,
  sustainabilityAtTier,
  REGISTERED_DEMONSTRATION_FLOOR,
  REGISTERED_MAX_EXIT_ORIGINS,
  REGISTERED_MAX_VENUE_STRESS_SHARE,
  REGISTERED_MIN_WITHDRAWAL_SUCCESS,
  type SustainabilityVerdict,
} from './sustainability.js';

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
  /**
   * `false` for a check that is REPORTED but never gates: it is excluded from
   * `pass` and from `blockedReasons`. Absent means gating, so every existing
   * check keeps blocking exactly as it did.
   *
   * The set that may carry it is CLOSED, enumerated in
   * `test/unit/evaluation/non-inferiority.spec.ts`, and has exactly two
   * members — anything else marked non-gating fails that test rather than
   * quietly ceasing to block:
   *
   *   1. the two-sided distinguishability statistic, which v0.8 dropped from
   *      §11.5's rejection list (the word "indistinguishab*" appears nowhere
   *      in the v0.8 paper) and which is retained only as published
   *      resolution information;
   *   2. the NOT INFORMATIVE branch of a claimed yield superiority, which the
   *      paper says "neither passes nor fails" — inside the skill window the
   *      claim can be neither supported nor refuted, so a `false` there would
   *      be a statement about the universe masquerading as a defect of the
   *      policy. Every OTHER branch of that check gates: an unsupported claim
   *      is a §11.5 rejection condition.
   *
   * This flag is NOT a general escape hatch. The demonstration, completeness,
   * sustainability and non-inferiority checks all gate, always: yield can be
   * beyond reach, redeemability cannot.
   */
  gating?: boolean;
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
  /**
   * §11.5's yield criterion (P21 part 2): is SRCLA no worse than this
   * comparator by more than the registered margin? One-sided, HAC-corrected,
   * with the same seeded block-bootstrap cross-check.
   */
  nonInferiority: NonInferiorityResult;
  /**
   * The same one-sided machinery at a ZERO margin, which is exactly a
   * SUPERIORITY test: reject `mean(SRCLA − baseline) <= 0`. A point-estimate
   * ordering (`srclaNetApy > baselineNetApy`) is not a test, and a one-basis
   * -point noise advantage would satisfy it — the very defect §11.5 was
   * rewritten to remove. Since an unsupported superiority claim now GATES,
   * the claim has to be settled by a test rather than by a ranking.
   */
  superiority: NonInferiorityResult;
  /** Periods per year derived from the replay's own snapshot cadence. */
  periodsPerYear: number;
}

/**
 * P22 — the SKILL WINDOW at one tier: the whole return that reallocation
 * could have earned, measured rather than assumed.
 *
 * `windowApy = B5's bounded-hindsight return − the best SUSTAINABLE
 * baseline's return, on the same era`. B5 is §11.2's non-deployable
 * diagnostic upper bound: it is what a policy with bounded foresight would
 * have made. The best sustainable baseline is what a policy with no skill at
 * all would have made. The difference is therefore the ENTIRE budget any
 * allocation skill could possibly have captured.
 *
 * When that budget is smaller than the registered non-inferiority margin, no
 * policy could have demonstrated yield superiority at this resolution, and
 * the superiority claim is NOT INFORMATIVE — a statement about the universe,
 * not about the candidate.
 *
 * Three-valued: `informative` is `null` when the window could not be
 * computed (no B5 run, or no sustainable baseline to measure against). It is
 * never `false` by default, because "the window is narrow" and "there is no
 * window" are different findings.
 */
export interface SkillWindow {
  tier: string;
  /** B5's realized net APY; `null` when no hindsight run was produced. */
  hindsightApy: number | null;
  /** Best realized net APY among SUSTAINABLE comparators at this tier. */
  bestBaselineApy: number | null;
  bestBaselineId: string | null;
  /** `hindsightApy − bestBaselineApy`; `null` when either is absent. */
  windowApy: number | null;
  /** The registered margin the window was compared against. */
  marginApy: number;
  /** `true` wide enough to resolve a superiority claim, `false` not, `null` not produced. */
  informative: boolean | null;
  detail: string;
}

export interface RegisteredGateResult {
  pass: boolean;
  checks: RegisteredGateCheck[];
  comparisons: BaselineComparison[];
  /** Names of every check that did not verify, in order. */
  blockedReasons: string[];
  /**
   * §11.5's PRIMARY criterion, per SRCLA run. One verdict per tier — a
   * per-tier pass does not aggregate (P26), so the per-tier rows are the
   * result and `scaleInvariant` below is derived from them, never averaged.
   */
  sustainability: SustainabilityVerdict[];
  /**
   * The SAME verdict computed for every non-SRCLA run, on identical terms.
   * Two uses, and only two: it is the admissibility filter for the yield
   * comparison, and it is the counterexample table — a policy that breaches
   * is not a comparator, and its return is published as the measured price
   * of unsustainability (§11.5 part 3).
   */
  comparatorSustainability: SustainabilityVerdict[];
  /** P26 over `sustainability`. `null` is NOT DEMONSTRATED, never a pass. */
  scaleInvariant: boolean | null;
  /**
   * Comparators dropped from the yield comparison, with WHY — so "no
   * comparison" and "no ADMISSIBLE comparison" are never reported as the
   * same thing.
   */
  excludedComparators: Array<{ baselineId: string; tier: string; reason: string }>;
  /**
   * P22, one per tier. Published whatever it says: it is the power disclosure
   * that makes both yield statements readable, so it is part of the result
   * rather than prose inside a check detail.
   */
  skillWindows: SkillWindow[];
  /** The registered non-inferiority margin actually used, so the run record testifies to it. */
  nonInferiorityMarginApy: number;
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
  /**
   * §11.4's stress demand is `tier * 50%`. Some tiers ask for more
   * instantly-withdrawable liquidity than the three venues, at their
   * worst-observed moment, ever held simultaneously -- that is arithmetic
   * about §2.1's locked venue set, not a property of the policy being
   * gated. When supplied, a tier whose demand exceeds this worst-case
   * venue total is partitioned out of "policy failed the coverage check"
   * and into `CAPACITY_INFEASIBLE` (see the coverage check below). Omit it
   * and every sub-threshold run is treated as a plain policy failure, same
   * as before this option existed.
   */
  universeLiquidity?: { worstTotalCashBase: bigint; observedAtIso: string };
  /**
   * P21 part 2: the ANNUALIZED non-inferiority margin. Defaults to the
   * registered 43 bps; exposed so a sensitivity run can restate it, never so
   * a caller can widen it until the gate passes.
   */
  nonInferiorityMargin?: number;
  /**
   * Dimensions on which the RELEASE ACTUALLY CLAIMS superiority.
   *
   * §11.5 rejects an UNSUPPORTED CLAIM; it does not require a superiority
   * claim to be made. So the superiority check is present only when the claim
   * is, and when present it GATES — an unsupported claim is a rejection
   * condition, not a footnote. The one exception is the NOT INFORMATIVE
   * branch, which the paper says "neither passes nor fails": inside the skill
   * window no policy could have demonstrated superiority, so the claim can be
   * neither supported nor refuted and the check is reported, not gating.
   *
   * Default: no claim, and therefore no superiority check at all.
   */
  claimedSuperiorityDimensions?: readonly 'yield'[];
}

const check = (
  name: string,
  passed: boolean | null,
  detail: string,
  gating = true,
): RegisteredGateCheck => ({ name, passed, detail, gating });

const SECONDS_PER_YEAR = 365 * 86_400;

/**
 * Periods per year, derived from a replay's OWN snapshot cadence.
 *
 * The registered margin is quoted per year and the difference series is per
 * period, so this conversion is load-bearing: assuming daily origins on an
 * hourly dataset would shift the series by 24x the registered margin and call
 * almost anything non-inferior. Derived from the median gap rather than the
 * first one so a single duplicated or missing timestamp cannot set it.
 *
 * `null` when there are too few snapshots, or the cadence is degenerate.
 */
export function periodsPerYearFromSnapshots(
  snapshots: readonly { timestamp: Date }[],
): number | null {
  if (snapshots.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const dt = (snapshots[i]!.timestamp.getTime() - snapshots[i - 1]!.timestamp.getTime()) / 1000;
    if (dt > 0) gaps.push(dt);
  }
  if (gaps.length === 0) return null;
  gaps.sort((x, y) => x - y);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return median > 0 ? SECONDS_PER_YEAR / median : null;
}

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
  opts: {
    minPairedObservations?: number;
    bootstrapSeed?: number;
    bootstrapIterations?: number;
    nonInferiorityMargin?: number;
    significanceLevel?: number;
  } = {},
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

  // The cadence comes from the replay itself, not from an assumption. Both
  // replays cover the same periods (`pairedDifferences` would have thrown
  // otherwise), so SRCLA's snapshots are the cadence for the pair.
  const periodsPerYear =
    periodsPerYearFromSnapshots(srcla.replay.snapshots) ?? REGISTERED_PERIODS_PER_YEAR;

  const nonInferiority = nonInferiorityTest(
    a,
    b,
    opts.nonInferiorityMargin ?? REGISTERED_NONINFERIORITY_MARGIN,
    {
      periodsPerYear,
      bootstrapSeed: opts.bootstrapSeed ?? REGISTERED_BOOTSTRAP_SEED,
      bootstrapIterations: opts.bootstrapIterations ?? 2000,
      ...(opts.minPairedObservations !== undefined
        ? { minObservations: opts.minPairedObservations }
        : {}),
      ...(opts.significanceLevel !== undefined ? { alpha: opts.significanceLevel } : {}),
    },
  );

  // Superiority is the SAME one-sided test at a zero margin.
  const superiority = nonInferiorityTest(a, b, 0, {
    periodsPerYear,
    bootstrapSeed: opts.bootstrapSeed ?? REGISTERED_BOOTSTRAP_SEED,
    bootstrapIterations: opts.bootstrapIterations ?? 2000,
    ...(opts.minPairedObservations !== undefined
      ? { minObservations: opts.minPairedObservations }
      : {}),
    ...(opts.significanceLevel !== undefined ? { alpha: opts.significanceLevel } : {}),
  });

  return {
    tier: srcla.tier.toString(),
    baselineId: baseline.policy.id,
    srclaNetApy: srcla.replay.realizedNetApy,
    baselineNetApy: baseline.replay.realizedNetApy,
    test,
    bootstrap,
    nonInferiority,
    superiority,
    periodsPerYear,
  };
}

/**
 * P22 — the skill window at ONE tier. See {@link SkillWindow}.
 *
 * `sustainableComparatorIds` is the set of baseline ids ADMITTED at this tier
 * by `qualifiesAsComparator` — the single admissibility predicate. Passing
 * the admitted set in rather than re-deriving it here is deliberate: a second
 * derivation is how the yield comparison and the window that qualifies it end
 * up scoring different universes.
 */
export function skillWindow(
  atTier: readonly PolicyRunResult[],
  sustainableComparatorIds: ReadonlySet<string>,
  marginApy: number = REGISTERED_NONINFERIORITY_MARGIN,
): SkillWindow {
  const tier = atTier[0]?.tier.toString() ?? '';
  const hindsight = atTier.find((r) => r.policy.shape === 'hindsight');
  const admitted = atTier.filter((r) => sustainableComparatorIds.has(r.policy.id));

  let best: PolicyRunResult | undefined;
  for (const r of admitted) {
    if (best === undefined || r.replay.realizedNetApy > best.replay.realizedNetApy) best = r;
  }

  const none = (detail: string): SkillWindow => ({
    tier,
    hindsightApy: hindsight?.replay.realizedNetApy ?? null,
    bestBaselineApy: best?.replay.realizedNetApy ?? null,
    bestBaselineId: best?.policy.id ?? null,
    windowApy: null,
    marginApy,
    informative: null,
    detail,
  });

  if (hindsight === undefined) {
    return none(
      'NOT PRODUCED: no bounded-hindsight (B5) run at this tier, so the upper bound on ' +
        'reallocation value is unknown and neither yield statement can be qualified',
    );
  }
  if (best === undefined) {
    return none(
      'NOT PRODUCED: no SUSTAINABLE comparator at this tier, so there is no floor to measure ' +
        'the hindsight bound against',
    );
  }

  const windowApy = hindsight.replay.realizedNetApy - best.replay.realizedNetApy;
  const informative = windowApy > marginApy;
  return {
    tier,
    hindsightApy: hindsight.replay.realizedNetApy,
    bestBaselineApy: best.replay.realizedNetApy,
    bestBaselineId: best.policy.id,
    windowApy,
    marginApy,
    informative,
    detail:
      `bounded hindsight ${(hindsight.replay.realizedNetApy * 100).toFixed(3)}% − best ` +
      `sustainable baseline ${best.policy.id} ${(best.replay.realizedNetApy * 100).toFixed(3)}% ` +
      `= ${(windowApy * 10_000).toFixed(1)} bps vs a ${(marginApy * 10_000).toFixed(1)} bps margin`,
  };
}

/**
 * Run the §11.5 gate over a completed registered evaluation.
 *
 * ORDER IS THE ARGUMENT (paper v0.8, §11.5). Checks are emitted as:
 *
 *   1. DEMONSTRATION — was the vault deployed enough for any sustainability
 *      claim to mean anything? Below the floor nothing else may be claimed,
 *      so this comes first and the criteria below it report NOT DEMONSTRATED.
 *   2. COMPLETENESS — is the evidence base whole?
 *   3. SUSTAINABILITY — the PRIMARY, ABSOLUTE criterion: redeemability under
 *      stress, capacity discipline, operational continuity, and invariance
 *      across vault size.
 *   4. YIELD — scored second, and ONLY among policies that are themselves
 *      sustainable.
 *   5. PRICE OF UNSUSTAINABILITY — what the breaching policies earned, and
 *      what they were displaying while they earned it. A breaching policy is
 *      not a comparator; it is a counterexample, and its return is the
 *      measured price of the thing the study says is not free.
 */
export function evaluateRegisteredRelease(
  out: RegisteredEvaluationResult,
  opts: RegisteredGateOptions = {},
): RegisteredGateResult {
  const minWithdrawalSuccess = opts.minWithdrawalSuccess ?? REGISTERED_MIN_WITHDRAWAL_SUCCESS;
  // The floor the OPTIMISER enforces, imported rather than re-declared:
  // `src/policy/steps/coverage.ts` exists precisely to stop the optimiser and
  // the grader from carrying two copies of this number that can drift apart.
  const minStressed = opts.minStressedLiquidCoverage ?? REGISTERED_COVERAGE_FLOOR;
  const alpha = opts.significanceLevel ?? 0.05;

  const checks: RegisteredGateCheck[] = [];

  // P20: the sustainability criteria GATE on SRCLA's own runs. A comparator
  // is not held to a constraint it never agreed to obey merely by appearing
  // in the same batch as the candidate — but its verdict is computed on
  // IDENTICAL terms, because that verdict is both the admissibility filter
  // for the yield comparison and the counterexample table.
  const srclaResults = out.results.filter((r) => r.policy.id === SRCLA_POLICY.id);
  const otherResults = out.results.filter((r) => r.policy.id !== SRCLA_POLICY.id);
  const sustainability = srclaResults.map(sustainabilityAtTier);
  const comparatorSustainability = otherResults.map(sustainabilityAtTier);
  const comparatorVerdict = new Map<string, SustainabilityVerdict>(
    comparatorSustainability.map((v) => [`${v.policyId}@${v.tier}`, v]),
  );

  // =========================================================================
  // 1. DEMONSTRATION (P25). FIRST, and it gates everything below it.
  //
  // Sustainability must be demonstrated WHILE DEPLOYED. A vault holding idle
  // cash satisfies every redeemability test and has proven nothing: without
  // this floor, B0 (all idle) is the most sustainable policy in the study,
  // and the v0.6 SRCLA — 1.000 stressed coverage at all four tiers on both
  // eras, 0.000% realized on one of them — passes at the tier where it
  // earned nothing.
  // =========================================================================
  const notDemonstrated = sustainability.filter((v) => !v.demonstrated);
  checks.push(
    sustainability.length === 0
      ? check(
          'Demonstration: sustainability was demonstrated while deployed',
          null,
          'NOT PRODUCED: no SRCLA run was available to demonstrate anything',
        )
      : check(
          'Demonstration: sustainability was demonstrated while deployed',
          notDemonstrated.length === 0,
          notDemonstrated.length === 0
            ? `capital at work >= ${REGISTERED_DEMONSTRATION_FLOOR} across all ` +
              `${sustainability.length} SRCLA runs`
            : `NOT DEMONSTRATED at ${notDemonstrated
                .map(
                  (v) =>
                    `${v.policyId}@${v.tier} (realized ${(v.realizedNetApy * 100).toFixed(3)}%)`,
                )
                .join(', ')}: below the ${REGISTERED_DEMONSTRATION_FLOOR} capital-at-work floor, ` +
              `redeemability proves nothing and no sustainability claim may be drawn`,
        ),
  );

  // =========================================================================
  // 2. COMPLETENESS. A tier or a (policy, tier) that was not run cannot be
  //    checked, so it FAILS. `TIERS.every(...)` over the tiers that happened
  //    to be present is what made the missing 10,000 tier invisible.
  // =========================================================================
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

  // The artifact must be calibrated. A provisional one makes every number
  // below non-citable, so it blocks rather than annotating.
  checks.push(
    check(
      'Calibrated artifact',
      !out.provisional,
      out.provisional
        ? `artifact ${out.artifact.artifactHash} is PROVISIONAL: ${out.artifact._provisional ?? ''}`
        : out.artifact.artifactHash,
    ),
  );

  // §11.1's per-policy pinned-prestate fork replay. Unimplemented today:
  // `src/evaluation/fork-runner.ts` is the scaffold and nothing calls it, so
  // this reports NOT PRODUCED and blocks. Skipping it silently is how a
  // paper requirement gets quietly dropped.
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

  // =========================================================================
  // 3. SUSTAINABILITY — the PRIMARY, ABSOLUTE criterion. One check per
  //    criterion, so the report names WHICH one failed rather than reporting
  //    an undifferentiated "unsustainable".
  // =========================================================================

  // S1a — the withdrawal rate. Two rules, both of which this check got wrong
  // before:
  //
  //   * SCOPE (P20). It GATES on SRCLA's own runs only. Ranging over
  //     `out.results` recorded a BASELINE's failed redemption as SRCLA's
  //     failure — the identical misattribution the stressed-coverage check
  //     was rescoped to end, sitting under a comment saying this section was
  //     scoped to SRCLA. A comparator's breach is reported with the same
  //     `reported (not gating):` prefix and carried into the counterexample
  //     table, never blocking.
  //   * THREE-VALUED. An UNMEASURED rate (null: no redemption attempted) is
  //     NOT DEMONSTRATED, not FAILED — the same reading `sustainabilityAtTier`
  //     gives the identical fact, so the report cannot print two verdicts for
  //     one measurement. It still blocks: `null` never rolls up into a pass.
  //     What must never come back is the hardcoded 1.0 that let a zero-cash
  //     policy clear a liquidity gate it was never subjected to.
  const unmeasured = srclaResults.filter((r) => r.replay.withdrawalSuccessRate === null);
  const failedWithdrawals = srclaResults.filter(
    (r) => r.replay.withdrawalSuccessRate !== null && r.replay.withdrawalSuccessRate < minWithdrawalSuccess,
  );
  const reportedWithdrawals = otherResults.filter(
    (r) => r.replay.withdrawalSuccessRate === null || r.replay.withdrawalSuccessRate < minWithdrawalSuccess,
  );
  const reportedWithdrawalDetail =
    reportedWithdrawals.length > 0
      ? ` reported (not gating): ${reportedWithdrawals
          .map((r) =>
            r.replay.withdrawalSuccessRate === null
              ? `${label(r)} not measured`
              : `${label(r)} ${(r.replay.withdrawalSuccessRate * 100).toFixed(1)}%`,
          )
          .join(', ')}`
      : '';
  checks.push(
    check(
      'Safety: withdrawal success measured and met',
      failedWithdrawals.length > 0 ? false : unmeasured.length > 0 ? null : true,
      (failedWithdrawals.length > 0
        ? failedWithdrawals
            .map((r) => `${label(r)} ${(r.replay.withdrawalSuccessRate! * 100).toFixed(1)}%`)
            .join(', ')
        : unmeasured.length > 0
          ? `NOT DEMONSTRATED for ${unmeasured.map(label).join(', ')}: no redemption was attempted`
          : `>= ${(minWithdrawalSuccess * 100).toFixed(0)}% across ${srclaResults.length} SRCLA runs`) +
        reportedWithdrawalDetail,
    ),
  );

  // S2 — stressed liquid coverage, with §11.4's capacity-infeasibility
  // partition. Scoped to SRCLA; a comparator's breach is reported, not
  // gating, and is carried into the counterexample table below.
  const squeezed = srclaResults.filter((r) => r.replay.minStressedLiquidCoverage < minStressed);
  const reportedOnly = otherResults.filter((r) => r.replay.minStressedLiquidCoverage < minStressed);
  checks.push(
    stressedLiquidCoverageCheck(squeezed, srclaResults.length, minStressed, opts.universeLiquidity, reportedOnly),
  );

  // S1b — a bounded COMPLETE exit. Coverage answers "could the vault meet
  // one stress demand"; this answers "could everyone actually get out, and
  // how long would it take". A run that never fully exits scores `null` for
  // `timeToFullExitOrigins`, which is a MEASURED failure, not an absence.
  checks.push(
    sustainabilityCheck(
      'Sustainability S1: complete exit within the registered bound',
      sustainability,
      (v) => v.s1,
      `withdrawals filled and full exit within ${REGISTERED_MAX_EXIT_ORIGINS} origins`,
    ),
  );

  // S3 — capacity discipline. A vault that IS a venue's depth cannot exit it
  // without moving it, so the yield it displays there is not a yield it can
  // realize at size. This is the criterion that makes the 10M tier a real
  // question rather than a rescaling of the 1M one.
  checks.push(
    sustainabilityCheck(
      'Sustainability S3: capacity discipline',
      sustainability,
      (v) => v.s3,
      `no venue share above ${REGISTERED_MAX_VENUE_STRESS_SHARE} at any origin`,
    ),
  );

  // S4 — operational continuity.
  checks.push(
    sustainabilityCheck(
      'Sustainability S4: operational continuity',
      sustainability,
      (v) => v.s4,
      'no policy violation over any run',
    ),
  );

  // P26 — scale invariance. A per-tier pass does NOT aggregate: B4 held
  // 1.000 coverage at 1M and 0.590 at 10M on the same era with an identical
  // return, and no metric averaged over tiers can see that. A demonstrated
  // breach at any tier outranks a NOT DEMONSTRATED at another.
  const invariant = scaleInvariant(sustainability);
  const breaching = sustainability.filter((v) => v.sustainable === false);
  const undemonstrated = sustainability.filter((v) => v.sustainable === null);
  checks.push(
    check(
      'Sustainability: scale invariance across every registered tier (P26)',
      invariant,
      invariant === true
        ? `sustainable at all ${sustainability.length} tiers measured`
        : invariant === false
          ? `breaches at ${breaching.map((v) => `${v.policyId}@${v.tier} (${v.breach})`).join('; ')}`
          : sustainability.length === 0
            ? 'NOT DEMONSTRATED: no SRCLA run was available'
            : `NOT DEMONSTRATED at ${undemonstrated
                .map((v) => `${v.policyId}@${v.tier}`)
                .join(', ')} — a tier that proved nothing cannot be counted as invariant`,
    ),
  );

  // =========================================================================
  // 4. YIELD — scored second, and only among comparators that are themselves
  //    sustainable.
  // =========================================================================

  // An INERT ablation removed nothing on this dataset: its decision sequence
  // is byte-identical to SRCLA's, so any delta reported for it is noise and
  // attributing it to the removed component is a misattribution.
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

  // §11.5's statistical criterion, per deployable, ADMISSIBLE baseline per
  // tier, on AFTER-COST per-period returns.
  //
  //   - B5 (and any other `deployable: false` row): §11.2 says it "cannot
  //     establish deployability".
  //   - Every §11.3 ablation (P21): an ablation beating SRCLA is a finding
  //     about the removed component, reported via `ablationContributions` --
  //     folding it in here is what turned that diagnostic into an
  //     undifferentiated gate failure in the v0.6 run.
  //   - P20/P24: a comparator that is not itself SUSTAINABLE. This is the
  //     one and only admissibility predicate in the tree
  //     (`qualifiesAsComparator`), and it replaces the provisional inline
  //     coverage test this loop carried through Tasks 9/10. B1/B2/B2u
  //     earning 39% while holding 0.878 coverage against the 0.99 floor is
  //     not a baseline SRCLA has to beat -- it is a counterexample, and its
  //     return is published below as the price of unsustainability.
  const ablationIds = new Set(REGISTERED_ABLATIONS.map((p) => p.id));
  const comparisons: BaselineComparison[] = [];
  const excludedComparators: Array<{ baselineId: string; tier: string; reason: string }> = [];
  const tiers = [...new Set(out.results.map((r) => r.tier.toString()))].sort((x, y) =>
    BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0,
  );

  const margin = opts.nonInferiorityMargin ?? REGISTERED_NONINFERIORITY_MARGIN;
  const compareOpts: Parameters<typeof compareToBaseline>[2] = {
    nonInferiorityMargin: margin,
    significanceLevel: alpha,
  };
  if (opts.minPairedObservations !== undefined) compareOpts.minPairedObservations = opts.minPairedObservations;
  if (opts.bootstrapSeed !== undefined) compareOpts.bootstrapSeed = opts.bootstrapSeed;
  if (opts.bootstrapIterations !== undefined) compareOpts.bootstrapIterations = opts.bootstrapIterations;

  /** Baseline ids ADMITTED at each tier — the universe both yield statements are scored on. */
  const admittedByTier = new Map<string, Set<string>>();

  for (const tier of tiers) {
    const atTier = out.results.filter((r) => r.tier.toString() === tier);
    const srcla = atTier.find((r) => r.policy.id === SRCLA_POLICY.id);
    if (srcla === undefined) continue; // already failed the completeness check
    const admitted = new Set<string>();
    admittedByTier.set(tier, admitted);
    for (const b of atTier) {
      if (b.policy.id === SRCLA_POLICY.id) continue;
      if (ablationIds.has(b.policy.id)) continue; // §11.3 evidence, not a §11.2 comparator
      if (!b.policy.deployable) continue;
      const verdict = comparatorVerdict.get(`${b.policy.id}@${tier}`);
      if (verdict === undefined || !qualifiesAsComparator(verdict)) {
        excludedComparators.push({
          baselineId: b.policy.id,
          tier,
          reason: verdict?.breach ?? 'NOT PRODUCED: no sustainability verdict',
        });
        continue;
      }
      admitted.add(b.policy.id);
      comparisons.push(compareToBaseline(srcla, b, compareOpts));
    }
  }

  // P22 — the skill window, per tier, over the SAME admitted universe the
  // yield comparison used. Computed here and published whatever it says.
  const skillWindows = tiers.map((tier) =>
    skillWindow(
      out.results.filter((r) => r.tier.toString() === tier),
      admittedByTier.get(tier) ?? new Set<string>(),
      margin,
    ),
  );
  // PER TIER, and that is the whole point. §11.5 defines the window against
  // "the best baseline that is itself sustainable AT THAT TIER", and B4 held
  // 1.000 coverage at 1M and 0.590 at 10M on the same era — the admitted
  // universe genuinely differs by tier, so the window does too. Collapsing to
  // a single global flag scored superiority at tiers where it was not
  // resolvable AND, worse, suppressed the mandated weak-evidence disclosure
  // at the narrow tiers whenever any one tier happened to be wide.
  const windowByTier = new Map<string, SkillWindow>(skillWindows.map((w) => [w.tier, w]));
  const producedWindows = skillWindows.filter((w) => w.informative !== null);
  /** Tiers whose window is measured and INSIDE the margin. */
  const narrowTiers = skillWindows.filter((w) => w.informative === false);
  /** Tiers whose window is wide enough to resolve a superiority claim. */
  const informativeTiers = skillWindows.filter((w) => w.informative === true);
  const windowSummary = skillWindows.map((w) => `${w.tier}: ${w.detail}`).join('; ');
  const isResolvableTier = (tier: string): boolean =>
    windowByTier.get(tier)?.informative === true;

  const noAdmissibleComparator = comparisons.length === 0 && excludedComparators.length > 0;
  const notProducedDetail = noAdmissibleComparator
    ? `NO ADMISSIBLE COMPARATOR: every deployable baseline was itself unsustainable at the ` +
      `criteria SRCLA is held to (${excludedComparators
        .map((e) => `${e.baselineId}@${e.tier}: ${e.reason}`)
        .join('; ')})`
    : 'NOT PRODUCED: no SRCLA-vs-baseline comparison was available';

  // -------------------------------------------------------------------------
  // The two-sided distinguishability statistic: REPORTED, NOT GATING.
  //
  // It was §11.5's criterion in v0.6 and it is not in v0.8 — the word
  // "indistinguishab*" appears nowhere in the v0.8 paper, and the check is
  // absent from §11.5's rejection list. Keeping it as a gate would have
  // reinstated, through a second door, exactly the unattainable yield
  // criterion this task removed through the first: demanding that SRCLA be
  // statistically DISTINGUISHABLE from every sustainable baseline over an
  // 18-43 bps universe is unattainable for precisely the reason
  // non-inferiority replaced outperformance.
  //
  // The statistic is still worth publishing — it says how much resolution the
  // data had — so it is emitted with `gating: false` and named as a
  // diagnostic, rather than deleted.
  // -------------------------------------------------------------------------
  const indistinguishable = comparisons.filter((c) => c.test.usable && c.test.pValue >= alpha);
  const unusable = comparisons.filter((c) => !c.test.usable);
  const distinguishabilityName =
    'Diagnostic: statistical distinguishability from every sustainable baseline';
  checks.push(
    comparisons.length === 0
      ? check(distinguishabilityName, null, notProducedDetail, false)
      : check(
          distinguishabilityName,
          indistinguishable.length === 0 && unusable.length === 0,
          unusable.length > 0
            ? `test not usable for ${unusable.map((c) => `${c.baselineId}@${c.tier} (${c.test.reason})`).join(', ')}`
            : indistinguishable.length > 0
              ? indistinguishable
                  .map((c) => `${c.baselineId}@${c.tier} p=${c.test.pValue.toFixed(3)}`)
                  .join(', ')
              : `p < ${alpha} against all ${comparisons.length} admissible deployable comparisons`,
          false,
        ),
  );

  // -------------------------------------------------------------------------
  // 4a. NON-INFERIORITY — §11.5's yield criterion (P21 part 2), GATING.
  //
  // It replaced outperformance because outperformance was unattainable, not
  // because it was hard: the ENTIRE cross-sectional return available from
  // reallocating among the three admitted venues is 18-43 bps a year, while
  // failing to deploy costs 494. Whose point estimate lands on top over a
  // window that narrow is decided by estimation noise.
  //
  // P22, and this is the half that must not be got wrong: a NARROW skill
  // window does NOT excuse this check. A narrow window makes non-inferiority
  // EASIER, so converting a pass into NOT INFORMATIVE would excuse the
  // candidate from a test it can pass. The window is published beside the
  // result as a POWER DISCLOSURE instead, and the verdict line says plainly
  // that non-inferiority on such a universe is weak evidence of allocation
  // quality — deploy-and-hold would satisfy it too.
  // -------------------------------------------------------------------------
  const marginBps = (margin * 10_000).toFixed(1);
  const nonInferiorName = `Non-inferior to every sustainable baseline (margin ${marginBps} bps)`;
  // PER TIER: the disclosure fires whenever ANY tier's window is inside the
  // margin, and names those tiers. A wide window at one tier says nothing
  // about the resolution available at another, so it must not suppress the
  // disclosure the paper mandates at the narrow ones.
  const weakEvidence =
    narrowTiers.length > 0
      ? ` POWER DISCLOSURE — the skill window is inside the ${marginBps} bps margin at ` +
        `${narrowTiers.length} of ${skillWindows.length} tiers (${narrowTiers
          .map((w) => `${w.tier}: ${w.detail}`)
          .join('; ')}): at those tiers non-inferiority is weak evidence of allocation ` +
        `quality, because deploy-and-hold would also satisfy it.`
      : '';
  const inferior = comparisons.filter((c) => c.nonInferiority.nonInferior === false);
  const unresolved = comparisons.filter((c) => c.nonInferiority.nonInferior === null);
  checks.push(
    comparisons.length === 0
      ? check(
          nonInferiorName,
          null,
          (noAdmissibleComparator
            ? `NO SUSTAINABLE COMPARATOR: every deployable baseline was itself unsustainable at ` +
              `the criteria SRCLA is held to (${excludedComparators
                .map((e) => `${e.baselineId}@${e.tier}: ${e.reason}`)
                .join('; ')})`
            : 'NOT PRODUCED: no SRCLA-vs-baseline comparison was available') + weakEvidence,
        )
      : check(
          nonInferiorName,
          inferior.length > 0 ? false : unresolved.length > 0 ? null : true,
          (inferior.length > 0
            ? `inferior by more than the margin: ${inferior
                .map(
                  (c) =>
                    `${c.baselineId}@${c.tier} SRCLA ${(c.srclaNetApy * 100).toFixed(3)}% vs ` +
                    `${(c.baselineNetApy * 100).toFixed(3)}% (one-sided p=${c.nonInferiority.pValue.toFixed(3)})`,
                )
                .join(', ')}`
            : unresolved.length > 0
              ? `UNRESOLVED for ${unresolved
                  .map((c) => `${c.baselineId}@${c.tier} (${c.nonInferiority.reason})`)
                  .join(', ')}`
              : `within ${marginBps} bps of all ${comparisons.length} sustainable comparators ` +
                `(one-sided HAC p < ${alpha}, block-bootstrap agreeing)`) + weakEvidence,
        ),
  );

  // -------------------------------------------------------------------------
  // 4b. SUPERIORITY — PRESENT ONLY WHEN CLAIMED, and it must not share a
  //     branch with the check above.
  //
  // §11.5 rejects an UNSUPPORTED CLAIM; it does not require the claim to be
  // made. So this check is emitted only when the release actually claims
  // yield superiority, and when emitted it GATES — an unsupported claim is a
  // rejection condition.
  //
  // The one exception, and the OTHER direction of P22: inside the skill
  // window a superiority claim is NOT INFORMATIVE. No policy could have
  // demonstrated yield superiority at that resolution, so the claim can be
  // neither supported nor refuted; the paper says such a case "neither passes
  // nor fails", so that branch — and only that branch — is `gating: false`.
  // A `false` there would be a statement about the universe masquerading as a
  // defect of the policy.
  //
  // Scored PER TIER: only comparisons at a tier whose own window is wide
  // enough are eligible to support or refute the claim.
  // -------------------------------------------------------------------------
  const claimsYieldSuperiority = (opts.claimedSuperiorityDimensions ?? []).includes('yield');
  if (claimsYieldSuperiority) {
    const superiorityName = 'Superiority: yield above every sustainable baseline (claimed)';
    const resolvable = comparisons.filter((c) => isResolvableTier(c.tier));
    // A TEST, not a ranking: `superiority` is the one-sided HAC test at a zero
    // margin, cross-checked by the bootstrap on the same asymmetric rule.
    const notBeaten = resolvable.filter((c) => c.superiority.nonInferior === false);
    const unsettled = resolvable.filter((c) => c.superiority.nonInferior === null);
    const unresolvableNote =
      narrowTiers.length > 0
        ? ` (not resolvable at ${narrowTiers.map((w) => w.tier).join(', ')}: window inside the ` +
          `${marginBps} bps margin)`
        : '';
    checks.push(
      comparisons.length === 0
        ? check(
            superiorityName,
            null,
            noAdmissibleComparator ? notProducedDetail : 'NOT PRODUCED: no comparison available',
          )
        : producedWindows.length === 0
          ? check(
              superiorityName,
              null,
              `NOT PRODUCED: the skill window could not be measured (${windowSummary}), so a ` +
                `claim of yield superiority can be neither supported nor refuted`,
            )
          : informativeTiers.length === 0
            ? check(
                superiorityName,
                null,
                `NOT INFORMATIVE: the skill window is inside the ${marginBps} bps margin at ` +
                  `every tier (${windowSummary}). No policy could have demonstrated yield ` +
                  `superiority at this resolution, so the point-estimate ordering measures ` +
                  `estimation noise — this neither passes nor fails.`,
                false,
              )
            : check(
                superiorityName,
                notBeaten.length > 0 ? false : unsettled.length > 0 ? null : true,
                (notBeaten.length > 0
                  ? `UNSUPPORTED CLAIM: ` +
                    notBeaten
                      .map(
                        (c) =>
                          `${c.baselineId}@${c.tier}: SRCLA ${(c.srclaNetApy * 100).toFixed(3)}% vs ` +
                          `${(c.baselineNetApy * 100).toFixed(3)}% (one-sided p=${c.superiority.pValue.toFixed(3)})`,
                      )
                      .join(', ')
                  : unsettled.length > 0
                    ? `UNRESOLVED for ${unsettled
                        .map((c) => `${c.baselineId}@${c.tier} (${c.superiority.reason})`)
                        .join(', ')}`
                    : `significantly ahead (one-sided p < ${alpha}) of all ${resolvable.length} ` +
                      `sustainable comparators at the ${informativeTiers.length} tiers where the ` +
                      `window can resolve it`) + unresolvableNote,
              ),
    );
  }

  // =========================================================================
  // 5. PRICE OF UNSUSTAINABILITY (§11.5 part 3). Publishing this is a
  //    REQUIREMENT, not a gate: an excluded comparator's return is the whole
  //    point of the study, so it must appear as a measured figure rather
  //    than vanish with the exclusion. The check verifies that the table was
  //    produced, which is why it reads `true` when there is nothing to
  //    publish -- "no policy breached" is a published finding too.
  // =========================================================================
  const counterexamples = comparatorSustainability.filter((v) => v.sustainable !== true);
  checks.push(
    check(
      'Price of unsustainability published',
      true,
      counterexamples.length === 0
        ? 'no comparator breached: nothing to price'
        : counterexamples
            .map(
              (v) =>
                `${v.policyId}@${v.tier} ${(v.realizedNetApy * 100).toFixed(3)}% ` +
                `(displayed−realized ${(v.displayedVsRealizedGapApy * 100).toFixed(3)}pp) — ${v.breach}`,
            )
            .join('; '),
    ),
  );

  // `=== true`, not truthiness: NOT PRODUCED must not verify.
  //
  // `gating !== false` excludes exactly the one REPORTED check (superiority);
  // every other check has `gating: true` and blocks as it always did. A
  // reported check is not evidence of a pass and not evidence of a block, so
  // it appears in neither roll-up.
  const gatingChecks = checks.filter((c) => c.gating !== false);
  const pass = gatingChecks.every((c) => c.passed === true);
  return {
    pass,
    checks,
    comparisons,
    blockedReasons: gatingChecks.filter((c) => c.passed !== true).map((c) => c.name),
    sustainability,
    comparatorSustainability,
    scaleInvariant: invariant,
    excludedComparators,
    skillWindows,
    nonInferiorityMarginApy: margin,
  };
}

/**
 * Roll one sustainability criterion up over SRCLA's per-tier verdicts.
 *
 * Same three-valued ordering as everywhere else: a demonstrated breach at
 * any tier is `false`; otherwise any NOT DEMONSTRATED tier makes the whole
 * criterion `null`; only an all-`true` set verifies. An empty set is `null`
 * — nothing was measured, so nothing passed.
 */
function sustainabilityCheck(
  name: string,
  verdicts: readonly SustainabilityVerdict[],
  read: (v: SustainabilityVerdict) => boolean | null,
  passDetail: string,
): RegisteredGateCheck {
  if (verdicts.length === 0) return check(name, null, 'NOT PRODUCED: no SRCLA run was available');
  const failed = verdicts.filter((v) => read(v) === false);
  if (failed.length > 0) {
    return check(name, false, failed.map((v) => `${v.policyId}@${v.tier}: ${v.breach}`).join('; '));
  }
  const absent = verdicts.filter((v) => read(v) !== true);
  if (absent.length > 0) {
    return check(
      name,
      null,
      `NOT DEMONSTRATED at ${absent.map((v) => `${v.policyId}@${v.tier}`).join(', ')}`,
    );
  }
  return check(name, true, `${passDetail} across all ${verdicts.length} SRCLA runs`);
}

/**
 * §11.3, part 2 (P21): what each ablation's removed component was measured
 * to be worth, at one (ablation, tier).
 *
 * `contribution = SRCLA net APY − ablation net APY`. POSITIVE means removing
 * the component made the policy worse (it was earning its keep); NEGATIVE
 * means removing it made the policy BETTER -- the component cost more than
 * it earned on this data, and an ablation that beats SRCLA is exactly this,
 * not a baseline SRCLA failed to beat. INERT is a distinct, stronger
 * statement: the ablation's decisions are byte-identical to SRCLA's, so its
 * zero delta is by construction, not a measured wash.
 */
export interface AblationContribution {
  policyId: string;
  tier: string;
  contributionPp: number;
  verdict: 'POSITIVE' | 'NEGATIVE' | 'INERT';
}

export function ablationContributions(out: RegisteredEvaluationResult): AblationContribution[] {
  const ablationIds = new Set(REGISTERED_ABLATIONS.map((p) => p.id));
  const tiers = [...new Set(out.results.map((r) => r.tier.toString()))];
  const contributions: AblationContribution[] = [];

  for (const tier of tiers) {
    const srcla = out.results.find((r) => r.policy.id === SRCLA_POLICY.id && r.tier.toString() === tier);
    if (srcla === undefined) continue;

    for (const r of out.results) {
      if (r.tier.toString() !== tier || !ablationIds.has(r.policy.id)) continue;

      const contributionPp = (srcla.replay.realizedNetApy - r.replay.realizedNetApy) * 100;
      const verdict: AblationContribution['verdict'] = r.inertVsSrcla
        ? 'INERT'
        : contributionPp < 0
          ? 'NEGATIVE'
          : 'POSITIVE';

      contributions.push({ policyId: r.policy.id, tier, contributionPp, verdict });
    }
  }

  return contributions;
}

const label = (r: PolicyRunResult): string => `${r.policy.id}@${r.tier}`;

/**
 * The most demanding level in the registered §8.1 stress set, in bps of TVL.
 * Derived from `REGISTERED_STRESS_DEMAND_BPS` by taking its maximum rather
 * than by indexing it, so reordering or extending the registered set cannot
 * silently change which level the gate grades against.
 */
const MAX_STRESS_DEMAND_BPS: number = REGISTERED_STRESS_DEMAND_BPS.reduce(
  (max, bps) => (bps > max ? bps : max),
  0,
);

/**
 * §11.4's stress demand for a tier, in USDC base units: the worst registered
 * demand level applied to TVL. Today that is 5,000 bps (50%) — the same
 * number the optimiser's coverage step uses, now read from the same place.
 */
export const stressDemandBase = (tier: bigint): bigint =>
  (tier * BigInt(MAX_STRESS_DEMAND_BPS)) / 10_000n;

/** Base units (6 dp) rendered as a whole-dollar figure, no separators -- matches how tests match it. */
const usd = (base: bigint): string => (base / 1_000_000n).toString();

/**
 * §11.4 safety: every run's worst stressed-liquid coverage must clear
 * `minStressed`. A sub-threshold run is either a genuine policy failure or,
 * when `universeLiquidity` is supplied and the tier's stress demand exceeds
 * what the three venues held at their worst moment, CAPACITY_INFEASIBLE --
 * no policy could have satisfied it, because the shortfall is arithmetic
 * about §2.1's locked venue set, not an allocation choice.
 *
 * ORDERING, load-bearing: a run only becomes CAPACITY_INFEASIBLE when EVERY
 * sub-threshold run is at an infeasible tier. One genuine failure anywhere
 * in the batch makes the whole check `false`, never `null` -- a real policy
 * defect at a satisfiable tier must not be laundered by an infeasible tier
 * elsewhere in the same run.
 *
 * CAPACITY_INFEASIBLE reports `passed: null`, exactly like NOT PRODUCED.
 * `pass` downstream is `checks.every(c => c.passed === true)`, so `null`
 * NEVER rolls up into a pass -- the gate still blocks. This function must
 * never return `passed: true` for a batch that contains any sub-threshold
 * run, capacity-infeasible or not.
 *
 * P20: `squeezed`/`totalRuns` are SRCLA's own runs only -- this check GATES
 * only on those. `reportedOnly` is every OTHER policy's sub-threshold run in
 * the same batch (a baseline or an ablation that breached the same floor);
 * it is folded into the detail string, prefixed `reported (not gating):`,
 * so a comparator's breach stays visible without ever failing SRCLA's gate.
 */
function stressedLiquidCoverageCheck(
  squeezed: readonly PolicyRunResult[],
  totalRuns: number,
  minStressed: number,
  universeLiquidity: RegisteredGateOptions['universeLiquidity'],
  reportedOnly: readonly PolicyRunResult[] = [],
): RegisteredGateCheck {
  const name = 'Safety: stressed liquid coverage';
  const reportedDetail =
    reportedOnly.length > 0
      ? ` reported (not gating): ${reportedOnly
          .map((r) => `${label(r)} ${r.replay.minStressedLiquidCoverage.toFixed(3)}`)
          .join(', ')}`
      : '';

  if (squeezed.length === 0) {
    return check(name, true, `>= ${minStressed} across ${totalRuns} SRCLA runs${reportedDetail}`);
  }

  if (universeLiquidity === undefined) {
    return check(
      name,
      false,
      squeezed.map((r) => `${label(r)} ${r.replay.minStressedLiquidCoverage.toFixed(3)}`).join(', ') +
        reportedDetail,
    );
  }

  const { worstTotalCashBase, observedAtIso } = universeLiquidity;
  const isInfeasible = (tier: bigint): boolean => stressDemandBase(tier) > worstTotalCashBase;

  const genuine = squeezed.filter((r) => !isInfeasible(r.tier));
  const infeasible = squeezed.filter((r) => isInfeasible(r.tier));

  if (genuine.length > 0) {
    // At least one sub-threshold run is at a SATISFIABLE tier: a real policy
    // failure. Report it as such even if other runs in the same batch are
    // capacity-infeasible -- that never masks this.
    return check(
      name,
      false,
      genuine.map((r) => `${label(r)} ${r.replay.minStressedLiquidCoverage.toFixed(3)}`).join(', ') +
        reportedDetail,
    );
  }

  // Every sub-threshold run is at a tier no venue universe of this size
  // could have satisfied. `passed: null`, same family as NOT PRODUCED --
  // never `true`.
  const infeasibleTiers = [...new Set(infeasible.map((r) => r.tier))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const detail = infeasibleTiers
    .map(
      (tier) =>
        `tier ${tier.toString()} needs $${usd(stressDemandBase(tier))} stressed-liquid but the venue ` +
        `universe held only $${usd(worstTotalCashBase)} at its worst (observed ${observedAtIso}): ` +
        `CAPACITY_INFEASIBLE`,
    )
    .join('; ');
  return check(name, null, detail + reportedDetail);
}
