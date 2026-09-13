/**
 * Paper §11.5 parts 1 and 3 — the PRIMARY release criterion (P24–P26, P28).
 *
 * The study's proposition is that the highest available yield is frequently
 * not redeemable. Sustainability is therefore scored FIRST, ABSOLUTELY, and
 * PER TIER; yield is scored afterwards and only among policies that pass
 * here; and a policy that breaches is not a comparator but a COUNTEREXAMPLE,
 * whose return is published as the measured price of unsustainability.
 *
 * P25 is why `demonstrated` gates everything. A vault holding idle cash
 * satisfies every redeemability test and has proven nothing: without a
 * demonstration floor, B0 (all idle) is the most sustainable policy in the
 * study, which is absurd. On the v0.6 data SRCLA held 1.000 stressed
 * coverage at all four tiers on both held-out eras while realizing 0.000% on
 * one of them — a perfect score that must read as NOT DEMONSTRATED, never as
 * a pass. Sustainability has to be demonstrated WHILE DEPLOYED or it is not a
 * demonstration.
 *
 * PURE. Three-valued throughout: `true` verified, `false` failed, `null` NOT
 * DEMONSTRATED / not produced. `null` NEVER rolls up into a pass.
 */
import type { PolicyRunResult } from './harness.js';
import type { GateAmendment } from './gates.js';
import type { ReplaySnapshot } from '../replay/replay.js';

/**
 * Time-weighted capital-at-work below which a run demonstrates nothing.
 *
 * REGISTERED: the paper owner must confirm this value. It is declared once,
 * here, and imported everywhere else — a second copy is how the optimiser and
 * the grader end up disagreeing about what was registered.
 */
export const REGISTERED_DEMONSTRATION_FLOOR = 0.7;
/** Origins a complete redemption may take before S1 fails. REGISTERED. */
export const REGISTERED_MAX_EXIT_ORIGINS = 24;
/** Largest share of a venue the vault may itself account for, at any origin. REGISTERED. */
export const REGISTERED_MAX_VENUE_STRESS_SHARE = 0.25;
/** §11.4's fraction of attempted redemptions that must fill. REGISTERED. */
export const REGISTERED_MIN_WITHDRAWAL_SUCCESS = 0.99;

/**
 * The floor S2 GRADES against — deliberately NOT the same constant the policy
 * filters candidate allocations with.
 *
 * WHY THESE MUST BE TWO CONSTANTS. `REGISTERED_COVERAGE_FLOOR` in
 * `policy/steps/coverage.ts` is an ELIGIBILITY filter inside the optimiser:
 * it decides which allocations SRCLA will consider. S2 is a RELEASE GRADE:
 * it decides whether a completed run is called sustainable. They were one
 * constant, which meant that relaxing the release bar would silently relax
 * the algorithm's own safety filter at the same time — a change to what the
 * vault does, made while intending only to change how it is judged. Keeping
 * them separate lets the controller stay strictly more conservative than the
 * bar it is judged against, which is the correct direction.
 *
 * REGISTERED, and REVISED — see the report's threshold-revision disclosure.
 * The revision's justification: withdrawal demand here is a registered
 * SYNTHETIC schedule, not observed behaviour, so grading it to two decimal
 * places asserts a precision the input does not have. 0.95 still excludes
 * every headline counterexample (B4 at 0.000, B1 at 0.151).
 */
export const REGISTERED_S2_COVERAGE_FLOOR = 0.95;

/** P37 (G3, P34): why a run's stressed coverage fell below the S2 floor. */
export interface S2Attribution {
  kind: 'NO BREACH' | 'VENUE FAILURE' | 'ALLOCATOR ERROR';
  /** Origins below the floor. */
  shortOrigins: number;
  /** Largest share of NAV held in dry venues at a short origin; 0 when none. */
  trappedShareMax: number;
  /** Worst untrapped coverage over the short origins; 1 when none. */
  untrappedCoverageMin: number;
  detail: string;
}

/**
 * P37 (G3): classify an S2 breach. VENUE FAILURE only when, at EVERY origin
 * below `floor`, (1) the vault holds a venue whose `cashBase` is 0 and (2) the
 * untrapped remainder's coverage is at or above `floor`, and (3) at NO origin
 * of the run did an executed deploy enter a venue that was dry there. Every
 * other breach — including one this function cannot see into — is an
 * ALLOCATOR ERROR, which blocks exactly as the registered gate does.
 */
export function attributeS2Breach(
  snapshots: readonly ReplaySnapshot[],
  floor: number = REGISTERED_S2_COVERAGE_FLOOR,
): S2Attribution {
  if (snapshots.length === 0) {
    return {
      kind: 'ALLOCATOR ERROR',
      shortOrigins: 0,
      trappedShareMax: 0,
      untrappedCoverageMin: 1,
      detail: 'ALLOCATOR ERROR: no per-origin snapshots to attribute the breach to a venue',
    };
  }
  const short = snapshots.filter((s) => s.stressedLiquidCoverage < floor);
  if (short.length === 0) {
    return {
      kind: 'NO BREACH',
      shortOrigins: 0,
      trappedShareMax: 0,
      untrappedCoverageMin: 1,
      detail: `no origin below ${floor}`,
    };
  }

  // M-1 / R5: `executedDeployBaseByMarket` is required by `ReplaySnapshot` and
  // `runReplay` always writes it, so only a hand-built or deserialized
  // snapshot (e.g. a persisted run record predating P37) can arrive without
  // it. The `?? {}` below reads a missing field as "no deploy into a dry
  // venue", which FAILS OPEN exactly where the other two conditions fail
  // closed to "unexplained" -- an attribution this function cannot actually
  // compute must never read as VENUE FAILURE.
  if (snapshots.some((s) => s.executedDeployBaseByMarket === undefined)) {
    return {
      kind: 'ALLOCATOR ERROR',
      shortOrigins: short.length,
      trappedShareMax: 0,
      untrappedCoverageMin: 1,
      detail:
        'ALLOCATOR ERROR: attribution data missing -- at least one snapshot has no ' +
        'executedDeployBaseByMarket, so the breach cannot be attributed to a venue',
    };
  }

  const intoDry = snapshots.filter((s) =>
    (s.dryMarketIds ?? []).some((m) => ((s.executedDeployBaseByMarket ?? {})[m] ?? 0n) > 0n),
  );
  let trappedShareMax = 0;
  let untrappedCoverageMin = 1;
  let unexplained = 0;
  for (const s of short) {
    const holdings = s.holdingsBaseByMarket ?? {};
    const trappedBase = (s.dryMarketIds ?? []).reduce((sum, m) => sum + (holdings[m] ?? 0n), 0n);
    const share = s.totalAssets > 0n ? Number(trappedBase) / Number(s.totalAssets) : 0;
    const untrapped = s.untrappedStressedLiquidCoverage ?? s.stressedLiquidCoverage;
    if (share > trappedShareMax) trappedShareMax = share;
    if (untrapped < untrappedCoverageMin) untrappedCoverageMin = untrapped;
    if (!(trappedBase > 0n && untrapped >= floor)) unexplained += 1;
  }

  const measured = { shortOrigins: short.length, trappedShareMax, untrappedCoverageMin };
  if (unexplained === 0 && intoDry.length === 0) {
    return {
      ...measured,
      kind: 'VENUE FAILURE',
      detail:
        `VENUE FAILURE (P34): ${short.length} origin(s) below ${floor}, every one explained by a ` +
        `position trapped in a venue with zero withdrawable cash (up to ` +
        `${(trappedShareMax * 100).toFixed(1)}% of NAV); coverage on the untrapped part stayed ` +
        `>= ${floor} (worst ${untrappedCoverageMin.toFixed(3)}), and no deploy entered a dry venue`,
    };
  }
  return {
    ...measured,
    kind: 'ALLOCATOR ERROR',
    detail:
      intoDry.length > 0
        ? `ALLOCATOR ERROR: the run deployed into a venue with zero withdrawable cash at ` +
          `${intoDry.length} origin(s)`
        : `ALLOCATOR ERROR: ${unexplained} of ${short.length} origin(s) below ${floor} are not ` +
          `explained by a trapped position (untrapped coverage worst ${untrappedCoverageMin.toFixed(3)})`,
  };
}

export interface SustainabilityVerdict {
  policyId: string;
  tier: string;
  /** Was the vault actually deployed enough for any of this to mean anything? */
  demonstrated: boolean;
  /** S1 redeemability under stress: withdrawals filled AND a bounded full exit. */
  s1: boolean | null;
  /** S2 stressed liquid coverage at §11.4's worst demand level. */
  s2: boolean | null;
  /** S3 capacity discipline: at no origin is the vault itself the venue's depth. */
  s3: boolean | null;
  /** S4 operational continuity: no policy violation over the run. */
  s4: boolean | null;
  sustainable: boolean | null;
  /** Human-readable reason this is not `true`; `null` when it is. */
  breach: string | null;
  /** Published for every verdict — the price of unsustainability (§11.5 part 3). */
  realizedNetApy: number;
  displayedVsRealizedGapApy: number;
  /** P37 (G3): set only under `amendment: 'p37'` when the S2 floor was breached. */
  s2Attribution?: S2Attribution;
}

/**
 * Grade ONE (policy, tier) run against §11.5's sustainability criteria.
 *
 * ORDERING is the whole point: demonstration comes first and short-circuits.
 * Below the floor every criterion reports `null` (NOT DEMONSTRATED) and no
 * sustainability claim may be drawn from the run at all — not even a
 * negative one.
 *
 * Combination, once demonstrated: any `false` makes the verdict `false`
 * (a demonstrated breach is the strongest fact available); otherwise any
 * `null` makes it `null`; only an all-`true` set is `true`.
 */
export function sustainabilityAtTier(
  run: PolicyRunResult,
  opts: { amendment?: GateAmendment } = {},
): SustainabilityVerdict {
  const r = run.replay;
  const tier = run.tier.toString();
  const capitalAtWork = r.capitalAtWorkFraction ?? 0;
  const base = {
    policyId: run.policy.id,
    tier,
    realizedNetApy: r.realizedNetApy,
    displayedVsRealizedGapApy: r.displayedVsRealizedGapApy ?? 0,
  };

  if (capitalAtWork < REGISTERED_DEMONSTRATION_FLOOR) {
    return {
      ...base,
      demonstrated: false,
      s1: null,
      s2: null,
      s3: null,
      s4: null,
      sustainable: null,
      breach:
        `NOT DEMONSTRATED: capital at work ${capitalAtWork.toFixed(3)} < ` +
        `${REGISTERED_DEMONSTRATION_FLOOR}; a vault holding idle cash is trivially ` +
        `redeemable and has demonstrated nothing about sustainability ` +
        `(realized ${(r.realizedNetApy * 100).toFixed(3)}%)`,
    };
  }

  // S1 — redeemability under stress. TWO facts, and each can be absent:
  //   * `withdrawalSuccessRate === null` means no redemption was ever
  //     attempted. That is an absent measurement, so S1 is `null`, not a
  //     flattering pass — the exact shape of the old hardcoded 1.0.
  //   * `timeToFullExitOrigins === null` means the vault did not fully exit
  //     within the observed window, and `timeToFullExitCensored` splits that
  //     in two. RIGHT-CENSORED (the era ended before the registered bound
  //     could be tested) is a missing measurement -> `null`. Not censored
  //     (the bound was fully observable and capacity never sufficed) is a
  //     MEASURED failure -> `false`. Reading either as "0 origins" (the
  //     absent-reads-as-success shape) would score the worst possible run as
  //     the best possible one; reading the censored case as a failure would
  //     publish a BREACH for a vault that would have exited fine.
  const wr = r.withdrawalSuccessRate;
  const exitOrigins = r.timeToFullExitOrigins;
  const exitCensored = r.timeToFullExitCensored ?? false;
  const exitUnmeasured = exitOrigins === undefined || (exitOrigins === null && exitCensored);
  const s1: boolean | null =
    wr === null || exitUnmeasured
      ? null
      : wr >= REGISTERED_MIN_WITHDRAWAL_SUCCESS &&
        exitOrigins !== null &&
        exitOrigins <= REGISTERED_MAX_EXIT_ORIGINS;

  // S2 — the §11.4 floor the optimiser itself enforces, imported rather than
  // re-declared so the two cannot drift apart.
  // P37 (G3, P34): under the amendment a breach fully explained by a venue's
  // failure does not fail S2. Under v0.10 `s2Attribution` stays null and S2 is
  // exactly the registered comparison.
  //
  // FAIL CLOSED: `floorBreached` is the run-level fact (§11.4's
  // `minStressedLiquidCoverage`), computed independently of the per-origin
  // attribution below. `attributeS2Breach` looks only at `r.snapshots`, so if
  // that array is inconsistent with the run-level minimum (missing an origin,
  // stale replay data) it can come back 'NO BREACH' even though S2 has
  // failed. That must never read as a pass: a 'NO BREACH' result is
  // downgraded to ALLOCATOR ERROR whenever `floorBreached` is true, so an
  // unattributable breach always blocks exactly as v0.10 does.
  const floorBreached = r.minStressedLiquidCoverage < REGISTERED_S2_COVERAGE_FLOOR;
  let s2Attribution: S2Attribution | null = null;
  if (opts.amendment === 'p37' && floorBreached) {
    const attribution = attributeS2Breach(r.snapshots ?? []);
    s2Attribution =
      attribution.kind === 'NO BREACH'
        ? {
            ...attribution,
            kind: 'ALLOCATOR ERROR',
            detail:
              `ALLOCATOR ERROR: S2 failed at the run level (min stressed liquid coverage ` +
              `${r.minStressedLiquidCoverage.toFixed(3)}) but no per-origin snapshot fell below ` +
              `${REGISTERED_S2_COVERAGE_FLOOR} — inconsistent replay data, so the breach cannot be ` +
              `attributed to a venue`,
          }
        : attribution;
  }
  const s2 = !floorBreached || s2Attribution?.kind === 'VENUE FAILURE';

  // S3 — venue-stress share, graded on the MAXIMUM share over origins. This
  // is the SECOND of §11.5 S3's two clauses; the first — that the vault's own
  // deposits do not push a venue past its registered utilization ceiling — is
  // NOT EVALUATED anywhere, and is disclosed as such by the gate check and
  // the rendered report rather than being implied by a "capacity discipline"
  // label. Graded on the MAXIMUM share over origins: the
  // constraint is instantaneous (see `venueStressContribution`), and it is
  // graded the same way S2 and the exit time are, on the worst moment rather
  // than on an average that dilutes it. An empty contribution map means the
  // vault held nothing anywhere, which cannot happen above the floor.
  const shares = Object.values(r.venueStressContribution ?? {});
  const worstShare = shares.length === 0 ? 0 : Math.max(...shares);
  const s3 = worstShare <= REGISTERED_MAX_VENUE_STRESS_SHARE;

  // S4 — ACTION VALIDITY. `policyViolations` counts actions the venue set
  // could not honour as proposed (see `replay/replay.ts`): a deploy into a
  // paused or absent venue, or a divest from a venue holding nothing. §11.5's
  // S4 additionally names cap, dependency, reserve and loss violations and
  // unrecoverable plan state; NONE of those five is measured here, and the
  // gate check carrying this value is named and detailed accordingly rather
  // than claiming "operational continuity".
  const s4 = (r.policyViolations ?? 0) === 0;

  const failed: string[] = [];
  if (s1 === false) {
    failed.push(
      `S1 redeemability (withdrawals ${((wr ?? 0) * 100).toFixed(1)}%, full exit ` +
        `${exitOrigins === null || exitOrigins === undefined ? 'NEVER (capacity never sufficed)' : `${exitOrigins} origins`} vs ` +
        `${REGISTERED_MAX_EXIT_ORIGINS})`,
    );
  }
  // §11.5 part 5 requires the criterion AND THE MARGIN by which it broke.
  // S1 and S3 always carried their thresholds; S2 and S4 did not, so the
  // headline counterexample -- B1 at 0.878 against the 0.99 floor -- printed
  // `S2 stressed coverage 0.878` with the floor appearing nowhere in the
  // report, leaving the 0.112 margin underivable from the table that carries
  // the paper's central argument.
  if (!s2) {
    failed.push(
      `S2 stressed coverage ${r.minStressedLiquidCoverage.toFixed(3)} vs floor ` +
        `${REGISTERED_S2_COVERAGE_FLOOR.toFixed(3)} (short by ` +
        `${(REGISTERED_S2_COVERAGE_FLOOR - r.minStressedLiquidCoverage).toFixed(3)})`,
    );
  }
  if (!s3) {
    failed.push(
      `S3 venue-stress share (worst venue share ${worstShare.toFixed(3)} vs ` +
        `${REGISTERED_MAX_VENUE_STRESS_SHARE}; §11.5 S3's utilization-ceiling clause NOT EVALUATED)`,
    );
  }
  if (!s4) {
    failed.push(
      `S4 action validity (${r.policyViolations ?? 0} invalid actions vs 0 permitted, so over by ` +
        `${r.policyViolations ?? 0}; §11.5's cap/dependency/reserve/loss classes NOT EVALUATED)`,
    );
  }

  const unmeasured = s1 === null;
  const sustainable = failed.length > 0 ? false : unmeasured ? null : true;

  return {
    ...base,
    ...(s2Attribution === null ? {} : { s2Attribution }),
    demonstrated: true,
    s1,
    s2,
    s3,
    s4,
    sustainable,
    breach:
      failed.length > 0
        ? failed.join('; ')
        : unmeasured
          ? `NOT DEMONSTRATED: S1 was not measured — ${
              wr === null
                ? 'no redemption was attempted'
                : 'the observation window ended before a complete exit could be tested (right-censored)'
            }`
          : null,
  };
}

/**
 * P26 — scale invariance, over every tier independently.
 *
 * A per-tier pass does NOT aggregate and no average may stand in for it: B4
 * held 1.000 coverage at the 1M tier and 0.590 at the 10M tier on the same
 * era with an identical return, and a mean over tiers cannot see that.
 *
 * ORDERING, load-bearing: a demonstrated breach at ANY tier outranks a NOT
 * DEMONSTRATED at another, because a proven failure is a stronger fact than
 * an absent measurement. An empty set is `null`, never `true` — nothing was
 * measured, so nothing is invariant.
 */
export function scaleInvariant(verdicts: readonly SustainabilityVerdict[]): boolean | null {
  if (verdicts.length === 0) return null;
  if (verdicts.some((v) => v.sustainable === false)) return false;
  if (verdicts.some((v) => v.sustainable !== true)) return null;
  return true;
}

/**
 * §11.5 part 3: a breaching policy is a COUNTEREXAMPLE, not a comparator.
 *
 * This is the single admissibility predicate for the whole tree. A
 * comparator qualifies only if it is itself sustainable at that tier —
 * `null` (NOT DEMONSTRATED) does not qualify either, because a baseline that
 * never deployed cannot establish that a return is achievable.
 */
export const qualifiesAsComparator = (v: SustainabilityVerdict): boolean => v.sustainable === true;
