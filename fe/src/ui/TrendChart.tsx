// fe/src/ui/TrendChart.tsx
'use client';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { buildChartGeometry, SeriesPoint } from '../lib/dashboard/chart';

export function TrendChart({ title, series, height = 220 }: { title: string; series: SeriesPoint[]; height?: number }) {
  const W = 900, H = height, PAD = 10;
  const g = buildChartGeometry(series, W, H, PAD);
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xl, padding: space.xxl }}>
      <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.lg }}>{title}</Text>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        <defs>
          <linearGradient id="navy-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradients.ocean[1]} stopOpacity="0.35" />
            <stop offset="100%" stopColor={gradients.ocean[1]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {g.areaPath && <path d={g.areaPath} fill="url(#navy-area)" />}
        {g.linePath && <path d={g.linePath} fill="none" stroke={colors.aqua} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  );
}
