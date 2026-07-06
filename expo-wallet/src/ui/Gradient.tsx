import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Dir = 'diagonal' | 'vertical' | 'horizontal';

/**
 * Gradient direction → LinearGradient start/end vectors.
 * Web uses CSS angle: diagonal=135deg, vertical=180deg, horizontal=90deg.
 * LinearGradient vectors go from start → end (both in 0..1 unit square).
 *   - 135deg ≈ top-left → bottom-right
 *   - 180deg = top → bottom
 *   - 90deg  = left → right
 */
const VECTORS: Record<Dir, { start: { x: number; y: number }; end: { x: number; y: number } }> = {
  diagonal: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  vertical: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  horizontal: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
};

export interface GradientProps {
  colors: readonly string[];
  locations?: readonly number[];
  direction?: Dir;
  /** Adds a radial highlight layer in the web version (not reproducible with
   *  LinearGradient alone — omitted silently; kept in props for API compat). */
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Gradient({
  colors: gradientColors,
  locations,
  direction = 'diagonal',
  glow: _glow,
  style,
  children,
}: GradientProps) {
  const { start, end } = VECTORS[direction];
  // expo-linear-gradient requires at least 2 colours (typed as a tuple).
  // If only one is passed, duplicate it to avoid a runtime error.
  const safeColors: readonly [string, string, ...string[]] =
    gradientColors.length >= 2
      ? (gradientColors as unknown as readonly [string, string, ...string[]])
      : [gradientColors[0] as string, gradientColors[0] as string];

  // locations must also be a same-length tuple
  const safeLocations =
    locations && locations.length >= 2
      ? (locations as unknown as readonly [number, number, ...number[]])
      : undefined;

  return (
    <LinearGradient
      colors={safeColors}
      locations={safeLocations}
      start={start}
      end={end}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
