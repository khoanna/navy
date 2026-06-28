import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet, TextStyle } from 'react-native';
import { colors, type as typeScale } from './theme';

type Variant = keyof typeof typeScale;

export interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  /** Render with tabular figures + tight tracking — for balances/amounts. */
  numeric?: boolean;
  center?: boolean;
  dim?: boolean;
  muted?: boolean;
  upper?: boolean;
}

/**
 * The single text primitive. Maps a semantic `variant` to the type scale and
 * applies a sensible default color so screens stay declarative.
 */
export function Text({ variant = 'body', color, numeric, center, dim, muted, upper, style, ...rest }: TextProps) {
  const base = typeScale[variant] as TextStyle;
  const resolved = color ?? (muted ? colors.textMute : dim ? colors.textDim : colors.text);
  return (
    <RNText
      {...rest}
      style={[
        base,
        { color: resolved },
        numeric && styles.numeric,
        center && styles.center,
        upper && styles.upper,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  numeric: { fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  center: { textAlign: 'center' },
  upper: { textTransform: 'uppercase' },
});
