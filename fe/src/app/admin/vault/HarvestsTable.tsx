'use client';
import React from 'react';
import { colors, space } from '@/ui/theme';
import { DataTable, Column } from '@/ui/DataTable';
import { Text } from '@/ui/Text';
import { formatUsdc } from '@/lib/dashboard/stats';

export interface Harvest {
  id: string;
  adapter: string;
  protocol: string;
  harvestedAt: string;
  grossBase: string;
  netBase: string;
}

export interface HarvestsTableProps {
  harvests: Harvest[];
  loading?: boolean;
}

function shortenAddr(addr: string) {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export function HarvestsTable({ harvests, loading }: HarvestsTableProps) {
  const columns: Column<Harvest>[] = [
    {
      key: 'time', header: 'Time', render: (h) => (
        <Text variant="caption" color={colors.textDim}>
          {new Date(h.harvestedAt).toLocaleString()}
        </Text>
      ),
    },
    {
      key: 'adapter', header: 'Protocol', render: (h) => (
        <Text variant="caption" color={colors.textHi}>{h.protocol || shortenAddr(h.adapter)}</Text>
      ),
    },
    {
      key: 'amount', header: 'USDC Claimed', align: 'right', render: (h) => (
        <Text variant="caption" color={colors.accent} numeric>
          {formatUsdc(h.netBase)} USDC
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
        <Text variant="h3" color={colors.textHi}>Harvests</Text>
      </div>
      <DataTable columns={columns} rows={harvests} empty="No harvests yet" />
    </div>
  );
}
