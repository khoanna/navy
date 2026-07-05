'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { colors, space, radius } from './theme';
import { Text } from './Text';

/**
 * Centered dialog with a scrim. Replaces native window.prompt/confirm with
 * in-app UI in the Navy design language. Closes on Escape and scrim click.
 */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Render into <body> so the fixed scrim escapes AppShell's <main>, which is a
  // containing block for position:fixed (it carries the navy-fade-in transform
  // animation). Without the portal the scrim clips to the content area, not the
  // viewport. `mounted` avoids touching document during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        padding: space.xl,
        background: colors.scrim,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="navy-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: colors.bgElevated,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: radius.xxl,
          padding: space.xxl,
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          gap: space.lg,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text variant="h3" color={colors.textHi} style={{ display: 'block' }}>{title}</Text>
          {subtitle && <Text variant="caption" dim style={{ display: 'block' }}>{subtitle}</Text>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
