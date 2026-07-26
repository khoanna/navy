'use client';
import { useState } from 'react';
import { usdcInputToBaseUnits } from '@/lib/money';
import { formatUsdc } from '@/lib/dashboard/stats';
import { validateImageFile, ALLOWED_IMAGE_MIMES } from '@/lib/product-image';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { useToast } from '@/ui/Toast';
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';
import { detailOf } from '@/lib/httpError';
import { colors, space, radius } from '@/ui/theme';

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md, color: colors.text, padding: '12px 14px', outline: 'none', width: '100%',
};

export interface ProductRow { id: string; name: string; sku: string | null; unitPrice: string; imageUrl: string | null; active: boolean; }

export function ProductForm({ initial, onSaved }: { initial?: ProductRow; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [price, setPrice] = useState(initial ? formatUsdc(initial.unitPrice) : '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.imageUrl ?? null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    const f = e.target.files?.[0] ?? null;
    if (!f) { setFile(null); setPreview(initial?.imageUrl ?? null); return; }
    const err = validateImageFile(f);
    if (err) { setError(err); setFile(null); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    let unitPrice: string;
    try { unitPrice = usdcInputToBaseUnits(price); } catch (err) { setError((err as Error).message); return; }
    if (unitPrice === '0') { setError('Price must be greater than 0'); return; }
    if (!name.trim()) { setError('Name is required'); return; }
    if (!initial && !file) { setError('Product image is required'); return; }

    const form = new FormData();
    form.append('name', name.trim());
    if (sku.trim()) form.append('sku', sku.trim());
    form.append('unitPrice', unitPrice);
    if (file) form.append('image', file);

    setSaving(true);
    try {
      const res = initial
        ? await fetch(`/api/merchant/products/${initial.id}`, { method: 'PATCH', body: form })
        : await fetch('/api/merchant/products', { method: 'POST', body: form });
      if (!res.ok) throw new NavyApiError('save product failed', res.status, await detailOf(res));
      toast(initial ? 'Product updated' : 'Product added', 'success');
      onSaved();
    } catch (err) {
      setError(mapError(err).detail);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: space.md }}>
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Name</Text>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T-shirt (M)" style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>SKU code (optional)</Text>
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. TSHIRT-M" style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>Unit price (USDC)</Text>
        <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="0.00" style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gap: space.xs }}>
        <Text variant="label" muted upper>{initial ? 'Product image (leave empty to keep current)' : 'Product image'}</Text>
        {preview && (
          <img src={preview} alt="preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: radius.md, border: `1px solid ${colors.borderStrong}` }} />
        )}
        <input type="file" accept={ALLOWED_IMAGE_MIMES.join(',')} onChange={onPickFile} style={{ ...inputStyle, padding: '8px 10px' }} />
      </div>
      <div style={{ marginTop: space.sm }}><Button label={initial ? 'Save changes' : 'Add product'} loading={saving} /></div>
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
    </form>
  );
}
