import React from 'react';
import { Text as RNText, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { colors, type as typeScale } from './theme';

type Variant = keyof typeof typeScale;

export interface TextProps {
  variant?: Variant;
  color?: string;
  /** Render with tabular figures + tight tracking — for balances/amounts. */
  numeric?: boolean;
  center?: boolean;
  dim?: boolean;
  muted?: boolean;
  upper?: boolean;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/**
 * The single text primitive for Expo/React Native. Maps a semantic `variant`
 * to the type scale and applies a sensible default color so screens stay
 * declarative. Faithfully ports the web Text component prop API.
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
}: TextProps) {
  const base = typeScale[variant];
  const resolvedColor =
    color ?? (muted ? colors.textMute : dim ? colors.textDim : colors.text);

  const baseStyle: TextStyle = {
    fontSize: base.fontSize,
    fontWeight: base.fontWeight as TextStyle['fontWeight'],
    letterSpacing: base.letterSpacing,
    ...('lineHeight' in base && base.lineHeight !== undefined
      ? { lineHeight: (base as { lineHeight: number }).lineHeight }
      : {}),
    ...('fontFamily' in base && (base as { fontFamily?: string }).fontFamily
      ? { fontFamily: (base as { fontFamily: string }).fontFamily }
      : {}),
    color: resolvedColor,
  };

  const numericStyle: TextStyle | null = numeric
    ? { letterSpacing: -0.5 }
    : null;

  const centerStyle: TextStyle | null = center ? { textAlign: 'center' } : null;
  const upperStyle: TextStyle | null = upper ? { textTransform: 'uppercase' } : null;

  return (
    <RNText
      style={[
        baseStyle,
        numericStyle,
        centerStyle,
        upperStyle,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
