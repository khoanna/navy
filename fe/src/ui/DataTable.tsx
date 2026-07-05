// fe/src/ui/DataTable.tsx
'use client';
import React from 'react';
import { colors, space, radius } from './theme';
import { Text } from './Text';

export interface Column<T> { key: string; header: string; render: (row: T) => React.ReactNode; align?: 'left' | 'right'; }

export function DataTable<T>({ columns, rows, empty = 'Nothing here yet' }: { columns: Column<T>[]; rows: T[]; empty?: string }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xl, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, padding: `${space.md}px ${space.xxl}px`, borderBottom: `1px solid ${colors.border}` }}>
        {columns.map((c) => (
          <Text key={c.key} variant="label" upper dim style={{ textAlign: c.align ?? 'left' }}>{c.header}</Text>
        ))}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: space.huge, textAlign: 'center' }}><Text variant="caption" dim>{empty}</Text></div>
      ) : (
        rows.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, alignItems: 'center', padding: `${space.lg}px ${space.xxl}px`, borderBottom: i < rows.length - 1 ? `1px solid ${colors.border}` : undefined }}>
            {columns.map((c) => (
              <div key={c.key} style={{ textAlign: c.align ?? 'left', minWidth: 0 }}>{c.render(row)}</div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
