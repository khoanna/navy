import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PrivyProvider } from '@privy-io/expo';
import { getEnv } from '../src/config/env';
import { SessionProvider } from '../src/auth/SessionContext';
import { colors } from '../src/ui/theme';

export default function RootLayout() {
  const env = getEnv();
  return (
    <SafeAreaProvider>
      <PrivyProvider
        appId={env.privyAppId}
        clientId={env.privyClientId}
        config={{ embedded: { solana: { createOnLogin: 'users-without-wallets' } } }}
      >
        <SessionProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="pay/[orderId]" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          </Stack>
        </SessionProvider>
      </PrivyProvider>
    </SafeAreaProvider>
  );
}
