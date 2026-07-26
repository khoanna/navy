import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, radius, space } from './theme';

export type ToastIntent = 'info' | 'success' | 'error';

const Ctx = createContext<(msg: string, intent?: ToastIntent) => void>(() => {});

/** Returns a `show(message, intent?)` function that displays a transient toast. */
export function useToast() {
  return useContext(Ctx);
}

const INTENT_BORDER: Record<ToastIntent, string> = {
  info: colors.borderStrong,
  success: colors.success,
  error: colors.danger,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ msg: string; intent: ToastIntent } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string, intent: ToastIntent = 'info') => {
    // Cancel any in-flight timer.
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    setState({ msg: m, intent });
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    const dwell = intent === 'error' ? 4600 : 3200;
    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start(() => setState(null));
    }, dwell);
  }, [opacity]);

  return (
    <Ctx.Provider value={toast}>
      {children}
      {state !== null && (
        <View style={styles.positioner} pointerEvents="none">
          <Animated.View
            style={[styles.toast, { opacity, borderLeftWidth: 3, borderLeftColor: INTENT_BORDER[state.intent] }]}
          >
            <Text variant="body" color={colors.textHi}>
              {state.msg}
            </Text>
          </Animated.View>
        </View>
      )}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  positioner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 110,
    alignItems: 'center',
    zIndex: 100,
  },
  toast: {
    maxWidth: 380,
    backgroundColor: colors.surfaceHi,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    // Shadow for visual depth.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
});
