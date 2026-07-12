'use client';
import { colors } from '@/ui/theme';
import type { CtaLinks } from '@/lib/landing/links';

export function Nav({ links }: { links: CtaLinks }) {
  return (
    <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px' }}>
      <span style={{ fontWeight: 800, letterSpacing: '0.05em', color: colors.textHi }}>NAVY</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <a href={links.merchant} style={{ fontSize: 13, color: colors.text, border: `1px solid ${colors.borderStrong}`, padding: '8px 14px', borderRadius: 10 }}>For merchants</a>
        <a href={links.wallet} style={{ fontSize: 13, fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '8px 14px', borderRadius: 10 }}>Get the wallet</a>
      </div>
    </nav>
  );
}
