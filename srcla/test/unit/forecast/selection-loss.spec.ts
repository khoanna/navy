import { scoreGrid, MIN_DISCRIMINATING_IQR } from '../../../src/forecast/grid-sweep.js';

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

  it('a constant term cannot change the ranking', () => {
    const withConst = scoreGrid([
      { point: { id: 'a' } as never, fit: fit({ pointError: 1e-5, downsideRate: 0.5 }) },
      { point: { id: 'b' } as never, fit: fit({ pointError: 9e-5, downsideRate: 0.5 }) },
    ], { minIqr: MIN_DISCRIMINATING_IQR });
    const withOther = scoreGrid([
      { point: { id: 'a' } as never, fit: fit({ pointError: 1e-5, downsideRate: 0.9 }) },
      { point: { id: 'b' } as never, fit: fit({ pointError: 9e-5, downsideRate: 0.9 }) },
    ], { minIqr: MIN_DISCRIMINATING_IQR });
    expect(withConst.map((s: { point: unknown }) => s.point).map((p) => (p as { id: string }).id))
      .toEqual(withOther.map((s: { point: unknown }) => s.point).map((p) => (p as { id: string }).id));
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
});
