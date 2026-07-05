// fe/src/ui/TrendChart.tsx
'use client';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { buildChartGeometry, SeriesPoint } from '../lib/dashboard/chart';

export function TrendChart({ title, series, height = 200 }: { title: string; series: SeriesPoint[]; height?: number }) {
  const W = 900, H = height, PAD = 10;
  const g = buildChartGeometry(series, W, H, PAD);
  const hasData = g.max > 0;
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xl, padding: space.xxl }}>
      <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.lg }}>{title}</Text>
      <div style={{ position: 'relative', width: '100%', height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
          <defs>
            <linearGradient id="navy-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradients.ocean[1]} stopOpacity="0.35" />
              <stop offset="100%" stopColor={gradients.ocean[1]} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* baseline so the empty state still reads as a chart */}
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={colors.border} strokeWidth={1} />
          {hasData && g.areaPath && <path d={g.areaPath} fill="url(#navy-area)" />}
          {hasData && g.linePath && <path d={g.linePath} fill="none" stroke={colors.aqua} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
        {!hasData && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <Text variant="caption" dim>No activity in this period</Text>
          </div>
        )}
      </div>
    </div>
  );
}
