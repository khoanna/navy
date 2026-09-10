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

// ===========================================================================
// NON-INFERIORITY (P21 part 2, P22).
//
// WHY THIS REPLACED A SUPERIORITY TEST. Measured on the calibration era, the
// ENTIRE cross-sectional return available from reallocating among the three
// admitted venues is 18-43 basis points a year, against 494 basis points lost
// by not deploying at all. Over a window that narrow, a criterion requiring
// SRCLA to BEAT every deployable baseline is not a demanding test -- it is an
// unattainable one, and what it actually measures is estimation noise. Whose
// point estimate lands on top over a 43 bps spread is decided by the residual
// wobble of the venue rate paths, not by allocation skill.
//
// So the release criterion becomes: SRCLA is NOT WORSE than a sustainable
// comparator BY MORE THAN A REGISTERED MARGIN. That is a claim the data can
// actually settle, and it is the claim the study needs -- the proposition is
// that redeemable yield is scarce, not that SRCLA wins a yield contest.
// ===========================================================================

/**
 * The registered non-inferiority margin, ANNUALIZED: 43 basis points.
 *
 * It is the measured zero-cost skill window -- the top of the 18-43 bps range
 * of cross-sectional return available on the calibration era. Declaring
 * SRCLA non-inferior at this margin says it gives up no more than the entire
 * measured value of reallocation itself.
 *
 * REGISTERED, and UNCONFIRMED: the paper owner must confirm this value before
 * the freeze. It is declared ONCE, here, and imported everywhere else -- a
 * second copy is how the optimiser and the grader end up disagreeing about
 * what was registered. It is serialised into the run record so the artifact
 * can testify to the number that was actually used.
 */
export const REGISTERED_NONINFERIORITY_MARGIN = 0.0043;

/**
 * Periods per year assumed when a caller supplies no cadence.
 *
 * The margin is quoted per YEAR; the difference series is per PERIOD. Getting
 * this conversion wrong in the permissive direction would shift a daily
 * difference series by 43 bps A DAY and call a 25-percentage-point shortfall
 * non-inferior. Callers that know their cadence (the gate derives it from the
 * replay's own snapshot timestamps) must pass it.
 */
export const REGISTERED_PERIODS_PER_YEAR = 365;

export interface NonInferiorityResult extends PairedTestResult {
  /** The annualized margin the test was run at. */
  marginApy: number;
  /** Periods per year used to convert `marginApy` to a per-period shift. */
  periodsPerYear: number;
  /** `marginApy / periodsPerYear` -- what was actually added to each d_t. */
  marginPerPeriod: number;
  /** Significance level the verdict below was taken at. */
  alpha: number;
  /**
   * Distribution-free cross-check on the SAME shifted series: `true` when the
   * one-sided bootstrap lower bound clears zero, `false` when it does not,
   * `null` when the bootstrap could not run.
   */
  bootstrap: BlockBootstrapResult;
  bootstrapAgrees: boolean | null;
  /**
   * `true` non-inferior, `false` inferior by more than the margin, `null` the
   * test could not settle it -- either because it was unusable, or because
   * the HAC test and the distribution-free cross-check DISAGREE. Two methods
   * disagreeing is not a pass; it is an unresolved comparison, and `null`
   * never rolls up into a pass anywhere in this tree.
   */
  nonInferior: boolean | null;
}

/**
 * One-sided paired non-inferiority test on after-cost per-period returns.
 *
 * H0 (what must be REJECTED to claim non-inferiority):
 *     mean(a - b) <= -margin_per_period       "a is worse by at least the margin"
 * H1: mean(a - b) >  -margin_per_period
 *
 * Implemented by shifting the paired difference series up by the per-period
 * margin and testing the shifted mean against zero with the same Newey-West
 * HAC standard error `pairedHacTTest` uses, then cross-checking with the same
 * seeded moving-block bootstrap `compareToBaseline` already runs.
 *
 * `pValue` on the result is ONE-SIDED. That is the whole point: a two-sided
 * p-value would also reject H0 when `a` is spectacularly BETTER than `b`,
 * which is not a failure of non-inferiority.
 *
 * A DEGENERATE difference series (zero long-run variance) reports
 * `usable: false` and `nonInferior: null` rather than a flattering pass --
 * "the test could not run" is not evidence of non-inferiority.
 *
 * @param a - SRCLA's per-period after-cost returns (the candidate).
 * @param b - the comparator's, over the SAME periods.
 * @param marginApy - the non-inferiority margin, ANNUALIZED and non-negative.
 * @throws when `marginApy` is negative or `periodsPerYear` is not positive.
 *   A negative margin would silently invert the test into a superiority one.
 */
export function nonInferiorityTest(
  a: readonly number[],
  b: readonly number[],
  marginApy: number = REGISTERED_NONINFERIORITY_MARGIN,
  opts: {
    periodsPerYear?: number;
    lag?: number;
    minObservations?: number;
    alpha?: number;
    bootstrapSeed?: number;
    bootstrapIterations?: number;
  } = {},
): NonInferiorityResult {
  if (!(marginApy >= 0)) {
    throw new Error(
      `nonInferiorityTest: margin must be non-negative (got ${marginApy}). ` +
        'A negative margin inverts the test into a superiority test.',
    );
  }
  const periodsPerYear = opts.periodsPerYear ?? REGISTERED_PERIODS_PER_YEAR;
  if (!(periodsPerYear > 0)) {
    throw new Error(`nonInferiorityTest: periodsPerYear must be positive (got ${periodsPerYear}).`);
  }
  const alpha = opts.alpha ?? 0.05;
  const marginPerPeriod = marginApy / periodsPerYear;

  const shifted = pairedDifferences(a, b).map((d) => d + marginPerPeriod);
  const zeros = shifted.map(() => 0);

  // DEGENERACY, checked on the RANGE rather than left to the variance.
  //
  // Shifting a constant difference series leaves a constant series, whose
  // long-run variance is zero in exact arithmetic — but `neweyWestVariance`
  // subtracts a floating-point mean, so the deviations come out at ~1e-19
  // instead of 0. That is a standard error small enough to make a t-statistic
  // of ~1e15 and hand back p = 0: the most spectacular possible pass, on a
  // series carrying no information at all. Two policies with identical
  // after-cost returns every period is precisely the case where the answer
  // must be "this test cannot settle it".
  const range =
    shifted.length === 0 ? 0 : Math.max(...shifted) - Math.min(...shifted);
  const magnitude = Math.max(...shifted.map((v) => Math.abs(v)), 0);
  const degenerate = shifted.length > 0 && range <= magnitude * 1e-12;

  const hacOpts: { lag?: number; minObservations?: number } = {};
  if (opts.lag !== undefined) hacOpts.lag = opts.lag;
  if (opts.minObservations !== undefined) hacOpts.minObservations = opts.minObservations;
  const hac = pairedHacTTest(shifted, zeros, hacOpts);

  // `alpha * 2` so the percentile interval's LOWER endpoint is the one-sided
  // alpha-quantile: `movingBlockBootstrap` cuts at alpha/2 on each side.
  const bootstrap = movingBlockBootstrap(shifted, {
    seed: opts.bootstrapSeed ?? REGISTERED_BOOTSTRAP_SEED,
    iterations: opts.bootstrapIterations ?? 2000,
    alpha: Math.min(1, alpha * 2),
    ...(opts.minObservations !== undefined ? { minObservations: opts.minObservations } : {}),
  });

  const common = { marginApy, periodsPerYear, marginPerPeriod, alpha, bootstrap };

  if (degenerate) {
    return {
      ...hac,
      pValue: 1,
      usable: false,
      reason: 'DEGENERATE: the paired difference series has zero long-run variance',
      ...common,
      bootstrapAgrees: null,
      nonInferior: null,
    };
  }

  if (!hac.usable) {
    return { ...hac, pValue: 1, ...common, bootstrapAgrees: null, nonInferior: null };
  }

  const pValue = 1 - normalCdf(hac.tStatistic);
  const hacSays = pValue < alpha;
  const bootstrapAgrees = bootstrap.usable ? bootstrap.lower > 0 : null;

  // THE DISAGREEMENT RULE IS ASYMMETRIC, and deliberately so.
  //
  // The paper calls the moving-block bootstrap a CROSS-CHECK, not a co-equal
  // test, so it may DOWNGRADE a pass but may never UPGRADE a failure:
  //
  //   - HAC says INFERIOR  -> `false`, whatever the bootstrap says. A clean,
  //     measured failure converted into UNRESOLVED buys no strictness (both
  //     block) while losing the finding, and the two methods disagree BY
  //     CONSTRUCTION near p ~ alpha, so the symmetric rule turned every
  //     borderline failure into a shrug.
  //   - HAC says NON-INFERIOR -> `true` only when the distribution-free
  //     cross-check agrees. A pass resting on the normal approximation alone,
  //     contradicted by a method that assumes no distribution, is not
  //     established: it is `null`, and `null` never rolls up into a pass.
  const nonInferior: boolean | null = !hacSays
    ? false
    : bootstrapAgrees === true
      ? true
      : null;

  return {
    ...hac,
    pValue,
    ...common,
    bootstrapAgrees,
    nonInferior,
    reason:
      nonInferior !== null
        ? 'OK'
        : bootstrapAgrees === null
          ? `UNRESOLVED: HAC says non-inferior but the block-bootstrap cross-check could not ` +
            `run (${bootstrap.reason})`
          : `UNRESOLVED: HAC says non-inferior but the block bootstrap disagrees ` +
            `(one-sided lower bound ${bootstrap.lower.toExponential(3)} does not clear zero)`,
  };
}
