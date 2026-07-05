'use client';
import React from 'react';
import { colors, type as typeScale } from './theme';

type Variant = keyof typeof typeScale;

export interface TextProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  color?: string;
  /** Render with tabular figures + tight tracking — for balances/amounts. */
  numeric?: boolean;
  center?: boolean;
  dim?: boolean;
  muted?: boolean;
  upper?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * The single text primitive. Maps a semantic `variant` to the type scale and
 * applies a sensible default color so screens stay declarative.
 *
 * lineHeight/fontSize/letterSpacing are converted from numeric px values to px
 * strings (rule 4: React DOM treats bare number lineHeight as a unitless multiple).
 */
export function Text({
  variant = 'body',
  color,
  numeric,
  center,
  dim,
  muted,
  upper,
  style,
  children,
  ...rest
}: TextProps) {
  const base = typeScale[variant];
  const resolved = color ?? (muted ? colors.textMute : dim ? colors.textDim : colors.text);

  const baseStyle: React.CSSProperties = {
    fontSize: `${base.fontSize}px`,
    fontWeight: base.fontWeight as React.CSSProperties['fontWeight'],
    letterSpacing: `${base.letterSpacing}px`,
    // mono has no lineHeight — omit when undefined
    ...(('lineHeight' in base && base.lineHeight !== undefined)
      ? { lineHeight: `${(base as { lineHeight: number }).lineHeight}px` }
      : {}),
    ...('fontFamily' in base && base.fontFamily
      ? { fontFamily: (base as { fontFamily: string }).fontFamily }
      : {}),
    color: resolved,
  };

  const numericStyle: React.CSSProperties | null = numeric
    ? { fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }
    : null;

  const centerStyle: React.CSSProperties | null = center ? { textAlign: 'center' } : null;
  const upperStyle: React.CSSProperties | null = upper ? { textTransform: 'uppercase' } : null;

  return (
    <span
      {...rest}
      style={{
        display: 'inline',
        ...baseStyle,
        ...numericStyle,
        ...centerStyle,
        ...upperStyle,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
