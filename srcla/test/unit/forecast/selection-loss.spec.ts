import {
  scoreGrid,
  nearTieResolution,
  resolveNearTie,
  MIN_DISCRIMINATING_IQR,
  MIN_SELECTION_MARGIN,
  interquartileRange,
  type ScoredPoint,
} from '../../../src/forecast/grid-sweep.js';

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
  const spreadFits = () => [
    { point: { id: 'p1' } as never, fit: fit({ pointError: 1e-5 }) },
    { point: { id: 'p2' } as never, fit: fit({ pointError: 2e-5 }) },
    { point: { id: 'p3' } as never, fit: fit({ pointError: 3e-5 }) },
  ];

  it('zero-weights a term that is constant across the grid, at any positive threshold', () => {
    // downsideRate is 0.5 everywhere -> no spread -> zero-weighted.
    const scored = scoreGrid(spreadFits(), { minIqr: 1e-9 });
    expect(scored[0]!.zeroWeighted).toContain('downsideRate');
  });

  /**
   * IMPORTANT I2. `MIN_DISCRIMINATING_IQR` is 0, so the gate names nothing —
   * and that costs nothing, because `scoreGrid`'s `sd = ... || 1` fallback
   * already makes a constant term's z-score 0 at every point. Labelling it
   * `zeroWeighted` was never what neutralised it. Assert both halves: the
   * label is absent, and the term still contributes exactly 0.
   */
  it('I2: at the registered threshold a constant term is not labelled, and is inert anyway', () => {
    const scored = scoreGrid(spreadFits(), { minIqr: MIN_DISCRIMINATING_IQR });
    expect(scored[0]!.zeroWeighted).toEqual([]);
    for (const sp of scored) expect(sp.normalized['downsideRate']).toBe(0);
    // Same ordering as when the constant term IS labelled: the label is a
    // diagnostic, not a control.
    const labelled = scoreGrid(spreadFits(), { minIqr: 1e-9 });
    expect(scored.map((s) => s.total)).toEqual(labelled.map((s) => s.total));
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

  /**
   * Ruling R20. The measured raw IQRs on the registered 81-point grid are
   * pointError 7.64e-5, coverageDeviation 3.54e-5, exceedanceShortfall
   * 2.34e-6, sharpness 1.72e-4, downsideRate 5.72e-2, turnover 4.91e+1,
   * sacrificedReturn 0. At the old 1e-4 threshold the first three -- carrying
   * §7.3 weights of 1.0, 10.0 and 5.0 -- were all zero-weighted while
   * `sharpness` (weight 0.5) survived on raw magnitude alone. The threshold
   * must separate CONSTANT terms from small-unit ones, not small from large.
   */
  it('R20: 1e-4 drops discriminating terms by units alone; the registered threshold does not', () => {
    const measured = [
      { pointError: 7.6e-5, coverageDeviation: 3.5e-5, exceedanceShortfall: 2.3e-6, sharpness: 1.7e-4, downsideRate: 0.47, turnover: 330, sacrificedReturn: 0 },
      { pointError: 1.2e-4, coverageDeviation: 6.0e-5, exceedanceShortfall: 4.0e-6, sharpness: 2.6e-4, downsideRate: 0.50, turnover: 355, sacrificedReturn: 0 },
      { pointError: 1.6e-4, coverageDeviation: 8.5e-5, exceedanceShortfall: 5.7e-6, sharpness: 3.4e-4, downsideRate: 0.53, turnover: 380, sacrificedReturn: 0 },
      { pointError: 2.0e-4, coverageDeviation: 1.1e-4, exceedanceShortfall: 7.4e-6, sharpness: 4.3e-4, downsideRate: 0.56, turnover: 405, sacrificedReturn: 0 },
    ];
    const atOldThreshold = scoreGrid(
      measured.map((m, i) => ({ point: { id: `p${i}` } as never, fit: fit(m) })),
      { minIqr: 1e-4 },
    );
    expect(atOldThreshold[0]!.zeroWeighted).toEqual(
      expect.arrayContaining(['pointError', 'coverageDeviation', 'exceedanceShortfall']),
    );
    expect(atOldThreshold[0]!.zeroWeighted).not.toContain('sharpness');

    // At the registered threshold every term with real spread takes part.
    const registered = scoreGrid(
      measured.map((m, i) => ({ point: { id: `p${i}` } as never, fit: fit(m) })),
      { minIqr: MIN_DISCRIMINATING_IQR },
    );
    expect(registered[0]!.zeroWeighted).toEqual([]);
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

/**
 * P18/Task 7 — a selection inside the noise must not be settled by whichever
 * candidate `sort` happened to place first. v0.6's registered run chose a
 * 1-day horizon on a margin of 1.27e-7 and the policy then executed ONE
 * rebalance across an 86-day era.
 */
describe('P18: near-tie resolution', () => {
  const sp = (
    over: { total: number; horizonSeconds: number; turnover?: number; sacrificedReturn?: number },
  ): ScoredPoint =>
    ({
      point: { horizonSeconds: over.horizonSeconds } as never,
      fit: fit({}),
      normalized: {
        turnover: over.turnover ?? 0,
        sacrificedReturn: over.sacrificedReturn ?? 0,
      },
      total: over.total,
      zeroWeighted: [],
    }) as ScoredPoint;

  it('a real margin decides outright, economics notwithstanding', () => {
    const winner = resolveNearTie([
      sp({ total: 0, horizonSeconds: 86_400, sacrificedReturn: 5 }),
      sp({ total: 1, horizonSeconds: 1_209_600, sacrificedReturn: -5 }),
    ]);
    expect(winner.point.horizonSeconds).toBe(86_400);
  });

  it('inside the margin, the economic terms overturn the lexical winner', () => {
    const winner = resolveNearTie([
      sp({ total: 0, horizonSeconds: 86_400, sacrificedReturn: 5 }),
      sp({ total: MIN_SELECTION_MARGIN / 10, horizonSeconds: 1_209_600, sacrificedReturn: -5 }),
    ]);
    expect(winner.point.horizonSeconds).toBe(1_209_600);
  });

  it('tied on economics too, it takes the LONGER horizon (§7.1)', () => {
    const winner = resolveNearTie([
      sp({ total: 0, horizonSeconds: 86_400 }),
      sp({ total: MIN_SELECTION_MARGIN / 10, horizonSeconds: 1_209_600 }),
    ]);
    expect(winner.point.horizonSeconds).toBe(1_209_600);
  });

  /**
   * IMPORTANT I4. Two candidates from the SAME (horizon, coverage) bucket can
   * share a turnover and a sacrificed return, and then tier 3 finds equal
   * horizons too. `resolveNearTie` still has to return something and returns
   * the sort-order first — which is the lexical tie-break it exists to avoid —
   * so the degeneracy has to be REPORTED rather than hidden behind a winner.
   */
  it('I4: a same-bucket tie is reported as indistinguishable, not resolved', () => {
    const bucket = [
      sp({ total: 0, horizonSeconds: 604_800, turnover: 1, sacrificedReturn: 2 }),
      sp({ total: MIN_SELECTION_MARGIN / 10, horizonSeconds: 604_800, turnover: 1, sacrificedReturn: 2 }),
    ];
    expect(nearTieResolution(bucket)).toBe('indistinguishable');
    // It still returns a point, and it is the sort-order first.
    expect(resolveNearTie(bucket)).toBe(bucket[0]);
  });

  it('reports which tier decided', () => {
    expect(
      nearTieResolution([
        sp({ total: 0, horizonSeconds: 86_400 }),
        sp({ total: 1, horizonSeconds: 604_800 }),
      ]),
    ).toBe('margin');
    expect(
      nearTieResolution([
        sp({ total: 0, horizonSeconds: 86_400, sacrificedReturn: 5 }),
        sp({ total: MIN_SELECTION_MARGIN / 10, horizonSeconds: 86_400, sacrificedReturn: -5 }),
      ]),
    ).toBe('economics');
    expect(
      nearTieResolution([
        sp({ total: 0, horizonSeconds: 86_400 }),
        sp({ total: MIN_SELECTION_MARGIN / 10, horizonSeconds: 1_209_600 }),
      ]),
    ).toBe('horizon');
  });

  it('a one-point grid returns that point, and an empty grid throws', () => {
    expect(resolveNearTie([sp({ total: 0, horizonSeconds: 604_800 })]).point.horizonSeconds).toBe(
      604_800,
    );
    expect(() => resolveNearTie([])).toThrow(/no scored point/);
  });
});
