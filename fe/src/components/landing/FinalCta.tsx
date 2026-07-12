'use client';
import { colors } from '@/ui/theme';
import type { CtaLinks } from '@/lib/landing/links';

export function FinalCta({ links }: { links: CtaLinks }) {
  return (
    <section style={{ position: 'relative', zIndex: 1, background: 'radial-gradient(120% 90% at 50% 120%, rgba(47,224,194,0.22), transparent 60%), linear-gradient(180deg, rgba(6,11,23,0.55) 0%, rgba(6,11,23,0.80) 100%)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', padding: '130px 28px', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 22px', fontSize: 'clamp(32px, 5vw, 56px)', color: colors.textHi, letterSpacing: '-0.02em' }}>Set sail with Navy.</h2>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <a href={links.wallet} style={{ fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '14px 26px', borderRadius: 12 }}>Get the wallet</a>
        <a href={links.merchant} style={{ color: colors.text, border: `1px solid ${colors.borderStrong}`, padding: '14px 26px', borderRadius: 12 }}>For merchants</a>
      </div>
    </section>
  );
}
