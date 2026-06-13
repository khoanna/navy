import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { usePrivy } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';

export default function Index() {
  const { isReady } = usePrivy();
  const { session, initializing } = useNavySession();

  if (!isReady || initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={session ? '/home' : '/login'} />;
}
