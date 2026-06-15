import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavySession } from '../src/auth/SessionContext';
import { getEnv } from '../src/config/env';
import { NavyPayClient, Payment } from '../src/pay/navyPayClient';

export default function History() {
  const { session } = useNavySession();
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    const token = session?.tokens.accessToken;
    if (!token) return;
    const client = new NavyPayClient(getEnv().navyApiUrl);
    client.getUserPayments(token).then(setPayments).catch(() => setPayments([]));
  }, [session]);

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Payments</Text>
      <FlatList
        data={payments}
        keyExtractor={(p) => p.orderId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text>{item.merchant ?? item.reference}</Text>
            <Text>{(Number(item.amount) / 1_000_000).toFixed(2)} USDC</Text>
          </View>
        )}
        ListEmptyComponent={<Text>No payments yet.</Text>}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8 },
  h: { fontSize: 22, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
});
