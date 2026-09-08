/**
 * §11.5's statistical criterion, done properly.
 *
 * The 2026-09-08 readiness audit (NEW-13) found the shipped test was:
 *
 *   - **unpaired** — Welch's two-sample t-test — on two series driven by the
 *     same three venue rate paths over the same days. The common factor
 *     (what USDC lending paid that week) dominates both series, so an
 *     unpaired test spends nearly all its variance on a component that
 *     cancels exactly when the series are differenced. It is the wrong test
 *     and a very underpowered one;
 *   - run on **gross** returns, with a lump cost subtracted after the loop,
 *     while §11.5's criterion is explicitly "after-cost";
 *   - **uncorrected for autocorrelation**. Daily venue yields are strongly
 *     persistent; treating n daily observations as n independent draws
 *     understates the standard error and overstates significance. "Newey"
 *     appeared nowhere in this repo outside the paper's own reference list.
 *
 * What is here instead: a PAIRED test on the per-period difference of two
 * AFTER-COST return series, with a Newey-West (Bartlett-kernel) HAC standard
 * error, plus a moving-block bootstrap that makes no distributional
 * assumption at all. Both are seeded and therefore reproducible.
 *
 * The after-cost part is upstream: `replay/replay.ts` charges every
 * execution cost against NAV at the moment it occurs, so the share-price
 * series it emits is already net per period. `periodReturns` reads that
 * series; it does not need to subtract anything.
 *
 * PURE: no I/O, no Date.now(), no unseeded randomness.
 * UNITS: share prices are WAD (1e18); returns are dimensionless fractions.
 */

/**
 * Fixed-point scale for the bigint -> float conversion in `periodReturns`.
 *
 * `Number(sharePriceWad)` is lossy above 2^53, so dividing two converted
 * doubles would let the last digits of a WAD price wander. Dividing in
 * bigint first and converting one small integer keeps 12 significant
 * decimals of the RETURN and makes the conversion deterministic — which
 * matters because these numbers reach a result hash.
 */
const RETURN_SCALE = 10n ** 12n;
const RETURN_SCALE_F = 1e12;

/** A HAC-corrected paired test result. */
export interface PairedTestResult {
  /** Mean per-period difference (a - b), dimensionless. */
  meanDifference: number;
  /** Newey-West standard error of that mean. */
  standardError: number;
  tStatistic: number;
  /** Two-sided p-value under the normal approximation. */
  pValue: number;
  /** Bartlett bandwidth actually used. */
  lag: number;
  /** Number of paired observations. */
  n: number;
  /**
   * False when the test could not be computed on this input (too few paired
   * observations, or a degenerate zero-variance difference series).
   *
   * A caller must treat `usable: false` as a FAILED comparison, never as a
   * passed one. §11.5 fails the policy gate on statistical
   * indistinguishability, and "the test could not run" is not evidence of
   * distinguishability.
   */
  usable: boolean;
  reason: string;
}

export interface BlockBootstrapResult {
  meanDifference: number;
  /** Fraction of centred resamples at least as extreme as the observation. */
  pValue: number;
  /** Percentile confidence interval for the mean difference. */
  lower: number;
  upper: number;
  blockLength: number;
  iterations: number;
  n: number;
  usable: boolean;
  reason: string;
}

/**
 * Per-period simple returns from an after-cost share-price series.
 *
 * `sharePricesWad[i]` is the vault's share price at snapshot i. Because
 * costs are charged against NAV as they occur, the differences below are
 * already net of movement cost, gas and slippage — §11.5's "after-cost".
 *
 * A non-positive previous price yields no observation rather than an
 * Infinity: a period the vault did not exist for is missing data, not a
 * return.
 */
export function periodReturns(sharePricesWad: readonly bigint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < sharePricesWad.length; i++) {
    const prev = sharePricesWad[i - 1]!;
    const curr = sharePricesWad[i]!;
    if (prev <= 0n) continue;
    out.push(Number(((curr - prev) * RETURN_SCALE) / prev) / RETURN_SCALE_F);
  }
  return out;
}

/**
 * The paired difference series d_t = a_t - b_t.
 *
 * @throws when the two series are not the same length. Two policies replayed
 *   over the same dataset produce the same number of periods; a mismatch
 *   means they were not run over the same data, and silently truncating to
 *   the shorter one would compare different windows while looking paired.
 */
export function pairedDifferences(a: readonly number[], b: readonly number[]): number[] {
  if (a.length !== b.length) {
    throw new Error(
      `pairedDifferences: series are not aligned (${a.length} vs ${b.length}). ` +
        'A paired test requires one observation per policy per period.',
    );
  }
  return a.map((x, i) => x - b[i]!);
}

/**
 * Newey-West (1987) bandwidth rule of thumb: floor(4 * (n/100)^(2/9)).
 *
 * Registered, not tuned: it is a function of the sample size alone, so it
 * cannot be chosen after seeing which bandwidth gives the desired p-value.
 */
export function neweyWestLag(n: number): number {
  if (n <= 1) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor(4 * Math.pow(n / 100, 2 / 9))));
}

/**
 * Newey-West long-run variance of the MEAN of an autocorrelated series:
 *
 *   S = gamma_0 + 2 * sum_{j=1..L} (1 - j/(L+1)) * gamma_j
 *   Var(xbar) = S / n
 *
 * The Bartlett weights make S positive semi-definite, so the returned
 * variance is never negative. With `lag = 0` this reduces to the ordinary
 * (i.i.d.) variance of the mean, which is exactly the assumption being
 * corrected.
 */
export function neweyWestVariance(x: readonly number[], lag?: number): number {
  const n = x.length;
  if (n === 0) return 0;
  const L = lag ?? neweyWestLag(n);
  const mean = x.reduce((s, v) => s + v, 0) / n;

  const gamma = (j: number): number => {
    let s = 0;
    for (let t = j; t < n; t++) s += (x[t]! - mean) * (x[t - j]! - mean);
    return s / n;
  };

  let sum = gamma(0);
  for (let j = 1; j <= L; j++) {
    sum += 2 * (1 - j / (L + 1)) * gamma(j);
  }
  return sum <= 0 ? 0 : sum / n;
}

/**
 * Two-sided paired t-test on `a - b` with a Newey-West HAC standard error.
 *
 * @param minObservations - below this, the result is `usable: false` rather
 *   than a flattering p-value. Default 20: a HAC correction estimated from a
 *   handful of points is not a correction.
 */
export function pairedHacTTest(
  a: readonly number[],
  b: readonly number[],
  opts: { lag?: number; minObservations?: number } = {},
): PairedTestResult {
  const d = pairedDifferences(a, b);
  const n = d.length;
  const minObservations = opts.minObservations ?? 20;
  const lag = opts.lag ?? neweyWestLag(n);

  const base = { meanDifference: 0, standardError: 0, tStatistic: 0, pValue: 1, lag, n };

  if (n < minObservations) {
    return {
      ...base,
      usable: false,
      reason: `INSUFFICIENT_OBSERVATIONS: ${n} paired periods < ${minObservations}`,
    };
  }

  const meanDifference = d.reduce((s, v) => s + v, 0) / n;
  const variance = neweyWestVariance(d, lag);
  const standardError = Math.sqrt(variance);

  if (!(standardError > 0)) {
    // Every period identical. Not a significant difference and not a
    // measurable one; say so rather than dividing by zero into Infinity.
    return {
      ...base,
      meanDifference,
      usable: false,
      reason: 'DEGENERATE: the paired difference series has zero long-run variance',
    };
  }

  const tStatistic = meanDifference / standardError;
  return {
    meanDifference,
    standardError,
    tStatistic,
    pValue: 2 * (1 - normalCdf(Math.abs(tStatistic))),
    lag,
    n,
    usable: true,
    reason: 'OK',
  };
}

/**
 * Moving-block bootstrap on the paired difference series (Kunsch 1989).
 *
 * Resamples contiguous blocks so within-block autocorrelation is preserved,
 * then centres the resampled means on the observed mean to simulate the null
 * "no difference". Makes no normality assumption, which the t-test above
 * does.
 *
 * SEEDED. `bootstrapCI` in `metrics/statistics.ts` used bare `Math.random()`,
 * so its interval moved between two runs on identical data — the same
 * reproducibility defect as the unseeded realized-return synthesis in the
 * quarantined runner.
 */
export function movingBlockBootstrap(
  d: readonly number[],
  opts: { blockLength?: number; iterations?: number; seed?: number; alpha?: number; minObservations?: number } = {},
): BlockBootstrapResult {
  const n = d.length;
  const iterations = opts.iterations ?? 10_000;
  const alpha = opts.alpha ?? 0.05;
  const minObservations = opts.minObservations ?? 20;
  // n^(1/3) is the standard order for the moving-block length.
  const blockLength = Math.max(1, Math.min(n, opts.blockLength ?? Math.round(Math.pow(n, 1 / 3))));

  const meanDifference = n > 0 ? d.reduce((s, v) => s + v, 0) / n : 0;
  const base = { meanDifference, pValue: 1, lower: 0, upper: 0, blockLength, iterations, n };

  if (n < minObservations) {
    return {
      ...base,
      usable: false,
      reason: `INSUFFICIENT_OBSERVATIONS: ${n} paired periods < ${minObservations}`,
    };
  }

  const rng = mulberry32(opts.seed ?? REGISTERED_BOOTSTRAP_SEED);
  const starts = n - blockLength + 1;
  const blocksNeeded = Math.ceil(n / blockLength);

  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    let taken = 0;
    for (let bIdx = 0; bIdx < blocksNeeded && taken < n; bIdx++) {
      const start = Math.floor(rng() * starts);
      for (let k = 0; k < blockLength && taken < n; k++) {
        sum += d[start + k]!;
        taken++;
      }
    }
    means.push(sum / n);
  }

  // Two-sided p-value under H0 (mean difference = 0), with the +1/+1
  // correction so a p-value is never exactly zero on a finite resample.
  let extreme = 0;
  for (const m of means) {
    if (Math.abs(m - meanDifference) >= Math.abs(meanDifference)) extreme++;
  }
  const pValue = (1 + extreme) / (iterations + 1);

  const sorted = [...means].sort((x, y) => x - y);
  const lowerIdx = Math.min(sorted.length - 1, Math.floor((iterations * alpha) / 2));
  const upperIdx = Math.min(sorted.length - 1, Math.floor(iterations * (1 - alpha / 2)));

  return {
    ...base,
    pValue,
    lower: sorted[lowerIdx]!,
    upper: sorted[upperIdx]!,
    usable: true,
    reason: 'OK',
  };
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Uniform on [0, 1).
 *
 * Exported so a caller can prove a bootstrap is reproducible: the same seed
 * gives the same interval, on any machine, forever.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal CDF, Abramowitz & Stegun 7.1.26 (|error| < 7.5e-8).
 */
export function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;

  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1 + sign * y);
}

/** Registered default seed for every bootstrap in the evaluation. */
export const REGISTERED_BOOTSTRAP_SEED = 20260908;
