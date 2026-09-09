import { coverageDistribution } from '../../../src/evaluation/replay/replay.js';

describe('coverageDistribution', () => {
  it('reports min, p05 and median over the origin series', () => {
    const series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5];
    const d = coverageDistribution(series);
    expect(d.min).toBe(0.5);
    expect(d.median).toBe(1);
    expect(d.p05).toBeLessThanOrEqual(d.median);
  });

  it('distinguishes ONE dry hour from chronic illiquidity', () => {
    // The whole reason P11 exists: these two score identically on `min`.
    const oneDip = coverageDistribution([...Array(999).fill(1), 0.3]);
    const chronic = coverageDistribution(Array(1000).fill(0.3));
    expect(oneDip.min).toBe(chronic.min);
    expect(oneDip.median).toBeGreaterThan(chronic.median);
    expect(oneDip.p05).toBeGreaterThan(chronic.p05);
  });

  it('returns 1 for an empty series rather than 0', () => {
    // An unmeasured series is not a maximally illiquid one.
    expect(coverageDistribution([])).toEqual({ min: 1, p05: 1, median: 1 });
  });
});
