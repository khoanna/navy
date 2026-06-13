import WalletConnectClient from './WalletConnectClient';
import ApiKeyPanel from './ApiKeyPanel';
import LogoutButton from '../admin/LogoutButton';

export default function MerchantDashboard() {
  return (
    <main style={{ padding: 32, maxWidth: 560, fontFamily: 'sans-serif' }}>
      <h1>Merchant dashboard</h1>
      <section style={{ marginTop: 16 }}>
        <h2>API credentials</h2>
        <ApiKeyPanel />
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Payout wallet</h2>
        <p>Connect your Phantom/Solflare wallet and sign to register your payout address.</p>
        <WalletConnectClient />
      </section>
      <section style={{ marginTop: 24 }}><LogoutButton /></section>
    </main>
  );
}
