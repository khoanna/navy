'use client';
import { colors } from '@/ui/theme';
import type { CtaLinks } from '@/lib/landing/links';

export function Footer({ links }: { links: CtaLinks }) {
  return (
    <footer style={{ position: 'relative', zIndex: 1, background: colors.bg, borderTop: `1px solid ${colors.border}`, padding: '30px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <span style={{ fontSize: 13, color: colors.textMute }}>© Navy · Sepolia testnet</span>
      <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
        <a href={links.wallet} style={{ color: colors.textDim }}>Wallet</a>
        <a href={links.merchant} style={{ color: colors.textDim }}>Merchants</a>
        <a href={links.adminLogin} style={{ color: colors.textMute }}>Admin</a>
      </div>
    </footer>
  );
}
