/**
 * The three measurements §11.5's sustainability criteria are graded on, and
 * that no earlier run record produced.
 *
 * The v0.6 run record could say what a policy EARNED and what its worst
 * stressed-coverage ratio was. It could not say how long the vault would take
 * to get everyone out, how much of a venue's own depth the vault itself was,
 * or how far the yield it was shown at deployment stood from the yield it
 * actually realized. Those are the three facts the paper's proposition — that
 * the highest available yield is frequently NOT redeemable — is about, so
 * they are measured here rather than asserted.
 *
 * PURE: no I/O, no clock, no randomness. UNITS: money is bigint USDC base
 * units (6 dp); rates are dimensionless annualized fractions; "origins" are
 * dataset snapshots, not seconds.
 */

/** One origin's exit arithmetic, as the replay observed it. */
export interface ExitOrigin {
  /** Vault NAV at this origin, base units. */
  navBase: bigint;
  /** Idle USDC held at this origin, base units. */
  idleBase: bigint;
  /**
   * What the vault could have pulled out of its venues in the SAME
   * transaction at this origin: `sum_v min(balance_v, venueCash_v)`, base
   * units. The same conservative same-transaction exit the redemption path
   * itself uses.
   */
  exitCapacityBase: bigint;
}

/**
 * The exit measurement, with its censoring made explicit.
 *
 * `origins` is the number of origins a complete redemption needed, or `null`
 * when it did not complete inside the observed window. `censored` says WHY it
 * did not: `true` means the window ran out before the registered bound could
 * even be tested (the worst-coverage origin sat near the era boundary), which
 * is a MISSING measurement; `false` means the bound was fully testable and
 * capacity never sufficed, which is a MEASURED failure. Collapsing the two
 * would publish a spurious BREACH for a vault that would have exited fine.
 */
export interface ExitTimeResult {
  origins: number | null;
  censored: boolean;
}

/**
 * Origins required to redeem 100% of NAV, executing only same-transaction
 * exits the venues could actually honour, starting from `stress.startIndex`.
 *
 * `origins: 0` means the whole vault was exitable at the stress origin
 * itself. `origins: null` means it never completed inside the window — see
 * `censored` above for the distinction the caller must respect.
 *
 * `boundOrigins` is the registered bound the verdict will be graded against,
 * and is used ONLY to decide censoring: if fewer than that many origins
 * remain after the stress origin, a non-completion says nothing about
 * whether the bound was met.
 *
 * BIAS, declared: the per-origin capacities come from a replay in which the
 * vault did NOT exit, so each origin's capacity is an over-estimate of what
 * would still be there after the previous origin's pull, and the venue cash
 * is read as if the vault were the only party withdrawing. The number this
 * returns is therefore a LOWER BOUND on the true exit time. A bound that can
 * only be optimistic is the right shape for a criterion that fails when the
 * number is too large.
 */
export function timeToFullExit(
  series: readonly ExitOrigin[],
  stress: { startIndex: number; boundOrigins: number },
): ExitTimeResult {
  const start = Math.max(0, Math.min(stress.startIndex, series.length));
  const first = series[start];
  // No origin to start from at all: nothing was measured, not a failure.
  if (first === undefined) return { origins: null, censored: true };

  const owed = first.navBase;
  if (owed <= 0n) return { origins: 0, censored: false };

  // Idle is payable immediately, at the stress origin itself.
  let raised = first.idleBase;
  for (let i = start; i < series.length; i++) {
    raised += series[i]!.exitCapacityBase;
    if (raised >= owed) return { origins: i - start, censored: false };
  }
  // Did not complete. RIGHT-CENSORED when the window was too short for the
  // registered bound to have been tested at all.
  const observable = series.length - 1 - start;
  return { origins: null, censored: observable < stress.boundOrigins };
}

/**
 * Per venue, the LARGEST share of that venue the vault itself accounted for
 * over the run.
 *
 * `share_v(t) = vaultBalance_v(t) / venueTotalSupplied_v(t)`, MAXIMISED over
 * origins.
 *
 * Max, not mean, and deliberately so. §11.5's S3 is an INSTANTANEOUS
 * constraint — the vault's own deposits must not push a venue past its
 * registered utilization ceiling — and the failure it guards against
 * (creating the congestion you then have to exit through) happens at a
 * moment, not on average. A mean over every origin also divides by the
 * origins where the vault held nothing there, so a position that is 100% of
 * a thin venue for a tenth of the run would score 0.10 and clear a 0.25
 * threshold. The rest of this file grades the same way: S2 on the minimum
 * coverage, exit time from the worst origin.
 *
 * A venue the vault never held does not appear at all — an absent key is
 * "never touched it", which is not the same statement as a measured 0.
 */
export function venueStressContribution(
  series: ReadonlyArray<Readonly<Record<string, number>>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const origin of series) {
    for (const [marketId, share] of Object.entries(origin)) {
      const seen = out[marketId];
      if (seen === undefined || share > seen) out[marketId] = share;
    }
  }
  return out;
}

/** One origin's advertised-versus-held pair. */
export interface DisplayedOrigin {
  /**
   * The balance-weighted supply rate the vault's venues ADVERTISED at this
   * origin, annualized and dimensionless (0.041 == 4.1%).
   */
  displayedApy: number;
  /** Deployed base units at this origin — the weight, so an idle origin
   *  advertises nothing rather than advertising zero. */
  deployedBase: bigint;
}

/**
 * Advertised rate minus realized return: the gap between the yield the vault
 * was shown while it was deployed and the yield it actually kept.
 *
 * Positive means the displayed rate over-promised — costs, execution, idle
 * drag and rate decay ate the difference. This is the study's headline
 * quantity restated as a scalar, and it is reported for every policy
 * including the ones that breach, because "what the unsustainable policy
 * appeared to offer" is precisely what a counterexample is for.
 *
 * Weighted by deployed capital, so origins where nothing was deployed do not
 * pull the advertised figure toward zero and flatter the gap.
 */
export function displayedVsRealizedGap(
  series: readonly DisplayedOrigin[],
  realizedNetApy: number,
): number {
  let weight = 0;
  let acc = 0;
  for (const o of series) {
    if (o.deployedBase <= 0n) continue;
    const w = Number(o.deployedBase);
    weight += w;
    acc += w * o.displayedApy;
  }
  const displayed = weight === 0 ? 0 : acc / weight;
  return displayed - realizedNetApy;
}
