'use client';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import ApiKeyPanel from '../ApiKeyPanel';
import WalletConnectClient from '../WalletConnectClient';
import { ChargesPanel } from './ChargesPanel';

export default function MerchantSettings() {
  const router = useRouter();
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/merchant/login'); };

  return (
    <AppShell items={MERCHANT_NAV} identity={{ title: 'Merchant', subtitle: 'Dashboard' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title="Settings" />
      <div style={{ marginBottom: space.xl }}>
        <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.xs }}>Payout wallet</Text>
        <Text variant="caption" dim style={{ display: 'block', marginBottom: space.md }}>Connect the wallet that receives your settlements, then sign to set it on-chain.</Text>
        <WalletConnectClient />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.xs }}>API credentials</Text>
        <Text variant="caption" dim style={{ display: 'block', marginBottom: space.md }}>Server-to-server key for the payments API. Requires an approved payout wallet.</Text>
        <ApiKeyPanel />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <ChargesPanel />
      </div>
    </AppShell>
  );
}
