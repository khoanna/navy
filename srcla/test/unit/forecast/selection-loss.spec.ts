import { scoreGrid, MIN_DISCRIMINATING_IQR, interquartileRange } from '../../../src/forecast/grid-sweep.js';

// Ruling R16: scoreGrid reads loss fields nested at f.fit.loss[term], matching
// the real FitPoint shape (`{ loss: { pointError, ... } }`), not flat on the
// fit object itself. This helper mirrors that shape.
function fit(overrides: Partial<Record<string, number>>) {
  return {
    loss: {
      pointError: 1e-5, coverageDeviation: 1e-5, exceedanceShortfall: 1e-7,
      sharpness: 1e-4, downsideRate: 0.5, turnover: 1, sacrificedReturn: 0,
      total: 0, observations: 1000, achievedCoverage: 0.99,
      ...overrides,
    },
  } as never;
}

describe('P18: scale-normalized selection loss', () => {
  it('zero-weights a term that is constant across the grid', () => {
    const fits = [
      { point: { id: 'p1' } as never, fit: fit({ pointError: 1e-5 }) },
      { point: { id: 'p2' } as never, fit: fit({ pointError: 2e-5 }) },
      { point: { id: 'p3' } as never, fit: fit({ pointError: 3e-5 }) },
    ];
    const scored = scoreGrid(fits, { minIqr: MIN_DISCRIMINATING_IQR });
    // downsideRate is 0.5 everywhere -> no spread -> zero-weighted
    expect(scored[0]!.zeroWeighted).toContain('downsideRate');
  });

  it('standardization overturns the naive raw-weighted-sum winner when an outlier '
    + 'dominates it only by raw scale', () => {
    // Four candidates, two active terms (the rest held constant so they are
    // correctly zero-weighted -- see test 1). `d`'s coverageDeviation is a
    // huge raw-scale outlier (1000 vs ~0.001-0.003) that, combined with its
    // weight of 10, swamps the naive raw-weighted sum for every candidate:
    //
    //   naiveTotal = 10*coverageDeviation + 1*pointError
    //     a: 10*0.001    + 4e-4 = 0.0104        (naive winner: lowest total)
    //     b: 10*0.002    + 3e-4 = 0.0203
    //     c: 10*0.003    + 2e-4 = 0.0302
    //     d: 10*1000     + 1e-4 = 10000.0001
    //
    // so the naive order is a, b, c, d and 'a' wins -- but pointError's own
    // spread (4e-4..1e-4) never gets a say: it is always ~30000x smaller
    // than coverageDeviation's contribution, regardless of which candidate
    // is better on pointError. That is exactly the P18 defect (a term
    // decided in the residue) reproduced with a clean, deliberately built
    // outlier rather than downsideRate's accidental one.
    //
    // After standardization, `d` becomes a single extreme z-score on
    // coverageDeviation (it does not get to dominate every pairwise
    // comparison the way its raw magnitude did), while pointError's
    // standardized spread is now comparable in scale -- so pointError's
    // ranking among a/b/c (d, c, b, a descending pointError, i.e. c has the
    // *worst* pointError of the three) can and does move the winner.
    const candidates = [
      { id: 'a', coverageDeviation: 0.001, pointError: 4e-4 },
      { id: 'b', coverageDeviation: 0.002, pointError: 3e-4 },
      { id: 'c', coverageDeviation: 0.003, pointError: 2e-4 },
      { id: 'd', coverageDeviation: 1000, pointError: 1e-4 },
    ];
    const fits = candidates.map((c) => ({
      point: { id: c.id } as never,
      fit: fit({ coverageDeviation: c.coverageDeviation, pointError: c.pointError }),
    }));

    const scored = scoreGrid(fits, { minIqr: MIN_DISCRIMINATING_IQR });
    const order = scored.map((s) => (s.point as unknown as { id: string }).id);

    // Standardized winner is 'c', not the naive winner 'a' -- the ranking
    // genuinely differs, not merely the margin.
    expect(order[0]).toBe('c');
    expect(order[0]).not.toBe('a');
    expect(order).toEqual(['c', 'b', 'a', 'd']);
    // Both terms actually took part -- neither was zero-weighted away,
    // which would make this just a single-term ordering.
    expect(scored[0]!.zeroWeighted).not.toContain('coverageDeviation');
    expect(scored[0]!.zeroWeighted).not.toContain('pointError');
  });

  it('a term measured in tiny units does not lose to one measured in large units', () => {
    // exceedanceShortfall ~1e-7, downsideRate ~0.5: after standardization a
    // one-sigma move in either must weigh the same before weights apply.
    const scored = scoreGrid([
      { point: { id: 'a' } as never, fit: fit({ exceedanceShortfall: 1e-7, downsideRate: 0.4 }) },
      { point: { id: 'b' } as never, fit: fit({ exceedanceShortfall: 9e-7, downsideRate: 0.6 }) },
    ], { minIqr: 0 });
    const spread = Math.abs(scored[0]!.normalized['exceedanceShortfall']! - scored[1]!.normalized['exceedanceShortfall']!);
    const spread2 = Math.abs(scored[0]!.normalized['downsideRate']! - scored[1]!.normalized['downsideRate']!);
    expect(Math.abs(spread - spread2)).toBeLessThan(1e-9);
  });

  describe('interquartileRange (linear-interpolated, not floor-indexed)', () => {
    // A floor-indexed quantile (`sorted[floor(p * (n - 1))]`) collapses Q1
    // and Q3 to the SAME order statistic at n=2 (floor(0.25*1) ===
    // floor(0.75*1) === 0), reporting IQR=0 for a sample that plainly has
    // spread. That silently zero-weights every term whenever a caller
    // passes a 2-point grid, regardless of the data. Assert non-zero IQR
    // for genuinely spread-out data at n=2..5, the range that bug affected.
    it.each([
      [2, [1, 2]],
      [3, [1, 2, 3]],
      [4, [1, 2, 3, 4]],
      [5, [1, 2, 3, 4, 5]],
    ])('reports a non-zero IQR for spread-out data at n=%d', (_n, xs) => {
      expect(interquartileRange(xs)).toBeGreaterThan(0);
    });

    it('reports zero IQR for a genuinely constant sample at any of those n', () => {
      for (const n of [2, 3, 4, 5]) {
        expect(interquartileRange(Array(n).fill(7))).toBe(0);
      }
    });
  });
});
