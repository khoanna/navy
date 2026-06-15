'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Order { id: string; reference: string; amount: string; status: string; createdAt: string; }

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('all');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/merchant/orders?status=${status}`);
      if (active && res.ok) setOrders(await res.json());
    };
    load();
    const t = setInterval(load, 4000);
    return () => { active = false; clearInterval(t); };
  }, [status]);

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Orders</h1>
        <Link href="/merchant/orders/new"><button>New invoice</button></Link>
      </div>
      <nav style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
        {['all', 'awaiting_payment', 'paid', 'expired'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} style={{ fontWeight: s === status ? 700 : 400 }}>{s}</button>
        ))}
      </nav>
      <table cellPadding={8} style={{ borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Reference</th><th align="left">Amount (USDC)</th><th align="left">Status</th><th /></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{o.reference}</td>
              <td>{(Number(o.amount) / 1_000_000).toFixed(2)}</td>
              <td>{o.status}</td>
              <td><Link href={`/merchant/orders/${o.id}`}>view</Link></td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={4}>No orders.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
