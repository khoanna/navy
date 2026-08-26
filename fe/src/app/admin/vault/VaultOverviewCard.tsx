'use client';
import { StatCard } from '@/ui/StatCard';
import { colors, space } from '@/ui/theme';
import { formatUsdc } from '@/lib/dashboard/stats';
import { Text } from '@/ui/Text';

export interface VaultOverviewData {
  tvl: string;
  aggregateApy: number;
  lastHarvestAt: string | null;
}

export function VaultOverviewCard({ data }: { data: VaultOverviewData }) {
  const apyPct = (data.aggregateApy / 100).toFixed(2);
  const tvlFormatted = formatUsdc(data.tvl);

  let harvestAgo: string | null = null;
  if (data.lastHarvestAt) {
    const diffMs = Date.now() - new Date(data.lastHarvestAt).getTime();
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffM = Math.floor((diffMs % 3_600_000) / 60_000);
    if (diffH > 0) harvestAgo = `${diffH}h ago`;
    else if (diffM > 0) harvestAgo = `${diffM}m ago`;
    else harvestAgo = 'just now';
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.lg }}>
      <StatCard
        label="Total Value Locked"
        value={`$${tvlFormatted}`}
        icon="chart"
        delta="USDC in vault"
      />
      <StatCard
        label="Aggregate APY"
        value={`${apyPct}%`}
        icon="chart"
        delta="TVL-weighted"
        featured
      />
      <StatCard
        label="Last Harvest"
        value={harvestAgo ?? '—'}
        icon="clock"
        delta={harvestAgo ? data.lastHarvestAt ? new Date(data.lastHarvestAt).toLocaleString() : undefined : 'No harvests yet'}
      />
    </div>
  );
}
