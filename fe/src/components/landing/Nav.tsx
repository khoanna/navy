'use client';
import { colors } from '@/ui/theme';

export function Nav() {
  return (
    <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px' }}>
      <span style={{ fontWeight: 800, letterSpacing: '0.05em', color: colors.textHi }}>NAVY</span>
    </nav>
  );
}
