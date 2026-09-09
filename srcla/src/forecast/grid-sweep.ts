/**
 * The registered forecast grid (paper §7.2, §7.3; amendment P1).
 *
 * WHAT THIS REPLACES. `src/forecast/select.ts` declared a 3x3 grid and then
 * defeated it in four ways, each recorded as a defect in the design's gap
 * catalogue:
 *
 *   F1  `HORIZON_GRID` declared 3 horizons x 3 coverages; `calibrateAllMethods`
 *       took a single horizon and never traversed it.
 *   F2  All nine candidates used q = 5% REGARDLESS of the coverage target, so
 *       99% was never actually evaluated and the reported coverage was an
 *       accident of the data rather than a target that had been solved for.
 *   F3  The selection metrics were fabricated: `rmse = mae * 1.2`, and
 *       `sharpness = pinballLoss = loss`, collapsing §7.3's multi-term loss
 *       into one scalar wearing three names.
 *   F4  Labels were next single observations, not H-period realised returns,
 *       with no availability lag.
 *
 * It was also imported by nothing, and used `require()` inside an ESM module,
 * so it would have thrown if it ever had been. It is deleted rather than
 * repaired: two grids is how the evaluated one and the deployed one drift
 * apart, which is the structural defect this whole phase exists to close.
 *
 * P1 is the substantive change. The quantile is SOLVED per venue to achieve
 * the registered coverage target, rather than fixed at 5% and reported after
 * the fact. The report's evidence for needing this: no candidate reached 95%
 * (best 94.44%) while per-venue coverage was Compound 100%, Moonwell 94.87%,
 * Aave 88.46% -- a pooled fifth percentile cannot serve a smooth series and a
 * volatile one at once.
 *
 * F4 is closed elsewhere and relied on here: labels arrive as
 * `CompletedLabel`s from `evaluation/kernel/decision-input.ts`, which derives
 * H-period realised returns behind an availability lag.
 *
 * PURE: no I/O, no Date.now(), no randomness.
 * UNITS: returns and residuals are WAD over the horizon (not annualized).
 */
import type { CompletedLabel } from '../policy/types.js';

const WAD = 10n ** 18n;

export type ForecastMethod = 'rolling' | 'ew-residual' | 'direct-arx';

/** §7.2's registered horizons, in seconds. */
export const REGISTERED_HORIZONS = [86_400, 604_800, 1_209_600] as const;
/** §7.2's registered coverage targets. */
export const REGISTERED_COVERAGES = [0.9, 0.95, 0.99] as const;

export type RegisteredHorizon = (typeof REGISTERED_HORIZONS)[number];
export type RegisteredCoverage = (typeof REGISTERED_COVERAGES)[number];

export interface GridPoint {
  method: ForecastMethod;
  methodParams: Record<string, number>;
  horizonSeconds: RegisteredHorizon;
  coverageTarget: RegisteredCoverage;
}

/**
 * Method parameters swept alongside the horizon and coverage.
 *
 * Registered here rather than passed in, because a grid whose extent depends
 * on a caller is not a registered grid.
 */
export const METHOD_PARAMS: Readonly<Record<ForecastMethod, Array<Record<string, number>>>> =
  Object.freeze({
    // Trailing mean over the last `windowObservations` completed labels.
    rolling: [{ windowObservations: 24 }, { windowObservations: 72 }, { windowObservations: 168 }],
    // Exponentially weighted mean; smaller decay forgets faster.
    'ew-residual': [{ decay: 0.9 }, { decay: 0.97 }, { decay: 0.99 }],
    // AR(1) on the label series: mu = mean + phi * (last - mean).
    'direct-arx': [{ phi: 0.3 }, { phi: 0.6 }, { phi: 0.9 }],
  });

/**
 * The full registered grid: 3 methods x their parameters x 3 horizons x 3
 * coverage targets.
 */
export function registeredGrid(): GridPoint[] {
  const out: GridPoint[] = [];
  for (const method of ['rolling', 'ew-residual', 'direct-arx'] as const) {
    for (const methodParams of METHOD_PARAMS[method]) {
      for (const horizonSeconds of REGISTERED_HORIZONS) {
        for (const coverageTarget of REGISTERED_COVERAGES) {
          out.push({ method, methodParams, horizonSeconds, coverageTarget });
        }
      }
    }
  }
  return out;
}

/**
 * Solve the residual quantile to ACHIEVE `coverageTarget` (P1).
 *
 * Coverage here is `P(residual >= q)`: the share of outcomes the lower bound
 * `mu + q` actually held for. Sorting ascending and taking index
 * `floor((1 - target) * n)` leaves `n - idx >= target * n` residuals at or
 * above it, so the target is met on the calibration sample by construction
 * rather than hoped for.
 *
 * Clamped at `<= 0`. A positive shrink would raise the lower bound above the
 * mean forecast, which is the one direction a conservative bound must never
 * move; `steps/forecast.ts#lowerBoundAt` refuses one for the same reason.
 */
export function solveQuantileForCoverage(residuals: readonly bigint[], coverageTarget: number): bigint {
  if (residuals.length === 0) {
    throw new Error('solveQuantileForCoverage: no residuals; a quantile cannot be invented');
  }
  if (coverageTarget <= 0 || coverageTarget >= 1) {
    throw new Error(`coverageTarget must be in (0,1), got ${coverageTarget}`);
  }
  const sorted = [...residuals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const idx = Math.min(sorted.length - 1, Math.floor((1 - coverageTarget) * sorted.length));
  const q = sorted[idx]!;
  return q > 0n ? 0n : q;
}

/** Achieved coverage of the bound `mu + q` on a residual sample. */
export function achievedCoverage(residuals: readonly bigint[], q: bigint): number {
  if (residuals.length === 0) return 0;
  return residuals.filter((r) => r >= q).length / residuals.length;
}

/**
 * One-step-ahead mean forecast for a venue's label series.
 *
 * `history` is that venue's completed labels in availability order; the
 * forecast is for the next one. Every method returns a WAD horizon return.
 */
export function meanForecast(
  method: ForecastMethod,
  params: Record<string, number>,
  history: readonly bigint[],
): bigint {
  if (history.length === 0) return 0n;

  if (method === 'rolling') {
    const window = Math.max(1, Math.round(params.windowObservations ?? 24));
    const slice = history.slice(-window);
    return slice.reduce((a, b) => a + b, 0n) / BigInt(slice.length);
  }

  if (method === 'ew-residual') {
    const decay = params.decay ?? 0.97;
    // Weights in integer arithmetic at WAD scale, so the sweep is
    // deterministic across platforms rather than depending on float
    // accumulation order.
    let weightedSum = 0n;
    let weightTotal = 0n;
    for (let i = history.length - 1, age = 0; i >= 0 && age < 512; i--, age++) {
      const w = BigInt(Math.round(Math.pow(decay, age) * 1e9));
      if (w === 0n) break;
      weightedSum += history[i]! * w;
      weightTotal += w;
    }
    if (weightTotal === 0n) return history[history.length - 1]!;
    return weightedSum / weightTotal;
  }

  // direct-arx: AR(1) pull of the latest observation toward the sample mean.
  const phi = BigInt(Math.round((params.phi ?? 0.6) * 1e9));
  const mean = history.reduce((a, b) => a + b, 0n) / BigInt(history.length);
  const last = history[history.length - 1]!;
  return mean + ((last - mean) * phi) / 1_000_000_000n;
}

export interface SelectionLoss {
  /** §7.3 terms, each reported so the total is auditable. */
  pointError: number;
  coverageDeviation: number;
  exceedanceShortfall: number;
  sharpness: number;
  downsideRate: number;
  /**
   * P18 — §7.3's sixth term. Round-trip churn: total notional the REGISTERED
   * DECISION RULE moved under this candidate over the scoring era, as a
   * multiple of vault NAV. Measured over a SEQUENTIAL replay
   * (`forecast/decision-score.ts`), which is what makes "lower is better"
   * correct — over independent cold starts the same quantity measures
   * DEPLOYED FRACTION and the term then penalises putting capital to work.
   * `fitPoint` cannot compute it: it is a property of the decision the
   * forecast produces, not of the forecast itself.
   *
   * A point that has NOT been scored reports 0. `scoreGrid` standardizes on
   * the grid's own spread, so an unscored (hence constant) term contributes
   * exactly 0 to every candidate regardless of weight.
   */
  turnover: number;
  /**
   * P18 — §7.3's seventh term. The candidate's realised net return over the
   * scored era, subtracted from the best realised net return any candidate on
   * this grid achieved: the return this forecast gave up relative to what the
   * grid demonstrably could reach. Lower is better, like every other term
   * here; the grid's best scores exactly 0.
   *
   * This is the term that can see a candidate whose forecast leaves the
   * movement rule unable to act — v0.6 selected a 1-day horizon on a 1.27e-7
   * margin and the policy then executed one rebalance across an 86-day era,
   * which no accuracy statistic in this struct can observe. The FIRST
   * implementation of it could not see that either: it accumulated the edge on
   * legs the hurdle blocked, and a candidate that admits nothing has no legs
   * at all, so it scored the term's BEST value. See
   * `forecast/decision-score.ts#sacrificedReturn`.
   *
   * Measured by `scoreCandidateDecisions` and attached by
   * `attachDecisionTerms`; same zero-when-unscored status as `turnover`.
   */
  sacrificedReturn: number;
  /** Weighted total; lower is better. */
  total: number;
  /** Diagnostics. */
  observations: number;
  achievedCoverage: number;
}

/**
 * §7.3's weights.
 *
 * Registered here, in one place, rather than inlined at the summation. They
 * are stated so a reader can see what the selection actually optimises --
 * `select.ts` had a single scalar and three names for it.
 */
export const LOSS_WEIGHTS = Object.freeze({
  pointError: 1.0,
  /** Missing the registered coverage target is the primary failure. */
  coverageDeviation: 10.0,
  /** How badly the bound was breached when it was breached. */
  exceedanceShortfall: 5.0,
  /** A bound far below the mean is safe and useless; penalised mildly. */
  sharpness: 0.5,
  downsideRate: 1.0,
  /** P18 — churn is a cost, and a candidate that trades more must earn it. */
  turnover: 2.0,
  /** P18 — the heaviest economic term: an unusable forecast is the failure
   *  this whole amendment exists to make visible. */
  sacrificedReturn: 3.0,
});

export interface FitPoint {
  /** Per-venue solved quantiles. */
  quantileWadByMarket: Record<string, bigint>;
  loss: SelectionLoss;
  /** Per-venue achieved coverage, the P1 diagnostic. */
  coverageByMarket: Record<string, number>;
}

/**
 * A term whose interquartile range across the grid is below this is reported
 * as a diagnostic with zero weight.
 *
 * IT IS ZERO, AND ZERO IS NOT A DISABLED GATE -- it is the value at which the
 * gate stops doing something `scoreGrid` already does. A term that is
 * constant across the grid has `sd === 0`, and `scoreGrid`'s `|| 1` fallback
 * then makes its z-score `(raw - mean) / 1 === 0` at EVERY point, so it
 * contributes exactly 0 to every candidate's total whatever its weight.
 * Naming it in `zeroWeighted` as well changes no ordering; it is a label on a
 * term that was already inert. Any positive threshold, by contrast, drops
 * terms that are NOT inert.
 *
 * WHY NOT 1e-4 (ruling R20). The 1e-4 this replaces was chosen before
 * anything had been measured on the real grid, and against a floor-indexed
 * quantile that has since been corrected. Measured on the registered
 * 81-point grid over the 443-day calibration era (886 origins per candidate),
 * the seven raw IQRs were:
 *
 *   pointError           7.64e-5     coverageDeviation    3.54e-5
 *   exceedanceShortfall  2.34e-6     sharpness            1.72e-4
 *   downsideRate         5.72e-2     turnover             4.91e+1
 *   sacrificedReturn     0.00e+0
 *
 * At 1e-4 that gate discards `pointError` (§7.3's first term), discards
 * `coverageDeviation` (weight 10.0, "the primary failure"), discards
 * `exceedanceShortfall` (weight 5.0) -- and keeps `sharpness` (weight 0.5) on
 * the strength of being 2.2x larger in raw magnitude. Every one of those four
 * has real, ordered spread across the grid; what separates them is the UNITS
 * they are measured in, not whether they discriminate. `scoreGrid`
 * standardizes on the grid's own spread BEFORE weighting, so units are
 * already handled there and an absolute gate on RAW values can only
 * re-introduce them.
 *
 * DISCLOSURE (I3): this constant was changed after both the 1e-4 winner and
 * the corrected-threshold winner were visible. The calibration era is not
 * sealed, so that is permitted -- but it is recorded here and in
 * `_registration` rather than presented as an a-priori choice. The change is
 * what admits `coverageDeviation`, whose weight of 10.0 then dominates the
 * winning candidate's total.
 *
 * OPEN, for the paper owner rather than the code: if a gate on
 * non-discrimination is wanted at all, it should be scale-free (IQR relative
 * to the term's own dispersion, or rank-based), not an absolute threshold
 * over seven quantities whose natural units span eight orders of magnitude.
 * That is a change to `scoreGrid`'s contract, so it is reported rather than
 * made here.
 */
export const MIN_DISCRIMINATING_IQR = 0;

export interface ScoredPoint {
  point: GridPoint;
  fit: FitPoint;
  normalized: Record<string, number>;
  total: number;
  /** Terms dropped by the `minIqr` gate. Empty at the registered threshold. */
  zeroWeighted: string[];
  /**
   * §7.3 requires a non-discriminating term to be "reported as a diagnostic
   * and given zero weight". At `MIN_DISCRIMINATING_IQR = 0` the zero-weighting
   * happens implicitly — `sd === 0` makes the z-score 0 at every point via the
   * `|| 1` fallback below — so this list is what keeps the REPORTING half of
   * that clause alive. It names every term with zero sample standard
   * deviation across the grid.
   *
   * NOTE THE LIMIT. Standardization is scale-free, so a term that is pure
   * noise still takes its full weight on its own z-scores; `0` guards only
   * against terms that are EXACTLY constant. Detecting an uninformative but
   * non-constant term is a different test than this one.
   */
  constantTerms: string[];
}

const LOSS_TERMS = [
  'pointError', 'coverageDeviation', 'exceedanceShortfall',
  'sharpness', 'downsideRate', 'turnover', 'sacrificedReturn',
] as const;

/**
 * Linear-interpolated quantile (the R-7 / Excel definition): for sample
 * position `idx = p * (n - 1)`, interpolate between the two bracketing order
 * statistics rather than truncating to one of them.
 *
 * A `floor`-indexed quantile collapses Q1 and Q3 to the SAME order statistic
 * for any `n <= 4` at the 25th/75th percentiles -- worst case `n = 2`, where
 * `floor(0.25 * 1) === floor(0.75 * 1) === 0` makes IQR identically 0
 * regardless of the sample's real spread. That would silently zero-weight
 * every term whenever the grid passed in happens to have exactly two points,
 * which must never be how "nothing discriminates" gets decided.
 */
function interpolatedQuantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0]!;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * frac;
}

/**
 * Interquartile range (Q3 - Q1) via `interpolatedQuantile`. Exported so its
 * behaviour at small `n` -- the case that broke the old `floor`-indexed
 * version -- can be tested directly rather than only inferred through
 * `scoreGrid`'s zero-weighting.
 */
export function interquartileRange(xs: readonly number[]): number {
  const sorted = xs.slice().sort((a, b) => a - b);
  return interpolatedQuantile(sorted, 0.75) - interpolatedQuantile(sorted, 0.25);
}

/**
 * Standardize each term across the grid (z-score on the grid's own spread),
 * then weight. A term is standardized BEFORE weighting so a weight expresses
 * a preference rather than an accident of units.
 *
 * This is a GRID-LEVEL pass over `fitPoint`'s output -- it does not replace
 * `fitPoint`'s own `loss.total` (a raw weighted sum used elsewhere), it ranks
 * across points using scale-normalized terms and drops any term whose spread
 * across the grid cannot discriminate (P18).
 */
export function scoreGrid(
  fits: ReadonlyArray<{ point: GridPoint; fit: FitPoint }>,
  opts: { minIqr: number },
): ScoredPoint[] {
  const stats: Record<string, { mean: number; sd: number; iqr: number; constant: boolean }> = {};
  for (const term of LOSS_TERMS) {
    const xs = fits.map((f) => (f.fit.loss as unknown as Record<string, number>)[term] ?? 0);
    const mean = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
    const rawSd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, xs.length - 1));
    // The `|| 1` is what makes a constant term inert: z becomes (raw-mean)/1,
    // i.e. 0 at every point. `constant` records that it fired, so §7.3's
    // "reported as a diagnostic" clause survives the threshold being 0.
    stats[term] = { mean, sd: rawSd || 1, iqr: interquartileRange(xs), constant: !(rawSd > 0) };
  }
  const zeroWeighted = LOSS_TERMS.filter((t) => stats[t]!.iqr < opts.minIqr);
  const constantTerms = LOSS_TERMS.filter((t) => stats[t]!.constant);

  return fits
    .map(({ point, fit }) => {
      const normalized: Record<string, number> = {};
      let total = 0;
      for (const term of LOSS_TERMS) {
        const raw = (fit.loss as unknown as Record<string, number>)[term] ?? 0;
        const z = (raw - stats[term]!.mean) / stats[term]!.sd;
        normalized[term] = z;
        if (zeroWeighted.includes(term)) continue;
        total += (LOSS_WEIGHTS as unknown as Record<string, number>)[term]! * z;
      }
      return {
        point,
        fit,
        normalized,
        total,
        zeroWeighted: [...zeroWeighted],
        constantTerms: [...constantTerms],
      };
    })
    .sort((a, b) => a.total - b.total);
}

/**
 * Attach P18's two decision-focused terms to a fitted point.
 *
 * They are deliberately NOT folded into `loss.total`. That field is the raw
 * weighted sum of the five ACCURACY terms, every one of which is a
 * horizon-return fraction in [0, 1]-ish units; `turnover` is a multiple of NAV
 * accumulated over hundreds of origins and is two to three orders of magnitude
 * larger. Adding it raw would let one term decide the ranking by scale alone,
 * which is the same defect P18 is closing at the other end (a `downsideRate`
 * near 0.5 dominating a loss nothing else could move). The economic terms
 * enter selection through `scoreGrid`, which standardizes every term on the
 * grid's own spread before weighting it.
 *
 * `selectPoint` therefore stops being the selection rule once these are
 * measured; it survives as the accuracy-only diagnostic the report prints
 * alongside the real ranking.
 */
export function attachDecisionTerms(
  fit: FitPoint,
  terms: { turnover: number; sacrificedReturn: number },
): FitPoint {
  return {
    ...fit,
    loss: { ...fit.loss, turnover: terms.turnover, sacrificedReturn: terms.sacrificedReturn },
  };
}

/**
 * Below this normalized-total margin the grid has NOT distinguished two
 * candidates, and the lexical tie-break (whichever `sort` happened to place
 * first) must not be what decides a registered horizon.
 *
 * 1e-3 of a z-scored, weighted total. The v0.6 selection was made on a margin
 * of 1.27e-7 -- four orders of magnitude inside this -- and produced a horizon
 * the movement rule could not act on.
 */
export const MIN_SELECTION_MARGIN = 1e-3;

/** Which of `resolveNearTie`'s tiers actually decided the selection. */
export type NearTieResolution = 'margin' | 'economics' | 'horizon' | 'indistinguishable';

/** The economic half of the normalized total: the two terms that price what
 *  the decision rule can do with a forecast. Weights come from
 *  `LOSS_WEIGHTS`, never re-declared. */
function economicTotal(s: ScoredPoint): number {
  return (
    s.normalized['turnover']! * LOSS_WEIGHTS.turnover +
    s.normalized['sacrificedReturn']! * LOSS_WEIGHTS.sacrificedReturn
  );
}

/**
 * Which tier decided, reported so a degenerate tie is VISIBLE rather than
 * silently resolved by sort order.
 *
 * `'indistinguishable'` means all three tiers tied: the grid could not
 * separate the two candidates on the total, on the economics, or on horizon.
 * `resolveNearTie` still has to return something, and it returns the
 * sort-order first — but a run that reports `'indistinguishable'` has made a
 * choice the loss does not support, and the report must say so rather than
 * present it as a selection. This is the case IMPORTANT I4 named: within one
 * (horizon, coverage) bucket every method can share a turnover and a
 * sacrificed return, and tier 3 then finds equal horizons.
 */
export function nearTieResolution(scored: readonly ScoredPoint[]): NearTieResolution {
  const [best, runnerUp] = scored;
  if (best === undefined || runnerUp === undefined) return 'margin';
  if (runnerUp.total - best.total >= MIN_SELECTION_MARGIN) return 'margin';
  if (Math.abs(economicTotal(best) - economicTotal(runnerUp)) >= MIN_SELECTION_MARGIN) {
    return 'economics';
  }
  return best.point.horizonSeconds === runnerUp.point.horizonSeconds
    ? 'indistinguishable'
    : 'horizon';
}

/**
 * Resolve a near-tie on ECONOMICS, then on horizon.
 *
 * Three tiers, in order:
 *  1. A real margin on the full normalized total decides outright.
 *  2. Inside the margin, the two ECONOMIC terms alone decide -- the terms
 *     that price what the decision rule can actually do with the forecast.
 *  3. Still tied: take the LONGER horizon. §7.1 -- signal-to-noise rises with
 *     H, so the shorter choice carries strictly more estimation risk, and a
 *     coin-flip that lands on the riskier candidate is not a registration.
 *
 * When even the horizons match there is nothing left to decide on and this
 * returns the sort-order first. That is not a tie-break, it IS the lexical
 * outcome the function exists to avoid, so `nearTieResolution` reports it as
 * `'indistinguishable'` and the caller must surface it.
 *
 * `scored` must be `scoreGrid`'s output, i.e. already sorted ascending by
 * `total`.
 */
export function resolveNearTie(scored: ScoredPoint[]): ScoredPoint {
  if (scored.length === 0) {
    throw new Error('resolveNearTie: the grid produced no scored point');
  }
  const [best, runnerUp] = scored;
  if (runnerUp === undefined) return best!;
  switch (nearTieResolution(scored)) {
    case 'margin':
      return best!;
    case 'economics':
      return economicTotal(best!) < economicTotal(runnerUp) ? best! : runnerUp;
    case 'horizon':
      return best!.point.horizonSeconds >= runnerUp.point.horizonSeconds ? best! : runnerUp;
    default:
      return best!;
  }
}

/**
 * Walk the labels for one grid point, producing per-venue residuals.
 *
 * Strictly causal: the forecast for label `i` uses labels `0..i-1` of that
 * venue only, in availability order. The labels themselves already carry the
 * availability lag, so this is the second of two barriers, not the only one.
 */
export function residualsFor(
  point: GridPoint,
  labels: readonly CompletedLabel[],
  minObservations: number,
): Record<string, bigint[]> {
  const byMarket = new Map<string, bigint[]>();
  for (const l of labels) {
    if (l.horizonSeconds !== point.horizonSeconds) continue;
    const list = byMarket.get(l.marketId) ?? [];
    list.push(l.realizedReturnWad);
    byMarket.set(l.marketId, list);
  }

  const out: Record<string, bigint[]> = {};
  for (const [marketId, series] of byMarket) {
    const residuals: bigint[] = [];
    for (let i = minObservations; i < series.length; i++) {
      const mu = meanForecast(point.method, point.methodParams, series.slice(0, i));
      residuals.push(series[i]! - mu);
    }
    if (residuals.length > 0) out[marketId] = residuals;
  }
  return out;
}

/** Fit and score one grid point on the calibration labels. */
export function fitPoint(
  point: GridPoint,
  labels: readonly CompletedLabel[],
  minObservations: number,
): FitPoint | null {
  const residualsByMarket = residualsFor(point, labels, minObservations);
  const markets = Object.keys(residualsByMarket).sort();
  if (markets.length === 0) return null;

  const quantileWadByMarket: Record<string, bigint> = {};
  const coverageByMarket: Record<string, number> = {};

  let pointErrorSum = 0;
  let exceedanceSum = 0;
  let sharpnessSum = 0;
  let downside = 0;
  let n = 0;
  let coveredTotal = 0;

  for (const marketId of markets) {
    const residuals = residualsByMarket[marketId]!;
    // P1: solved PER VENUE. A pooled quantile cannot serve a smooth series
    // and a volatile one simultaneously -- the report measured Compound at
    // 100% and Aave at 88.46% under one pooled bound.
    const q = solveQuantileForCoverage(residuals, point.coverageTarget);
    quantileWadByMarket[marketId] = q;
    coverageByMarket[marketId] = achievedCoverage(residuals, q);

    for (const r of residuals) {
      const rf = Number(r) / Number(WAD);
      pointErrorSum += Math.abs(rf);
      if (r < q) exceedanceSum += Number(q - r) / Number(WAD);
      sharpnessSum += Number(q < 0n ? -q : q) / Number(WAD);
      if (r < 0n) downside += 1;
      n += 1;
      if (r >= q) coveredTotal += 1;
    }
  }

  if (n === 0) return null;

  const coverage = coveredTotal / n;
  const loss: SelectionLoss = {
    pointError: pointErrorSum / n,
    coverageDeviation: Math.abs(coverage - point.coverageTarget),
    exceedanceShortfall: exceedanceSum / n,
    sharpness: sharpnessSum / n,
    downsideRate: downside / n,
    // P18 — a property of the DECISION, not of the forecast, so it cannot
    // be computed here: measuring it means running `decide` over the era
    // under this candidate. `attachDecisionTerms` fills both in once
    // `forecast/decision-score.ts` has done that. Left at 0 for any caller
    // that only wants the accuracy fit, where scoreGrid's IQR rule
    // zero-weights them.
    turnover: 0,
    sacrificedReturn: 0,
    total: 0,
    observations: n,
    achievedCoverage: coverage,
  };
  loss.total =
    LOSS_WEIGHTS.pointError * loss.pointError +
    LOSS_WEIGHTS.coverageDeviation * loss.coverageDeviation +
    LOSS_WEIGHTS.exceedanceShortfall * loss.exceedanceShortfall +
    LOSS_WEIGHTS.sharpness * loss.sharpness +
    LOSS_WEIGHTS.downsideRate * loss.downsideRate;

  return { quantileWadByMarket, loss, coverageByMarket };
}

export interface SweepRow extends FitPoint {
  point: GridPoint;
}

/** Fit every grid point. Points with too little data are DROPPED, not scored. */
export function sweep(
  labels: readonly CompletedLabel[],
  grid: readonly GridPoint[],
  minObservations: number,
): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const point of grid) {
    const fit = fitPoint(point, labels, minObservations);
    if (fit !== null) rows.push({ point, ...fit });
  }
  return rows;
}

export interface Selection {
  row: SweepRow;
  runnerUp: SweepRow | null;
  /** Loss margin over the runner-up; near zero means the choice is arbitrary. */
  margin: number;
  reason: string;
}

/**
 * Pick the minimum-loss point.
 *
 * Returns the runner-up and the margin as well, so the choice is auditable: a
 * margin near zero says the grid could not distinguish two candidates, which
 * is a fact about the data and belongs in the report rather than being hidden
 * behind a bare winner.
 */
export function selectPoint(rows: readonly SweepRow[]): Selection {
  if (rows.length === 0) {
    throw new Error(
      'selectPoint: the sweep produced no scored grid point. Every candidate had fewer than ' +
        'minObservations labels — collect more calibration data rather than lowering the bar.',
    );
  }
  const sorted = [...rows].sort((a, b) => a.loss.total - b.loss.total);
  const best = sorted[0]!;
  const runnerUp = sorted[1] ?? null;
  const margin = runnerUp === null ? Number.POSITIVE_INFINITY : runnerUp.loss.total - best.loss.total;

  const describe = (r: SweepRow): string =>
    `${r.point.method}(${JSON.stringify(r.point.methodParams)}) ` +
    `H=${r.point.horizonSeconds / 86_400}d cov=${r.point.coverageTarget}`;

  return {
    row: best,
    runnerUp,
    margin,
    reason:
      `selected ${describe(best)} with loss ${best.loss.total.toFixed(8)} ` +
      `(achieved coverage ${(best.loss.achievedCoverage * 100).toFixed(2)}% on ` +
      `${best.loss.observations} residuals)` +
      (runnerUp === null
        ? '; no runner-up, the grid produced one scorable point'
        : `; runner-up ${describe(runnerUp)} at ${runnerUp.loss.total.toFixed(8)}, ` +
          `margin ${margin.toExponential(3)}`),
  };
}
