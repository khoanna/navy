import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Icon, IconName } from './Icon';
import { colors, radius, space } from './theme';

export type ToastIntent = 'info' | 'success' | 'error' | 'warning';

const Ctx = createContext<(msg: string, intent?: ToastIntent) => void>(() => {});

/** Returns a `show(message, intent?)` function that displays a transient toast. */
export function useToast() {
  return useContext(Ctx);
}

const INTENT_STYLES: Record<ToastIntent, { border: string; icon: IconName }> = {
  info: { border: colors.borderStrong, icon: 'info' },
  success: { border: colors.success, icon: 'check' },
  error: { border: colors.danger, icon: 'alert' },
  warning: { border: colors.warning, icon: 'alert' },
};

const DWELL_TIMES: Record<ToastIntent, number> = {
  info: 3200,
  success: 2800,
  warning: 4000,
  error: 4600,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ msg: string; intent: ToastIntent } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string, intent: ToastIntent = 'info') => {
    // Cancel any in-flight timer.
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    setState({ msg: m, intent });

    // Reset and animate in
    translateY.setValue(20);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 15,
        bounciness: 8,
      }),
    ]).start();

    const dwell = DWELL_TIMES[intent];
    timerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 20,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(() => setState(null));
    }, dwell);
  }, [opacity, translateY]);

  return (
    <Ctx.Provider value={toast}>
      {children}
      {state !== null && (
        <View style={styles.positioner} pointerEvents="none">
          <Animated.View
            style={[
              styles.toast,
              {
                opacity,
                transform: [{ translateY }],
                borderLeftWidth: 4,
                borderLeftColor: INTENT_STYLES[state.intent].border,
              },
            ]}
          >
            <View style={styles.toastContent}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: INTENT_STYLES[state.intent].border + '20' },
                ]}
              >
                <Icon
                  name={INTENT_STYLES[state.intent].icon}
                  size={16}
                  color={INTENT_STYLES[state.intent].border}
                  strokeWidth={2}
                />
              </View>
              <Text variant="body" color={colors.textHi} style={styles.message}>
                {state.msg}
              </Text>
            </View>
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
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  message: {
    flex: 1,
  },
});
