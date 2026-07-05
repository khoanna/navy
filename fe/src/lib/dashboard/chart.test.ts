// fe/src/lib/dashboard/chart.test.ts
import { buildChartGeometry } from './chart';

describe('buildChartGeometry', () => {
  it('maps values into [0,height] with max at the top (y small) and returns paths', () => {
    const g = buildChartGeometry([{ date: 'a', value: 0 }, { date: 'b', value: 10 }], 100, 40, 4);
    expect(g.points).toHaveLength(2);
    // first point x = pad, last point x = width - pad
    expect(g.points[0].x).toBeCloseTo(4);
    expect(g.points[1].x).toBeCloseTo(96);
    // value 10 (max) sits near the top => smaller y than value 0
    expect(g.points[1].y).toBeLessThan(g.points[0].y);
    expect(g.linePath.startsWith('M')).toBe(true);
    expect(g.areaPath.endsWith('Z')).toBe(true);
  });

  it('renders a flat baseline when all values are zero (no divide-by-zero)', () => {
    const g = buildChartGeometry([{ date: 'a', value: 0 }, { date: 'b', value: 0 }], 100, 40, 4);
    expect(g.points.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(g.max).toBe(0);
  });

  it('handles a single point without NaN', () => {
    const g = buildChartGeometry([{ date: 'a', value: 5 }], 100, 40, 4);
    expect(g.points).toHaveLength(1);
    expect(Number.isFinite(g.points[0].x)).toBe(true);
  });

  it('returns empty paths for an empty series', () => {
    const g = buildChartGeometry([], 100, 40, 4);
    expect(g.points).toHaveLength(0);
    expect(g.linePath).toBe('');
    expect(g.areaPath).toBe('');
  });
});
