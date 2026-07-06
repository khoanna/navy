import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, radius, space } from './theme';

const Ctx = createContext<(msg: string) => void>(() => {});

/** Returns a `show(message)` function that displays a transient toast. */
export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string) => {
    // Cancel any in-flight timer.
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    setMsg(m);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start(() => setMsg(null));
    }, 3200);
  }, [opacity]);

  return (
    <Ctx.Provider value={toast}>
      {children}
      {msg !== null && (
        <View style={styles.positioner} pointerEvents="none">
          <Animated.View style={[styles.toast, { opacity }]}>
            <Text variant="body" color={colors.textHi}>
              {msg}
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
