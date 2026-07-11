import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PrivyProvider } from '@privy-io/expo';
import { PrivyElements } from '@privy-io/expo/ui';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getEnv } from '@/lib/config/env';
import { SessionProvider } from '@/lib/auth/SessionContext';
import { ToastProvider } from '@/ui/Toast';
import { MfaGate } from '@/features/mfa/MfaGate';
import { RecoveryGate } from '@/features/mfa/RecoveryGate';

export default function Root() {
  const env = getEnv();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* @privy-io/expo PrivyProvider supports config.embedded.solana.createOnLogin
            (verified against v0.70.0 PrivyConfig). Mirrors the web app's
            embeddedWallets.solana.createOnLogin: 'users-without-wallets' intent;
            useMobileSigner still keeps the fallback provisioning latch as a backstop. */}
        <PrivyProvider
          appId={env.privyAppId}
          clientId={env.privyClientId}
          config={{ embedded: { solana: { createOnLogin: 'users-without-wallets' } } }}
        >
          <SessionProvider>
            <ToastProvider>
              <Slot />
              <MfaGate />
              <RecoveryGate />
              <PrivyElements />
            </ToastProvider>
          </SessionProvider>
        </PrivyProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
