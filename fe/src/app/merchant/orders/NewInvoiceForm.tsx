'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatUsdc } from '@/lib/dashboard/stats';
import { computeInvoiceTotals } from '@/lib/invoice-totals';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { colors, space, radius } from '@/ui/theme';

const inputStyle: React.CSSProperties = { background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, borderRadius: radius.md, color: colors.text, padding: '12px 14px', outline: 'none', width: '100%' };

interface Product { id: string; name: string; unitPrice: string; active: boolean; }
interface Charge { name: string; mode: 'percent' | 'fixed'; value: number; active: boolean; }
interface Line { productId: string; quantity: number; }

const EXPIRY_PRESETS: { label: string; seconds: number }[] = [
  { label: '15 minutes', seconds: 900 }, { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 }, { label: '7 days', seconds: 604800 },
];

export function NewInvoiceForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [description, setDescription] = useState('');
  const [expiresInSec, setExpiresInSec] = useState(900);
  const [result, setResult] = useState<{ orderId: string; reference: string; qr: string; payUrl: string } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    fetch('/api/merchant/products').then((r) => r.ok ? r.json() : []).then((all: Product[]) => setProducts(all.filter((p) => p.active)));
    fetch('/api/merchant/charges').then((r) => r.ok ? r.json() : []).then((c: Charge[]) => setCharges(c));
  }, []);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const totals = useMemo(() => computeInvoiceTotals(
    lines.filter((l) => byId.has(l.productId)).map((l) => ({ unitPrice: BigInt(byId.get(l.productId)!.unitPrice), quantity: l.quantity })),
    charges.filter((c) => c.active).map((c) => ({ name: c.name, mode: c.mode, value: c.value })),
  ), [lines, charges, byId]);

  const addLine = () => { if (products[0]) setLines((ls) => [...ls, { productId: products[0].id, quantity: 1 }]); };
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError(''); setResult(null);
      if (lines.length === 0) { setError('Add at least one product'); return; }
      setSubmitting(true);
      const res = await fetch('/api/merchant/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines, description: description || undefined, expiresInSec }),
      });
      const body = await res.json();
      setSubmitting(false);
      if (res.ok) { setResult({ orderId: body.orderId, reference: body.reference, qr: body.qr, payUrl: body.payUrl }); onCreated?.(); }
      else setError(body.error ?? (res.status === 409 ? 'Your account is not approved yet' : `Failed (${res.status})`));
    } finally { submittingRef.current = false; }
  }

  if (result) {
    return (
      <div style={{ display: 'grid', gap: space.md, justifyItems: 'start' }}>
        <Text variant="body" dim>Invoice <Text variant="mono" color={colors.textHi}>{result.reference}</Text> created. Show this QR to your customer:</Text>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.qr} alt="payment QR" width={220} height={220} style={{ borderRadius: radius.md, background: '#fff', padding: space.sm }} />
        <div style={{ wordBreak: 'break-all' }}><Text variant="mono" color={colors.text}>{result.payUrl}</Text></div>
        <Link href={`/merchant/orders/${result.orderId}`}><Text variant="bodyStrong" color={colors.accent}>Track this order →</Text></Link>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: space.md, padding: `${space.lg}px ${space.sm}px` }}>
        <div style={{ width: 52, height: 52, borderRadius: radius.xl, background: colors.bgElevated, border: `1px solid ${colors.border}`, display: 'grid', placeItems: 'center' }}>
          <Icon name="store" size={24} color={colors.textDim} />
        </div>
        <div style={{ display: 'grid', gap: space.xs, maxWidth: 300 }}>
          <Text variant="bodyStrong" color={colors.textHi}>No products yet</Text>
          <Text variant="caption" dim>Invoices are built from your catalog. Add a product to get started.</Text>
        </div>
        <Button label="Go to Products" icon="plus" full={false} onPress={() => router.push('/merchant/products')} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: space.md }}>
      <div style={{ display: 'grid', gap: space.sm }}>
        <Text variant="label" muted upper>Items</Text>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
            <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatUsdc(p.unitPrice)} USDC</option>)}
            </select>
            <input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, parseInt(e.target.value || '1', 10)) })} style={{ ...inputStyle, width: 80 }} />
            <Button label="✕" variant="ghost" full={false} onPress={() => removeLine(i)} />
          </div>
        ))}
        <Button label="Add item" variant="secondary" icon="plus" full={false} onPress={addLine} />
      </div>

      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Description (optional)</Text>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this for?" style={inputStyle} />
      </div>

      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Expires in</Text>
        <select value={expiresInSec} onChange={(e) => setExpiresInSec(parseInt(e.target.value, 10))} style={inputStyle}>
          {EXPIRY_PRESETS.map((p) => <option key={p.seconds} value={p.seconds}>{p.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gap: space.xs, padding: space.md, border: `1px solid ${colors.border}`, borderRadius: radius.md }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text variant="body" dim>Subtotal</Text><Text variant="body" numeric>{formatUsdc(totals.subtotal.toString())} USDC</Text></div>
        {totals.charges.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><Text variant="body" dim>{c.name}</Text><Text variant="body" numeric>{formatUsdc(c.amount.toString())} USDC</Text></div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text variant="bodyStrong" color={colors.textHi}>Total</Text><Text variant="bodyStrong" color={colors.textHi} numeric>{formatUsdc(totals.total.toString())} USDC</Text></div>
      </div>

      <Button label="Create invoice" loading={submitting} />
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
    </form>
  );
}
