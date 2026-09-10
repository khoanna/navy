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
import { REGISTERED_COVERAGE_FLOOR } from '../../policy/steps/coverage.js';
import type { PolicyRunResult } from './harness.js';

/**
 * Time-weighted capital-at-work below which a run demonstrates nothing.
 *
 * REGISTERED: the paper owner must confirm this value. It is declared once,
 * here, and imported everywhere else — a second copy is how the optimiser and
 * the grader end up disagreeing about what was registered.
 */
export const REGISTERED_DEMONSTRATION_FLOOR = 0.8;
/** Origins a complete redemption may take before S1 fails. REGISTERED. */
export const REGISTERED_MAX_EXIT_ORIGINS = 24;
/** Largest share of a venue the vault may itself account for, at any origin. REGISTERED. */
export const REGISTERED_MAX_VENUE_STRESS_SHARE = 0.25;
/** §11.4's fraction of attempted redemptions that must fill. REGISTERED. */
export const REGISTERED_MIN_WITHDRAWAL_SUCCESS = 0.99;

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
export function sustainabilityAtTier(run: PolicyRunResult): SustainabilityVerdict {
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
  const s2 = r.minStressedLiquidCoverage >= REGISTERED_COVERAGE_FLOOR;

  // S3 — capacity discipline, graded on the MAXIMUM share over origins: the
  // constraint is instantaneous (see `venueStressContribution`), and it is
  // graded the same way S2 and the exit time are, on the worst moment rather
  // than on an average that dilutes it. An empty contribution map means the
  // vault held nothing anywhere, which cannot happen above the floor.
  const shares = Object.values(r.venueStressContribution ?? {});
  const worstShare = shares.length === 0 ? 0 : Math.max(...shares);
  const s3 = worstShare <= REGISTERED_MAX_VENUE_STRESS_SHARE;

  // S4 — operational continuity.
  const s4 = (r.policyViolations ?? 0) === 0;

  const failed: string[] = [];
  if (s1 === false) {
    failed.push(
      `S1 redeemability (withdrawals ${((wr ?? 0) * 100).toFixed(1)}%, full exit ` +
        `${exitOrigins === null || exitOrigins === undefined ? 'NEVER (capacity never sufficed)' : `${exitOrigins} origins`} vs ` +
        `${REGISTERED_MAX_EXIT_ORIGINS})`,
    );
  }
  if (!s2) failed.push(`S2 stressed coverage ${r.minStressedLiquidCoverage.toFixed(3)}`);
  if (!s3) {
    failed.push(
      `S3 capacity discipline (worst venue share ${worstShare.toFixed(3)} vs ` +
        `${REGISTERED_MAX_VENUE_STRESS_SHARE})`,
    );
  }
  if (!s4) failed.push(`S4 continuity (${r.policyViolations ?? 0} policy violations)`);

  const unmeasured = s1 === null;
  const sustainable = failed.length > 0 ? false : unmeasured ? null : true;

  return {
    ...base,
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
