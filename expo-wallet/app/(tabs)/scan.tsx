import React from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  StatusBar,
  Dimensions,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraScanner } from '@/lib/pay/useCameraScanner';
import { useToast } from '@/ui/Toast';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { colors, radius, space } from '@/ui/theme';

/** Reticle size matching the web scan page (170 × 170 px). */
const RETICLE = 170;
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const RETICLE_TOP = (SCREEN_H - RETICLE) / 2;
const RETICLE_LEFT = (SCREEN_W - RETICLE) / 2;

/**
 * Scan tab — full-bleed camera viewfinder with a QR scan-frame overlay.
 *
 * expo-camera v17 (SDK 54) API used:
 *   - Component: CameraView (not the legacy Camera class)
 *   - Permission hook: useCameraPermissions() → [PermissionResponse|null, requestFn, refreshFn]
 *   - Barcode prop: onBarcodeScanned={(result: BarcodeScanningResult) => void}
 *   - Barcode settings: barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
 *
 * On a valid Navy pay URL: navigates to /pay/<orderId> via Expo Router.
 * On an invalid QR: shows a toast ("Not a Navy pay code").
 * Permission denied: shows a centred prompt with a "Grant access" button.
 */
export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const { permission, requestPermission, handleBarcode } = useCameraScanner({
    onOrder: (orderId) => {
      router.replace(`/pay/${orderId}`);
    },
    onSend: (target) => {
      let url = '/send?to=' + encodeURIComponent(target.address);
      if (target.amountWei) url += '&amountWei=' + target.amountWei + '&asset=ETH';
      router.replace(url);
    },
    onInvalid: () => {
      toast('Not a Navy pay code');
    },
  });

  // ── Permission not yet determined ────────────────────────────────────────
  if (!permission) {
    // Still loading the permission state — render nothing (avoids flash).
    return <View style={styles.root} />;
  }

  // ── Permission denied or not granted ────────────────────────────────────
  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.centred, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permBox}>
          <Text variant="h2" color={colors.textHi} center>
            Camera access needed
          </Text>
          <Text
            variant="body"
            color={colors.textDim}
            center
            style={{ marginTop: space.sm }}
          >
            Allow camera access to scan Navy QR codes and pay instantly.
          </Text>
          <View style={{ marginTop: space.xl, alignSelf: 'stretch' }}>
            <Button
              label={permission.canAskAgain ? 'Grant access' : 'Open settings'}
              onPress={
                permission.canAskAgain ? requestPermission : () => Linking.openSettings()
              }
            />
          </View>
        </View>
      </View>
    );
  }

  // ── Camera active ────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Full-bleed camera viewfinder */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcode}
      />

      {/* Scrim overlay — four absolute panels that darken everything outside
          the reticle without needing BlurView or percentage-based layouts.
          pointerEvents="none" so touch passes through to the camera. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* top */}
        <View style={[styles.scrimPanel, { top: 0, left: 0, right: 0, height: RETICLE_TOP }]} />
        {/* bottom */}
        <View
          style={[
            styles.scrimPanel,
            { top: RETICLE_TOP + RETICLE, left: 0, right: 0, bottom: 0 },
          ]}
        />
        {/* left (middle row) */}
        <View
          style={[
            styles.scrimPanel,
            { top: RETICLE_TOP, left: 0, width: RETICLE_LEFT, height: RETICLE },
          ]}
        />
        {/* right (middle row) */}
        <View
          style={[
            styles.scrimPanel,
            {
              top: RETICLE_TOP,
              left: RETICLE_LEFT + RETICLE,
              right: 0,
              height: RETICLE,
            },
          ]}
        />
      </View>

      {/* Reticle border ring — centred absolutely */}
      <View
        style={[
          styles.reticle,
          { top: RETICLE_TOP, left: RETICLE_LEFT },
        ]}
        pointerEvents="none"
      >
        {/* Corner accent markers — aqua L-shapes at each corner */}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          { paddingTop: Math.max(insets.top + space.sm, space.xxl) },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.iconBtn}
          accessibilityLabel="Close scanner"
        >
          <Text variant="h3" color={colors.textHi}>
            ✕
          </Text>
        </Pressable>

        <Text variant="label" color={colors.textHi} upper>
          Scan to pay
        </Text>

        {/* Right slot — empty spacer keeps title centred */}
        <View style={{ width: 40 }} />
      </View>

      {/* Hint caption ~24 px below the reticle */}
      <View
        style={[styles.hint, { top: RETICLE_TOP + RETICLE + 24 }]}
        pointerEvents="none"
      >
        <View style={styles.hintPill}>
          <Text variant="caption" color="rgba(255,255,255,0.8)" center>
            Point at a Navy QR code
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  permBox: {
    paddingHorizontal: space.xxl,
    alignItems: 'center',
    maxWidth: 360,
    gap: space.sm,
  },
  scrimPanel: {
    position: 'absolute',
    backgroundColor: 'rgba(4,8,20,0.72)',
  },
  reticle: {
    position: 'absolute',
    width: RETICLE,
    height: RETICLE,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    zIndex: 11,
    overflow: 'hidden',
  },
  // Corner accent helpers — aqua L-shaped markers at each corner
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: colors.aqua,
  },
  cornerTL: {
    top: -1,
    left: -1,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: radius.xl,
  },
  cornerTR: {
    top: -1,
    right: -1,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: radius.xl,
  },
  cornerBL: {
    bottom: -1,
    left: -1,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: radius.xl,
  },
  cornerBR: {
    bottom: -1,
    right: -1,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: radius.xl,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    zIndex: 20,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: space.xxl,
    zIndex: 20,
  },
  hintPill: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
});
