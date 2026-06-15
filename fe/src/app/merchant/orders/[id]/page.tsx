'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';

interface Order { id: string; reference: string; amount: string; status: string; payer: string | null; txSignature: string | null; }
const TERMINAL = ['paid', 'expired', 'failed'];

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    let active = true;
    const t = setInterval(load, 4000);
    async function load() {
      const res = await fetch(`/api/merchant/orders/${id}`);
      if (!active) return;
      if (res.ok) {
        const o: Order = await res.json();
        setOrder(o);
        if (TERMINAL.includes(o.status)) clearInterval(t);
      }
    }
    load();
    return () => { active = false; clearInterval(t); };
  }, [id]);

  if (!order) return <main style={{ padding: 32 }}><p>Loading…</p></main>;
  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 560 }}>
      <p><Link href="/merchant/orders">← orders</Link></p>
      <h1>Order {order.reference}</h1>
      <dl>
        <dt>Amount (USDC)</dt><dd>{(Number(order.amount) / 1_000_000).toFixed(2)}</dd>
        <dt>Status</dt><dd><b>{order.status}</b></dd>
        <dt>Payer</dt><dd>{order.payer ?? '—'}</dd>
        <dt>Tx</dt><dd>{order.txSignature ? <a href={`https://explorer.solana.com/tx/${order.txSignature}?cluster=devnet`} target="_blank">{order.txSignature.slice(0, 16)}…</a> : '—'}</dd>
      </dl>
    </main>
  );
}
