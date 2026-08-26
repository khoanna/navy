'use client';
import React from 'react';
import { colors, space, radius } from '@/ui/theme';
import { Text } from '@/ui/Text';
import { formatUsdc } from '@/lib/dashboard/stats';

export interface AdapterAllocation {
  adapter: string;
  name: string;
  assets: string;
  percentage: number;
  apyBps?: number;
}

export interface StrategyPanelProps {
  allocations: AdapterAllocation[];
  loading?: boolean;
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 8, background: colors.surfaceAlt, borderRadius: radius.sm, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: radius.sm, transition: 'width 0.4s ease' }} />
    </div>
  );
}

const PROTOCOL_COLORS: Record<string, string> = {
  'Compound III': '#00D395',
  'Aave V3': '#B6509E',
  'Moonwell': '#7B61FF',
};

export function StrategyPanel({ allocations, loading }: StrategyPanelProps) {
  if (loading) {
    return (
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xl, padding: space.xxl }}>
        <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.lg }}>Strategy Allocation</Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
          {[80, 55, 30].map((w, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
              <div style={{ height: 16, background: colors.surfaceAlt, borderRadius: radius.sm, width: `${w}%` }} />
              <div style={{ height: 12, background: colors.surfaceAlt, borderRadius: radius.sm, width: `${w * 0.6}%` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xl, padding: space.xxl }}>
      <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.lg }}>Strategy Allocation</Text>
      {allocations.length === 0 ? (
        <Text variant="caption" dim style={{ textAlign: 'center', padding: space.lg }}>No allocations yet</Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
          {allocations.map((a) => {
            const barColor = PROTOCOL_COLORS[a.name] ?? colors.accent;
            const apy = a.apyBps != null ? `${(a.apyBps / 100).toFixed(2)}% APY` : null;
            return (
              <div key={a.adapter} style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="bodyStrong" color={colors.textHi}>{a.name}</Text>
                  <div style={{ display: 'flex', gap: space.lg, alignItems: 'center' }}>
                    {apy && <Text variant="caption" color={colors.accent}>{apy}</Text>}
                    <Text variant="caption" color={colors.textDim}>{`${a.percentage.toFixed(1)}%`}</Text>
                    <Text variant="caption" color={colors.textDim} numeric>{formatUsdc(a.assets)} USDC</Text>
                  </div>
                </div>
                <Bar pct={a.percentage} color={barColor} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
