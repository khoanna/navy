// fe/src/ui/AppShell.tsx
'use client';
import React from 'react';
import { colors, space } from './theme';
import { Sidebar, NavItem, Identity } from './Sidebar';
import { SessionKeeper } from './SessionKeeper';

export function AppShell({ items, identity, onLogout, children }: { items: NavItem[]; identity: Identity; onLogout?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', color: colors.text }}>
      <SessionKeeper />
      <Sidebar items={items} identity={identity} onLogout={onLogout} />
      <main className="navy-fade-in" style={{ flex: 1, minWidth: 0, maxWidth: 1360, margin: '0 auto', width: '100%', padding: `0 ${space.xxxl}px ${space.huge}px` }}>
        {children}
      </main>
    </div>
  );
}
