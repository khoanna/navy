'use client';
import { colors } from '@/ui/theme';
import { SCENE_COPY } from '@/lib/landing/copy';
import type { CtaLinks } from '@/lib/landing/links';

export function Hero({ links }: { links: CtaLinks }) {
  const c = SCENE_COPY[0];
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', maxWidth: 620 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>{c.eyebrow}</span>
      <h1 style={{ margin: '10px 0 14px', fontSize: 'clamp(38px, 6vw, 68px)', lineHeight: 1.02, letterSpacing: '-0.02em', color: colors.textHi }}>{c.title}</h1>
      <p style={{ fontSize: 17, lineHeight: 1.5, color: colors.text, maxWidth: 440 }}>{c.body}</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
        <a href={links.wallet} style={{ fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '13px 22px', borderRadius: 12 }}>Get the wallet</a>
        <a href={links.merchant} style={{ color: colors.text, border: `1px solid ${colors.borderStrong}`, padding: '13px 22px', borderRadius: 12 }}>For merchants</a>
      </div>
      <div style={{ marginTop: 44, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: colors.textDim }}>Scroll to set sail ↓</div>
    </div>
  );
}
