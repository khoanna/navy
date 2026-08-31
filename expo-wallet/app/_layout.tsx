import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PrivyProvider } from '@privy-io/expo';
import { PrivyElements } from '@privy-io/expo/ui';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { base } from 'viem/chains'; // Base chain for Base mainnet
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
        {/* @privy-io/expo PrivyProvider config.embedded.ethereum.createOnLogin provisions
            an EVM (Base) embedded wallet on login for users who don't have one.
            The app uses useEmbeddedEthereumWallet + useMobileSigner (EVM signer);
            useMobileSigner still keeps the fallback provisioning latch as a backstop. */}
        <PrivyProvider
          appId={env.privyAppId}
          clientId={env.privyClientId}
          supportedChains={[base]}
          config={{ embedded: { ethereum: { createOnLogin: 'users-without-wallets' } } }}
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
