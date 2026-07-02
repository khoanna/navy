'use client';
import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { getEnv } from '@/lib/config/env';
import { SessionProvider } from '@/lib/auth/SessionContext';
import { ToastProvider } from '@/ui/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  const env = getEnv();
  return (
    <PrivyProvider
      appId={env.privyAppId}
      clientId={env.privyClientId}
      config={{
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <SessionProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </PrivyProvider>
  );
}
