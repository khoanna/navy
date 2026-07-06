import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { clampProgress, isConfirmed } from '@/lib/ui/slide';
import { Gradient } from './Gradient';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors, gradients, radius } from './theme';

const KNOB = 46;
const TRACK_HEIGHT = 54;
const PADDING = 4;

export interface SlideToConfirmProps {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  resetKey?: number | string;
}

/**
 * Drag-to-confirm control for money-moving actions. Snaps back if released
 * early. Ports the web component using react-native-gesture-handler +
 * react-native-reanimated; drives threshold logic with @/lib/ui/slide.
 */
export function SlideToConfirm({ label, onConfirm, disabled, resetKey }: SlideToConfirmProps) {
  const offset = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const done = useSharedValue(false);

  // Reset when resetKey changes.
  useEffect(() => {
    offset.value = withSpring(0);
    done.value = false;
  }, [resetKey]);

  const confirm = () => {
    onConfirm();
  };

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onUpdate((e) => {
      if (done.value) return;
      // trackPx is the maximum travel distance of the knob.
      const trackPx = trackWidth.value - KNOB - PADDING * 2;
      const clamped = Math.max(0, Math.min(e.translationX, trackPx));
      offset.value = clamped;

      if (isConfirmed(clampProgress(clamped, trackPx))) {
        done.value = true;
        offset.value = trackPx;
        runOnJS(confirm)();
      }
    })
    .onEnd(() => {
      if (!done.value) {
        offset.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View
      style={[styles.track, disabled && styles.disabled]}
      onLayout={(e) => {
        trackWidth.value = e.nativeEvent.layout.width;
      }}
    >
      {/* Centre label */}
      <Text variant="bodyStrong" color={colors.textDim}>
        {label}
      </Text>

      {/* Draggable knob */}
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, knobStyle]}>
          <Gradient
            colors={gradients.ocean}
            style={styles.knobGradient}
          >
            <Icon name="chevron" size={22} color={colors.onAccent} strokeWidth={2.4} />
          </Gradient>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHi,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.5,
  },
  knob: {
    position: 'absolute',
    left: PADDING,
    top: PADDING,
    width: KNOB,
    height: KNOB,
  },
  knobGradient: {
    width: KNOB,
    height: KNOB,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
