import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useLoginWithOAuth, useLoginWithEmail, useLoginWithSMS } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';

export default function Login() {
  const router = useRouter();
  const { establishFromPrivy } = useNavySession();
  const { login: loginOAuth } = useLoginWithOAuth();
  const email = useLoginWithEmail();
  const sms = useLoginWithSMS();

  const [emailAddr, setEmailAddr] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');

  const finish = async () => {
    try {
      await establishFromPrivy();
      router.replace('/home');
    } catch (e) {
      Alert.alert('Login failed', (e as Error).message);
    }
  };

  const social = async (provider: 'google' | 'apple') => {
    try {
      await loginOAuth({ provider });
      await finish();
    } catch (e) {
      Alert.alert('Social login failed', (e as Error).message);
    }
  };

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Sign in to Navy</Text>

      <Button title="Continue with Google" onPress={() => social('google')} />
      <Button title="Continue with Apple" onPress={() => social('apple')} />

      <Text style={styles.s}>Email code</Text>
      <TextInput style={styles.i} autoCapitalize="none" keyboardType="email-address"
        placeholder="you@example.com" value={emailAddr} onChangeText={setEmailAddr} />
      <Button title="Send email code" onPress={() => email.sendCode({ email: emailAddr })} />
      <TextInput style={styles.i} keyboardType="number-pad" placeholder="123456"
        value={emailCode} onChangeText={setEmailCode} />
      <Button title="Verify email code" onPress={async () => {
        try { await email.loginWithCode({ code: emailCode, email: emailAddr }); await finish(); }
        catch (e) { Alert.alert('Email login failed', (e as Error).message); }
      }} />

      <Text style={styles.s}>Phone code</Text>
      <TextInput style={styles.i} keyboardType="phone-pad" placeholder="+15551234567"
        value={phone} onChangeText={setPhone} />
      <Button title="Send SMS code" onPress={() => sms.sendCode({ phone })} />
      <TextInput style={styles.i} keyboardType="number-pad" placeholder="123456"
        value={smsCode} onChangeText={setSmsCode} />
      <Button title="Verify SMS code" onPress={async () => {
        try { await sms.loginWithCode({ code: smsCode, phone }); await finish(); }
        catch (e) { Alert.alert('SMS login failed', (e as Error).message); }
      }} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  s: { marginTop: 16, fontWeight: '600' },
  i: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
});
