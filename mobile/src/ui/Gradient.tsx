import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, RadialGradient, Stop, Rect, Circle } from 'react-native-svg';

type Dir = 'diagonal' | 'vertical' | 'horizontal';

const DIR: Record<Dir, { x1: string; y1: string; x2: string; y2: string }> = {
  diagonal: { x1: '0', y1: '0', x2: '1', y2: '1' },
  vertical: { x1: '0', y1: '0', x2: '0', y2: '1' },
  horizontal: { x1: '0', y1: '0', x2: '1', y2: '0' },
};

let _id = 0;
const nextId = () => `grad_${_id++}`;

export interface GradientProps {
  colors: readonly string[];
  locations?: readonly number[];
  direction?: Dir;
  /** Optional luminous blob in the corner, for depth on hero surfaces. */
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * A linear-gradient fill drawn with react-native-svg (no expo-linear-gradient
 * dependency). Children render on top. The host View clips to its borderRadius.
 */
export function Gradient({ colors, locations, direction = 'diagonal', glow, style, children }: GradientProps) {
  const id = React.useRef(nextId()).current;
  const glowId = `${id}_glow`;
  const d = DIR[direction];
  return (
    <View style={[styles.host, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id={id} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2}>
            {colors.map((c, i) => (
              <Stop key={i} offset={locations ? locations[i] : i / (colors.length - 1)} stopColor={c} />
            ))}
          </SvgLinearGradient>
          {glow && (
            <RadialGradient id={glowId} cx="82%" cy="12%" r="62%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.35" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </RadialGradient>
          )}
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
        {glow && <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${glowId})`} />}
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { overflow: 'hidden' },
});
