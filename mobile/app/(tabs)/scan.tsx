import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parsePayUrl } from '../../src/pay/payUrl';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { IconBadge } from '../../src/ui/Bits';
import { colors, radius, space } from '../../src/ui/theme';

const { width } = Dimensions.get('window');
const FRAME = Math.min(width - 96, 280);

/** Four rounded corner brackets framing the scan window. */
function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = {
    tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.lg },
    tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.lg },
    bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.lg },
    br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.lg },
  }[pos];
  return <View style={[styles.corner, base as object]} />;
}

export default function Scan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const scan = useRef(new Animated.Value(0)).current;

  // Reset the one-shot lock whenever the tab regains focus.
  useFocusEffect(
    React.useCallback(() => {
      setDone(false);
      setError('');
    }, []),
  );

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scan, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
  }, [scan]);

  if (!permission) {
    return (
      <View style={styles.fallback}>
        <Text dim>Preparing camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fallback, { padding: space.xxl }]}>
        <IconBadge name="scan" color={colors.accent} size={72} />
        <Text variant="h2" color={colors.textHi} center style={{ marginTop: space.xl }}>
          Camera access
        </Text>
        <Text dim center style={{ marginTop: space.sm, marginBottom: space.xxl }}>
          Navy needs your camera to scan payment QR codes. Nothing is recorded.
        </Text>
        <Button label="Allow camera" icon="check" onPress={requestPermission} full={false} />
      </View>
    );
  }

  const translateY = scan.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME - 6] });

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done) return;
          try {
            const id = parsePayUrl(data);
            setDone(true);
            router.push(`/pay/${id}`);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />

      {/* Scrim with a cut-out frame */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.header, { paddingTop: insets.top + space.xl }]}>
          <Text variant="label" color={colors.textHi} upper>
            Scan to pay
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.7)" center style={{ marginTop: 4 }}>
            Point at a Navy invoice QR code
          </Text>
        </View>

        <View style={styles.frame}>
          <Corner pos="tl" />
          <Corner pos="tr" />
          <Corner pos="bl" />
          <Corner pos="br" />
          <Animated.View style={[styles.laser, { transform: [{ translateY }] }]} />
        </View>

        <View style={styles.footer}>
          {error ? (
            <View style={styles.errorPill}>
              <Text variant="caption" color={colors.danger} center>
                {error}
              </Text>
            </View>
          ) : (
            <View style={styles.hintPill}>
              <Text variant="caption" color="rgba(255,255,255,0.8)" center>
                Gasless — Navy covers the network fee
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'space-between' },
  header: { alignItems: 'center', paddingHorizontal: space.xxl },
  frame: { width: FRAME, height: FRAME, marginTop: -40 },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: colors.aqua },
  laser: {
    position: 'absolute',
    left: 6,
    right: 6,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.aqua,
    shadowColor: colors.aqua,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  footer: { paddingBottom: 120, paddingHorizontal: space.xxl, width: '100%', alignItems: 'center' },
  hintPill: { backgroundColor: 'rgba(0,0,0,0.45)', paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill },
  errorPill: { backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,107,131,0.4)' },
});
