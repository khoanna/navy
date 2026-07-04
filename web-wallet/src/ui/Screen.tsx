'use client';
import React from 'react';
import { space, colors } from './theme';
import { Icon } from './Icon';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Pad for the floating tab bar at the bottom. */
  tabSafe?: boolean;
  padded?: boolean;
  contentStyle?: React.CSSProperties;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * Page shell: applies phone-frame padding, fades content in on mount via CSS, and
 * optionally scrolls. The aurora background is provided by globals.css body.
 * Drop-in for the RN Screen primitive (same ScreenProps).
 *
 * onRefresh: renders a small refresh icon button at top-right of the content area
 * (web has no pull-to-refresh idiom, so we use a manual button instead).
 */
export function Screen({
  children,
  scroll,
  tabSafe,
  padded = true,
  contentStyle,
  onRefresh,
  refreshing,
}: ScreenProps) {
  const pad: React.CSSProperties = {
    paddingTop: `${space.lg}px`,
    paddingBottom: tabSafe ? 'calc(96px + env(safe-area-inset-bottom))' : `${space.lg}px`,
    paddingLeft: padded ? `${space.xl}px` : 0,
    paddingRight: padded ? `${space.xl}px` : 0,
  };

  const content = (
    <div className="navy-fade-in" style={{ position: 'relative', ...contentStyle }}>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: `${space.sm}px`,
            opacity: refreshing ? 0.45 : 1,
          }}
          aria-label="Refresh"
        >
          <Icon name="down" size={20} color={colors.aqua} />
        </button>
      )}
      {children}
    </div>
  );

  const rootStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bg,
  };

  if (scroll) {
    return (
      <div style={{ ...rootStyle, overflowY: 'auto', ...pad }}>
        {content}
      </div>
    );
  }

  return (
    <div style={{ ...rootStyle, ...pad }}>
      {content}
    </div>
  );
}
