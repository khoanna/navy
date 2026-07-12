import type { CSSProperties, ReactNode } from 'react';
import { colors } from '@/ui/theme';

/** Shared glass-card shell for the landing product mocks. `width` collapses on
 *  narrow viewports so the same card works in the desktop edge-overlay and the
 *  stacked static/mobile path. The float animation is CSS-only (globals.css) and
 *  is neutralized by the global prefers-reduced-motion rule. */
const shell: CSSProperties = {
  width: 'min(340px, 80vw)',
  border: `1px solid ${colors.borderStrong}`,
  background: 'rgba(12,20,36,0.62)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius: 20,
  overflow: 'hidden',
  boxShadow: '0 24px 60px rgba(3,8,20,0.55)',
  color: colors.text,
};

export function MockCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="product-float" style={{ ...shell, ...style }}>
      {children}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: colors.aqua, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '4px 10px', borderRadius: 999 }}>
      {children}
    </span>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderTop: `1px solid ${colors.border}`, fontSize: 13 }}>
      <span style={{ color: colors.textDim }}>{label}</span>
      <span style={{ color: colors.textHi, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
