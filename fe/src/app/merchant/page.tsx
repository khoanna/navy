import WalletConnectClient from './WalletConnectClient';
import ApiKeyPanel from './ApiKeyPanel';
import LogoutButton from '../admin/LogoutButton';
import Link from 'next/link';

export default function MerchantDashboard() {
  return (
    <main style={{ padding: 32, maxWidth: 560, fontFamily: 'sans-serif' }}>
      <h1>Merchant dashboard</h1>
      <section style={{ marginBottom: 24 }}>
        <h2>Orders</h2>
        <p>Create invoices and track payments.</p>
        <Link href="/merchant/orders"><button>Open orders</button></Link>
      </section>
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
