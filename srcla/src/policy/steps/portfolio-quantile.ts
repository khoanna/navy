/**
 * P2's portfolio residual quantile `q^p_alpha(w)` — "a calibrated lower
 * quantile of PORTFOLIO horizon residuals **under weights w**" (§8.2).
 *
 * What was there before was a frozen scalar times total notional
 * (`optimize.ts`'s `mu + artifact.portfolioResidualQuantileWad * notional /
 * WAD`). Structurally that is the right place to apply it — once, at
 * portfolio level, not summed per venue — but the term carried **zero
 * cross-venue information**: two candidates deploying the same total in
 * different proportions received an identical quantile term, so P2 could
 * never change a ranking. The shipped value's own note admitted it was not a
 * calibrated dispersion estimate and had been chosen to "stay out of the way
 * of any realistically-yielding venue" (readiness audit NEW-7).
 *
 * The construction here is the paper's definition, computed directly rather
 * than through a distributional assumption: given the aligned panel of
 * per-venue horizon residuals from the calibration split, form the PORTFOLIO
 * residual series under weights w,
 *
 *     r^p_t(w) = sum_i w_i * r_{i,t},   w_i = x_i / sum_j x_j
 *
 * and take its empirical `1 - coverage` lower quantile. It is weight
 * dependent by construction: it responds to the mix, it captures whatever
 * cross-venue correlation the panel contains (three USDC lending venues on
 * Base move together, so a concentrated mix is penalised more than a
 * diversified one of the same size), and it needs no extra registered
 * scalar.
 *
 * P8's band uses the SAME quantity for its dispersion, so a wider-dispersion
 * mix widens the no-trade band rather than the band being a constant that
 * "stays out of the way".
 *
 * PURE: no I/O, no clock, no randomness.
 * UNITS: residuals and the returned quantile are WAD over the horizon;
 * weights are WAD fractions; `target` is USDC base units.
 */
import type { PolicyArtifact, ResidualPanel } from '../types.js';

const WAD = 10n ** 18n;

/**
 * The empirical lower quantile of the portfolio residual series under
 * `target`, in WAD over the horizon, always <= 0.
 *
 * Returns `artifact.portfolioResidualQuantileWad` — the frozen scalar — when
 * the artifact carries no panel, which is the Phase 1 bootstrap's state. The
 * fallback is documented rather than silent: `portfolioQuantileProvenance`
 * below says which of the two a caller got.
 */
/**
 * Memo for `portfolioResidualQuantileFor`, keyed by the residual panel that
 * the quantile is taken over and then by the weight vector.
 *
 * WHY THIS IS NEEDED, AND WHY IT IS EXACT. The quantile is a pure function of
 * `(panel, weights, coverageTarget)` and NOTHING else -- in particular it does
 * not depend on the origin being decided, the tier, or the policy. But §8.2's
 * enumeration calls it once per CANDIDATE, and the candidate grid is the same
 * simplex of weights at every origin. Uncached, a registered era therefore
 * recomputes the identical quantile ~2,000 times over: for each of ~5,151
 * candidates it built a 10,608-element portfolio series in BigInt and then
 * SORTED it, about 170k BigInt operations per candidate, ~8.8 ms each. Over
 * the registered evaluation (16 policies x 4 tiers x 2 eras) that is on the
 * order of three months of CPU, i.e. the evaluation could not be run at all.
 *
 * Caching collapses it to at most one computation per distinct weight vector
 * for the lifetime of the artifact. It changes no result: the cached value is
 * the value the uncached path would have returned, bit for bit. The tests
 * pin this by asserting cached and uncached agree.
 *
 * The outer map is WEAK on the panel, so the cache dies with the artifact
 * rather than pinning every panel a long-lived process ever saw. The inner
 * map is capped: a caller that somehow produces unbounded distinct weights
 * degrades to recomputation rather than growing without limit.
 */
const MAX_CACHED_WEIGHTS = 1 << 16;
const quantileCache = new WeakMap<ResidualPanel, Map<string, bigint>>();

export function portfolioResidualQuantileFor(
  artifact: PolicyArtifact,
  target: ReadonlyMap<string, bigint>,
): bigint {
  const panel = artifact.residualPanel;
  if (panel === undefined || panel.rows.length === 0 || panel.marketIds.length === 0) {
    return artifact.portfolioResidualQuantileWad;
  }

  const weights = portfolioWeightsWad(panel.marketIds, target);
  if (weights === null) return artifact.portfolioResidualQuantileWad;

  // The coverage target is part of the key, not just the panel: the same
  // panel under a different target is a different quantile.
  const key = `${artifact.coverageTarget}|${weights.join(',')}`;
  let byWeights = quantileCache.get(panel);
  if (byWeights === undefined) {
    byWeights = new Map<string, bigint>();
    quantileCache.set(panel, byWeights);
  }
  const hit = byWeights.get(key);
  if (hit !== undefined) return hit;

  const value = computePortfolioResidualQuantile(panel, weights, artifact.coverageTarget);
  if (byWeights.size < MAX_CACHED_WEIGHTS) byWeights.set(key, value);
  return value;
}

/** The uncached computation. Extracted so the cache wraps one expression and
 *  the tests can compare the two paths directly. */
function computePortfolioResidualQuantile(
  panel: ResidualPanel,
  weights: readonly bigint[],
  coverageTarget: number,
): bigint {
  const series: bigint[] = [];
  for (const row of panel.rows) {
    let acc = 0n;
    for (let i = 0; i < panel.marketIds.length; i++) {
      const w = weights[i]!;
      if (w === 0n) continue;
      acc += (w * (row[i] ?? 0n)) / WAD;
    }
    series.push(acc);
  }

  const q = empiricalLowerQuantile(series, coverageTarget);
  // The bound must be conservative: `forecast.ts#lowerBoundAt` rejects a
  // positive quantile outright, and a positive portfolio quantile would push
  // the objective ABOVE the point forecast.
  return q > 0n ? 0n : q;
}

/**
 * Which source the quantile came from, for reporting. A result attributed to
 * "a calibrated robustness term" when it actually used the placeholder
 * scalar would be a misattribution.
 */
export function portfolioQuantileProvenance(
  artifact: PolicyArtifact,
  target: ReadonlyMap<string, bigint>,
): 'calibrated-panel' | 'frozen-scalar' {
  const panel = artifact.residualPanel;
  if (panel === undefined || panel.rows.length === 0 || panel.marketIds.length === 0) {
    return 'frozen-scalar';
  }
  return portfolioWeightsWad(panel.marketIds, target) === null ? 'frozen-scalar' : 'calibrated-panel';
}

/**
 * `w_i = x_i / sum_j x_j` in WAD, aligned to `marketIds`.
 *
 * `null` when the target deploys nothing, or when it deploys ONLY into
 * markets the panel has no residuals for — in both cases there is no
 * portfolio residual series to take a quantile of, and inventing one from
 * the venues that happen to be in the panel would attribute another venue's
 * dispersion to this mix.
 *
 * Weight is normalised over the TOTAL target, including any un-panelled
 * venue, so a mix that is half un-panelled does not have that half's risk
 * quietly reweighted onto the venues that are covered.
 */
export function portfolioWeightsWad(
  marketIds: readonly string[],
  target: ReadonlyMap<string, bigint>,
): bigint[] | null {
  let notional = 0n;
  for (const v of target.values()) {
    if (v > 0n) notional += v;
  }
  if (notional === 0n) return null;

  const weights: bigint[] = [];
  let covered = 0n;
  for (const id of marketIds) {
    const x = target.get(id) ?? 0n;
    const positive = x > 0n ? x : 0n;
    covered += positive;
    weights.push((positive * WAD) / notional);
  }
  return covered === 0n ? null : weights;
}

/**
 * Empirical `1 - coverage` lower quantile of a sample, by the same
 * index rule `calibrateResidualQuantiles` uses per venue — so the per-venue
 * and portfolio quantiles are the same estimator at two aggregation levels
 * rather than two estimators that happen to be nearby.
 */
export function empiricalLowerQuantile(sample: readonly bigint[], coverageTarget: number): bigint {
  if (sample.length === 0) return 0n;
  const sorted = [...sample].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const idx = Math.min(sorted.length - 1, Math.floor((1 - coverageTarget) * sorted.length));
  return sorted[Math.max(0, idx)]!;
}

/**
 * Build the aligned residual panel P2 needs from completed labels.
 *
 * Rows are ORIGINS; a row is kept only when every panel market has a label
 * at that origin, because a portfolio residual needs one observation per
 * venue at the same instant. Filling an absent venue with zero would tell
 * the optimiser that venue had no dispersion that period, which is a
 * fabricated observation, not a missing one.
 *
 * Residuals are taken against each venue's own mean over the labels supplied
 * — the same de-meaning `calibrateResidualQuantiles` performs.
 */
export function buildResidualPanel(
  labels: readonly {
    marketId: string;
    originSeconds: number;
    realizedReturnWad: bigint;
  }[],
  minObservations: number,
): ResidualPanel | undefined {
  const byMarket = new Map<string, Map<number, bigint>>();
  for (const l of labels) {
    const m = byMarket.get(l.marketId) ?? new Map<number, bigint>();
    m.set(l.originSeconds, l.realizedReturnWad);
    byMarket.set(l.marketId, m);
  }

  const marketIds = [...byMarket.keys()]
    .filter((id) => byMarket.get(id)!.size >= minObservations)
    .sort();
  if (marketIds.length === 0) return undefined;

  const means = new Map<string, bigint>();
  for (const id of marketIds) {
    const values = [...byMarket.get(id)!.values()];
    means.set(id, values.reduce((s, v) => s + v, 0n) / BigInt(values.length));
  }

  // Origins where EVERY panel market has an observation.
  const origins = [...byMarket.get(marketIds[0]!)!.keys()]
    .filter((t) => marketIds.every((id) => byMarket.get(id)!.has(t)))
    .sort((a, b) => a - b);
  if (origins.length < minObservations) return undefined;

  const rows = origins.map((t) =>
    marketIds.map((id) => byMarket.get(id)!.get(t)! - means.get(id)!),
  );

  // A panel in which every residual is exactly zero has not measured a
  // dispersion of zero — it has measured nothing (a synthetic constant-rate
  // window, or a venue whose rate never moved across the whole calibration
  // split). Returning it would make `q^p_alpha(w)` identically 0, i.e. the
  // MOST OPTIMISTIC value possible, silently overriding the artifact's
  // registered conservative quantile. `forecast.ts#quantileFor` refuses the
  // same fallback for exactly this reason. Report "no calibration" instead
  // and let the registered scalar govern.
  if (rows.every((row) => row.every((v) => v === 0n))) return undefined;

  return { marketIds, originsSeconds: origins, rows };
}
