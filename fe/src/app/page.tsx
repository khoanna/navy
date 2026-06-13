import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Navy Console</h1>
      <p><Link href="/admin/login">Admin sign in</Link></p>
      <p><Link href="/merchant/login">Merchant sign in</Link></p>
    </main>
  );
}
