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
 * Origins required to redeem 100% of NAV, executing only same-transaction
 * exits the venues could actually honour, starting from `stress.startIndex`.
 *
 * `0` means the whole vault was exitable at the stress origin itself. `null`
 * means the series ran out before the vault was fully out — i.e. the vault
 * NEVER fully exits within the observed window. `null` is a MEASURED
 * failure, not a missing measurement, and callers must not read it as "no
 * constraint": `sustainabilityAtTier` fails S1 on it.
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
  stress: { startIndex: number },
): number | null {
  const start = Math.max(0, Math.min(stress.startIndex, series.length));
  const first = series[start];
  if (first === undefined) return null;

  const owed = first.navBase;
  if (owed <= 0n) return 0;

  // Idle is payable immediately, at the stress origin itself.
  let raised = first.idleBase;
  for (let i = start; i < series.length; i++) {
    raised += series[i]!.exitCapacityBase;
    if (raised >= owed) return i - start;
  }
  return null;
}

/**
 * Per venue, the share of that venue the vault itself accounts for,
 * time-weighted over the run.
 *
 * `share_v(t) = vaultBalance_v(t) / venueTotalSupplied_v(t)`, averaged over
 * EVERY origin in the series (an origin where the vault holds nothing there
 * contributes 0, which is the point: a policy that is briefly enormous in a
 * thin venue and otherwise absent has a small time-weighted share, and the
 * criterion is about sustained capacity, not a single hour).
 *
 * This is the "am I the market?" measurement. A vault that is a quarter of a
 * venue cannot exit that venue without moving it, so its own displayed yield
 * there is not a yield it can realize at size — §11.5's capacity-discipline
 * criterion is exactly this.
 */
export function venueStressContribution(
  series: ReadonlyArray<Readonly<Record<string, number>>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (series.length === 0) return out;
  for (const origin of series) {
    for (const [marketId, share] of Object.entries(origin)) {
      out[marketId] = (out[marketId] ?? 0) + share;
    }
  }
  for (const marketId of Object.keys(out)) {
    out[marketId] = out[marketId]! / series.length;
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
