// fe/src/lib/dashboard/chart.ts
export interface SeriesPoint {
  date: string;
  value: number;
}

export interface ChartGeometry {
  points: { x: number; y: number }[];
  linePath: string;
  areaPath: string;
  max: number;
}

/**
 * Pure SVG geometry for a trend chart. Values map into a [pad, height-pad] band,
 * the series max at the top. Guards empty/single/all-zero series against NaN.
 */
export function buildChartGeometry(series: SeriesPoint[], width: number, height: number, pad = 0): ChartGeometry {
  if (series.length === 0) return { points: [], linePath: '', areaPath: '', max: 0 };

  const max = series.reduce((m, p) => Math.max(m, p.value), 0);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;

  const points = series.map((p, i) => {
    const x = pad + (series.length > 1 ? stepX * i : innerW / 2);
    const ratio = max > 0 ? p.value / max : 0;
    const y = pad + innerH - ratio * innerH;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const baseY = (height - pad).toFixed(2);
  const areaPath =
    points.length > 0
      ? `M${points[0].x.toFixed(2)} ${baseY} ` +
        points.map((p) => `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') +
        ` L${points[points.length - 1].x.toFixed(2)} ${baseY} Z`
      : '';

  return { points, linePath, areaPath, max };
}
