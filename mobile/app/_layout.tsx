import React from 'react';
import { Slot } from 'expo-router';
import { PrivyProvider } from '@privy-io/expo';
import { getEnv } from '../src/config/env';
import { SessionProvider } from '../src/auth/SessionContext';

export default function RootLayout() {
  const env = getEnv();
  return (
    <PrivyProvider
      appId={env.privyAppId}
      clientId={env.privyClientId}
      config={{ embedded: { solana: { createOnLogin: 'users-without-wallets' } } }}
    >
      <SessionProvider>
        <Slot />
      </SessionProvider>
    </PrivyProvider>
  );
}
