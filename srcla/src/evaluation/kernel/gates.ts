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

  const compareOpts: Parameters<typeof compareToBaseline>[2] = {};
  if (opts.minPairedObservations !== undefined) compareOpts.minPairedObservations = opts.minPairedObservations;
  if (opts.bootstrapSeed !== undefined) compareOpts.bootstrapSeed = opts.bootstrapSeed;
  if (opts.bootstrapIterations !== undefined) compareOpts.bootstrapIterations = opts.bootstrapIterations;

  for (const tier of tiers) {
    const atTier = out.results.filter((r) => r.tier.toString() === tier);
    const srcla = atTier.find((r) => r.policy.id === SRCLA_POLICY.id);
    if (srcla === undefined) continue; // already failed the completeness check
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
      comparisons.push(compareToBaseline(srcla, b, compareOpts));
    }
  }

  const noAdmissibleComparator = comparisons.length === 0 && excludedComparators.length > 0;
  const notProducedDetail = noAdmissibleComparator
    ? `NO ADMISSIBLE COMPARATOR: every deployable baseline was itself unsustainable at the ` +
      `criteria SRCLA is held to (${excludedComparators
        .map((e) => `${e.baselineId}@${e.tier}: ${e.reason}`)
        .join('; ')})`
    : 'NOT PRODUCED: no SRCLA-vs-baseline comparison was available';

  const indistinguishable = comparisons.filter((c) => c.test.usable && c.test.pValue >= alpha);
  const unusable = comparisons.filter((c) => !c.test.usable);
  checks.push(
    comparisons.length === 0
      ? check('Statistically distinguishable from every deployable baseline', null, notProducedDetail)
      : check(
          'Statistically distinguishable from every deployable baseline',
          indistinguishable.length === 0 && unusable.length === 0,
          unusable.length > 0
            ? `test not usable for ${unusable.map((c) => `${c.baselineId}@${c.tier} (${c.test.reason})`).join(', ')}`
            : indistinguishable.length > 0
              ? indistinguishable
                  .map((c) => `${c.baselineId}@${c.tier} p=${c.test.pValue.toFixed(3)}`)
                  .join(', ')
              : `p < ${alpha} against all ${comparisons.length} admissible deployable comparisons`,
        ),
  );

  // Outperformance, on the same admissible deployable set.
  const notBeaten = comparisons.filter((c) => c.srclaNetApy <= c.baselineNetApy);
  checks.push(
    comparisons.length === 0
      ? check(
          'Outperforms every deployable baseline',
          null,
          noAdmissibleComparator ? notProducedDetail : 'NOT PRODUCED: no comparison available',
        )
      : check(
          'Outperforms every deployable baseline',
          notBeaten.length === 0,
          notBeaten.length === 0
            ? `ahead of all ${comparisons.length} admissible deployable comparisons`
            : notBeaten
                .map(
                  (c) =>
                    `${c.baselineId}@${c.tier}: SRCLA ${(c.srclaNetApy * 100).toFixed(3)}% vs ${(c.baselineNetApy * 100).toFixed(3)}%`,
                )
                .join(', '),
        ),
  );

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
  const pass = checks.every((c) => c.passed === true);
  return {
    pass,
    checks,
    comparisons,
    blockedReasons: checks.filter((c) => c.passed !== true).map((c) => c.name),
    sustainability,
    comparatorSustainability,
    scaleInvariant: invariant,
    excludedComparators,
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
