import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { usePrivy } from '@privy-io/expo';
import { useNavySession } from '@/lib/auth/SessionContext';
import { Splash } from '@/ui/Splash';
import { Icon } from '@/ui/Icon';
import { colors } from '@/ui/theme';

/**
 * Authenticated tab navigator + auth guard.
 *
 * Mirrors web-wallet/src/app/(tabs)/layout.tsx:
 *   - Holds on <Splash> until Privy is ready AND the persisted Navy session
 *     has finished initializing (both settled = no protected flash).
 *   - Redirects to /login when there is no session.
 *
 * Tab order, labels and icons match web-wallet/src/ui/TabBar.tsx exactly:
 *   home     → "Wallet"   → home
 *   scan     → "Pay"      → scan
 *   farming  → "Earn"     → sprout
 *   history  → "Activity" → clock
 *   settings → "Settings" → settings
 */
export default function TabsLayout() {
  const { isReady } = usePrivy();
  const { session, initializing } = useNavySession();

  // Hold the splash until both state machines have settled.
  if (!isReady || initializing) return <Splash />;

  // No session → send to login.
  if (!session) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.aqua,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
        },
      }}
    >
      {/* 1. Wallet — main balance + portfolio screen */}
      <Tabs.Screen
        name="home"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, size }) => (
            <Icon name="home" color={color} size={size} />
          ),
        }}
      />

      {/* 2. Pay — QR scan-to-pay */}
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Pay',
          tabBarIcon: ({ color, size }) => (
            <Icon name="scan" color={color} size={size} />
          ),
        }}
      />

      {/* 3. Earn — farming / yield screen */}
      <Tabs.Screen
        name="farming"
        options={{
          title: 'Earn',
          tabBarIcon: ({ color, size }) => (
            <Icon name="sprout" color={color} size={size} />
          ),
        }}
      />

      {/* 4. Activity — transaction history */}
      <Tabs.Screen
        name="history"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => (
            <Icon name="clock" color={color} size={size} />
          ),
        }}
      />

      {/* 5. Assistant — AI chat (portfolio, transfers, farming) */}
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color, size }) => (
            <Icon name="bolt" color={color} size={size} />
          ),
        }}
      />

      {/* 6. Settings — account / security */}
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Icon name="settings" color={color} size={size} />
          ),
        }}
      />

      {/* Receive — reachable from Home (e.g. the "Receive" action), NOT a bottom
          tab. Matches web-wallet, where receive/ lives under the tab group but is
          absent from TabBar. href:null keeps the route navigable while hidden. */}
      <Tabs.Screen name="receive" options={{ href: null }} />
    </Tabs>
  );
}
