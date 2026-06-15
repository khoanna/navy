import React, { useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { parsePayUrl } from '../src/pay/payUrl';

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!permission) return <View style={styles.c}><Text>Requesting camera…</Text></View>;
  if (!permission.granted) {
    return <View style={styles.c}><Text>Camera permission needed</Text><Button title="Grant" onPress={requestPermission} /></View>;
  }
  return (
    <View style={{ flex: 1 }}>
      <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done) return;
          try { const id = parsePayUrl(data); setDone(true); router.replace(`/pay/${id}`); }
          catch (e) { setError((e as Error).message); }
        }} />
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  err: { position: 'absolute', bottom: 40, alignSelf: 'center', color: 'crimson', backgroundColor: '#fff', padding: 8 },
});
