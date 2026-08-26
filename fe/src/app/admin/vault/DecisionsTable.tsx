'use client';
import React from 'react';
import Link from 'next/link';
import { colors, space } from '@/ui/theme';
import { DataTable, Column } from '@/ui/DataTable';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';

export interface Decision {
  decisionHash: string;
  policyVersion: string;
  timestamp: string;
  actionDecision: {
    action: string;
    amount: string;
    targetAdapter: string | null;
    reason: string;
  };
  reserveBase: string;
}

export interface DecisionsTableProps {
  decisions: Decision[];
  loading?: boolean;
  onViewAll?: () => void;
}

const ACTION_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  deploy: 'success',
  divest: 'warning',
  harvest: 'neutral',
  emergency: 'danger',
  noop: 'neutral',
};

function shortenHash(hash: string) {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function DecisionsTable({ decisions, loading, onViewAll }: DecisionsTableProps) {
  const columns: Column<Decision>[] = [
    {
      key: 'time', header: 'Time', render: (d) => (
        <Text variant="caption" color={colors.textDim}>
          {new Date(d.timestamp).toLocaleString()}
        </Text>
      ),
    },
    {
      key: 'action', header: 'Action', render: (d) => {
        const action = d.actionDecision.action ?? 'noop';
        const tone = ACTION_COLORS[action] ?? 'neutral';
        return <Pill label={action} tone={tone} />;
      },
    },
    {
      key: 'amount', header: 'Amount', align: 'right', render: (d) => {
        const raw = d.actionDecision.amount;
        const num = Number(raw);
        const label = isNaN(num) || num === 0 ? '—' : `$${(num / 1_000_000).toFixed(2)}M`;
        return <Text variant="caption" color={colors.textHi} numeric>{label}</Text>;
      },
    },
    {
      key: 'adapter', header: 'Adapter', render: (d) => (
        <Text variant="caption" color={colors.textDim}>
          {d.actionDecision.targetAdapter ? shortenHash(d.actionDecision.targetAdapter) : '—'}
        </Text>
      ),
    },
    {
      key: 'reason', header: 'Reason', render: (d) => (
        <Text variant="caption" color={colors.textDim} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.actionDecision.reason || '—'}
        </Text>
      ),
    },
    {
      key: 'hash', header: 'Hash', render: (d) => (
        <Text variant="caption" color={colors.textDim} style={{ fontFamily: 'monospace' }}>
          {shortenHash(d.decisionHash)}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
        <Text variant="h3" color={colors.textHi}>SRCLA Decisions</Text>
        {onViewAll && (
          <Link href="/admin/vault/decisions">
            <Text variant="caption" color={colors.accent} style={{ cursor: 'pointer' }}>View All →</Text>
          </Link>
        )}
      </div>
      <DataTable columns={columns} rows={decisions} empty="No decisions yet" />
    </div>
  );
}
