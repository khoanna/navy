/**
 * §11.5's statistical criterion: paired, after-cost, HAC-corrected.
 *
 * Each test targets one of the three NEW-13 defects, and is written so that
 * reverting the fix makes it fail:
 *   - unpaired Welch on data with a dominant common factor;
 *   - gross rather than after-cost returns;
 *   - no autocorrelation correction, so a persistent series looks far more
 *     significant than it is.
 */
import {
  mulberry32,
  movingBlockBootstrap,
  neweyWestLag,
  neweyWestVariance,
  normalCdf,
  pairedDifferences,
  pairedHacTTest,
  periodReturns,
  REGISTERED_BOOTSTRAP_SEED,
} from '../../../src/evaluation/metrics/significance.js';
import { welchTTest, bootstrapCI } from '../../../src/evaluation/metrics/statistics.js';

const WAD = 10n ** 18n;

/**
 * The shape the real data has: two policies over the same three venues on
 * the same days.
 *
 * A large, strongly persistent COMMON factor (what USDC lending paid that
 * week, AR(1) with phi = 0.95, stationary sd ~4.6e-4) plus a small
 * idiosyncratic wobble per policy (sd ~2e-5) plus a constant `edge` for A.
 * The common factor is ~20x the idiosyncratic one — so it dominates each
 * series and cancels exactly under differencing, which is precisely why an
 * unpaired test on this data is the wrong test.
 */
function commonFactorPair(n: number, edge: number, seed = 99): { a: number[]; b: number[] } {
  const rng = mulberry32(seed);
  const a: number[] = [];
  const b: number[] = [];
  let level = 0.0002;
  for (let i = 0; i < n; i++) {
    level = 0.95 * level + 0.05 * 0.0002 + (rng() - 0.5) * 0.0005;
    a.push(level + edge + (rng() - 0.5) * 0.00007);
    b.push(level + (rng() - 0.5) * 0.00007);
  }
  return { a, b };
}

describe('periodReturns', () => {
  it('reads per-period returns off an after-cost share-price series', () => {
    const prices = [WAD, WAD + WAD / 100n, WAD + (2n * WAD) / 100n];

    const r = periodReturns(prices);

    expect(r).toHaveLength(2);
    expect(r[0]!).toBeCloseTo(0.01, 12);
    expect(r[1]!).toBeCloseTo(0.01 / 1.01, 12);
  });

  // The share price is net of every cost the replay charged, so a policy
  // that churns pays for it INSIDE the series the test consumes. The old
  // harness appended returns before costs and subtracted a lump sum after
  // the loop, which cannot affect any per-period statistic at all.
  it('reflects a cost charged mid-series, period by period', () => {
    const clean = [WAD, WAD + WAD / 100n, WAD + (2n * WAD) / 100n];
    const charged = [WAD, WAD + WAD / 100n - WAD / 1000n, WAD + (2n * WAD) / 100n - WAD / 1000n];

    const a = periodReturns(clean);
    const b = periodReturns(charged);

    expect(b[0]!).toBeLessThan(a[0]!);
    // And the shortfall is confined to the period it was charged in.
    expect(b[1]!).toBeGreaterThan(a[1]!);
  });

  it('emits no observation for a period with a non-positive previous price', () => {
    expect(periodReturns([0n, WAD, WAD + WAD / 100n])).toHaveLength(1);
  });

  it('emits nothing for a series with fewer than two prices', () => {
    expect(periodReturns([WAD])).toEqual([]);
    expect(periodReturns([])).toEqual([]);
  });
});

describe('pairedDifferences', () => {
  it('differences the two series element by element', () => {
    expect(pairedDifferences([3, 5, 7], [1, 2, 3])).toEqual([2, 3, 4]);
  });

  // Silent truncation would compare two different windows while presenting
  // the comparison as paired.
  it('refuses to pair series of different lengths', () => {
    expect(() => pairedDifferences([1, 2, 3], [1, 2])).toThrow(/not aligned/);
  });
});

describe('neweyWestLag', () => {
  it('follows the registered n-only rule of thumb', () => {
    expect(neweyWestLag(100)).toBe(4);
    expect(neweyWestLag(82)).toBe(3);
    expect(neweyWestLag(1)).toBe(0);
    expect(neweyWestLag(0)).toBe(0);
  });

  it('never exceeds the sample it is estimated from', () => {
    expect(neweyWestLag(2)).toBeLessThanOrEqual(1);
  });
});

describe('neweyWestVariance', () => {
  it('reduces to the i.i.d. variance of the mean at lag 0', () => {
    const x = [1, 2, 3, 4, 5];
    const mean = 3;
    const gamma0 = x.reduce((s, v) => s + (v - mean) ** 2, 0) / x.length;

    expect(neweyWestVariance(x, 0)).toBeCloseTo(gamma0 / x.length, 12);
  });

  // THE correction. A positively autocorrelated series carries less
  // information than its length suggests, so the variance of its mean is
  // LARGER than the i.i.d. formula says.
  it('is larger than the i.i.d. variance for a positively autocorrelated series', () => {
    const rng = mulberry32(7);
    const x: number[] = [];
    let level = 0;
    for (let i = 0; i < 200; i++) {
      level = 0.9 * level + (rng() - 0.5);
      x.push(level);
    }

    expect(neweyWestVariance(x)).toBeGreaterThan(neweyWestVariance(x, 0));
  });

  // A GOLDEN value, not an inline reimplementation of the formula: for
  // x = [1,2,3,4,5,4,3,2,1,2] the Bartlett-weighted long-run variance of the
  // mean at L=2 is 0.2979333..., where an UNWEIGHTED truncated sum of the
  // same autocovariances gives 0.3736. The declining triangular weights are
  // what makes the estimator positive semi-definite; dropping them is a
  // different (and not PSD) estimator.
  it('applies the declining Bartlett weights, not a flat truncated sum', () => {
    const x = [1, 2, 3, 4, 5, 4, 3, 2, 1, 2];

    expect(neweyWestVariance(x, 1)).toBeCloseTo(0.2601, 12);
    expect(neweyWestVariance(x, 2)).toBeCloseTo(0.29793333333333338, 12);
    expect(neweyWestVariance(x, 3)).toBeCloseTo(0.2815, 12);
  });

  it('is never negative, even on a strongly negatively autocorrelated series', () => {
    // An unweighted truncated sum of autocovariances is not positive
    // semi-definite and goes negative here; the Bartlett weighting is what
    // keeps a VARIANCE non-negative.
    const alternating = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : -1));

    expect(neweyWestVariance(alternating)).toBeGreaterThanOrEqual(0);
  });

  it('is zero for a constant series', () => {
    expect(neweyWestVariance([2, 2, 2, 2, 2])).toBe(0);
  });

  it('is zero for an empty series', () => {
    expect(neweyWestVariance([])).toBe(0);
  });
});

describe('pairedHacTTest', () => {
  const { a, b } = commonFactorPair(82, 0.00002);

  it('detects a small constant edge that the unpaired test misses', () => {
    // Pairing removes the common market factor; Welch does not, and spends
    // essentially all its variance on it.
    const paired = pairedHacTTest(a, b);
    const unpaired = welchTTest(a, b);

    expect(paired.usable).toBe(true);
    expect(paired.pValue).toBeLessThan(0.05);
    expect(unpaired.pValue).toBeGreaterThan(0.05);
  });

  it('flips the verdict on a persistent difference the uncorrected test calls significant', () => {
    // An AR(1) difference series (phi = 0.95, mean 3e-5). Treating its 120
    // observations as 120 independent draws understates the standard error;
    // the HAC correction widens it, RAISES the p-value, and here reverses
    // the gate outcome. Ignoring it is how a fraction-of-a-basis-point noise
    // advantage clears a significance gate.
    const rng = mulberry32(11);
    const d: number[] = [];
    let level = 0.00003;
    for (let i = 0; i < 120; i++) {
      level = 0.95 * level + 0.05 * 0.00003 + (rng() - 0.5) * 0.0002;
      d.push(level);
    }
    const zero = d.map(() => 0);

    const corrected = pairedHacTTest(d, zero);
    const uncorrected = pairedHacTTest(d, zero, { lag: 0 });

    expect(corrected.lag).toBeGreaterThan(0);
    expect(corrected.standardError).toBeGreaterThan(uncorrected.standardError);
    expect(uncorrected.pValue).toBeLessThan(0.05);
    expect(corrected.pValue).toBeGreaterThan(0.05);
  });

  it('finds no significance when the two series are the same series plus noise', () => {
    const { a: x, b: y } = commonFactorPair(82, 0, 5);
    const jitter = mulberry32(6);
    const noisy = x.map((v) => v + (jitter() - 0.5) * 1e-6);

    expect(pairedHacTTest(noisy, y).pValue).toBeGreaterThan(0.05);
  });

  it('signs the mean difference in the direction of the first argument', () => {
    expect(pairedHacTTest(a, b).meanDifference).toBeGreaterThan(0);
    expect(pairedHacTTest(b, a).meanDifference).toBeLessThan(0);
  });

  it('is deterministic', () => {
    expect(pairedHacTTest(a, b)).toEqual(pairedHacTTest(a, b));
  });

  // ABSENCE IS NOT SUCCESS. Too few periods is "not measured", and the
  // caller must be able to tell that from "measured, no difference".
  it('reports too few paired periods as UNUSABLE rather than as a p-value', () => {
    const short = pairedHacTTest([0.01, 0.02, 0.03], [0, 0, 0]);

    expect(short.usable).toBe(false);
    expect(short.reason).toMatch(/INSUFFICIENT_OBSERVATIONS/);
  });

  it('reports an empty comparison as UNUSABLE', () => {
    expect(pairedHacTTest([], []).usable).toBe(false);
  });

  it('reports an identical pair as UNUSABLE rather than dividing by zero', () => {
    const identical = pairedHacTTest(a, a);

    expect(identical.usable).toBe(false);
    expect(identical.reason).toMatch(/DEGENERATE/);
    expect(Number.isFinite(identical.tStatistic)).toBe(true);
  });

  it('throws rather than truncating when the series are not aligned', () => {
    expect(() => pairedHacTTest(a, b.slice(1))).toThrow(/not aligned/);
  });
});

describe('movingBlockBootstrap', () => {
  const d = Array.from({ length: 100 }, (_, i) => 0.0001 + Math.sin(i / 3) * 0.00002);

  it('is reproducible for a given seed', () => {
    expect(movingBlockBootstrap(d, { iterations: 500, seed: 42 })).toEqual(
      movingBlockBootstrap(d, { iterations: 500, seed: 42 }),
    );
  });

  it('produces a different resample for a different seed', () => {
    expect(movingBlockBootstrap(d, { iterations: 500, seed: 1 }).lower).not.toBe(
      movingBlockBootstrap(d, { iterations: 500, seed: 2 }).lower,
    );
  });

  it('rejects the null for a clearly positive difference series', () => {
    expect(movingBlockBootstrap(d, { iterations: 2000, seed: 3 }).pValue).toBeLessThan(0.05);
  });

  it('does not reject the null for a zero-mean difference series', () => {
    const rng = mulberry32(17);
    const noise = Array.from({ length: 100 }, () => (rng() - 0.5) * 0.001);

    expect(movingBlockBootstrap(noise, { iterations: 2000, seed: 4 }).pValue).toBeGreaterThan(0.05);
  });

  it('never returns a p-value of exactly zero on a finite resample', () => {
    const huge = Array.from({ length: 100 }, () => 1);

    expect(movingBlockBootstrap(huge, { iterations: 200, seed: 5 }).pValue).toBeGreaterThan(0);
  });

  it('brackets the observed mean with its percentile interval', () => {
    const out = movingBlockBootstrap(d, { iterations: 2000, seed: 6 });

    expect(out.lower).toBeLessThanOrEqual(out.meanDifference);
    expect(out.upper).toBeGreaterThanOrEqual(out.meanDifference);
  });

  it('resamples contiguous blocks, not independent points', () => {
    expect(movingBlockBootstrap(d, { iterations: 100, seed: 8 }).blockLength).toBeGreaterThan(1);
  });

  it('reports too few observations as UNUSABLE', () => {
    expect(movingBlockBootstrap([0.1, 0.2], { iterations: 100 }).usable).toBe(false);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays inside [0, 1)', () => {
    const rng = mulberry32(REGISTERED_BOOTSTRAP_SEED);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('normalCdf', () => {
  it('matches known quantiles', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 6);
  });
});

describe('bootstrapCI reproducibility', () => {
  // It used bare Math.random(): the interval moved between two runs on the
  // same data, so no bound it printed could be reproduced.
  it('returns the same interval for the same data and seed', () => {
    const data = Array.from({ length: 60 }, (_, i) => i / 60);
    const mean = (s: number[]): number => s.reduce((x, y) => x + y, 0) / s.length;

    expect(bootstrapCI(data, mean, 0.05, 500)).toEqual(bootstrapCI(data, mean, 0.05, 500));
  });
});
