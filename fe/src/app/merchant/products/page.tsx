'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { DataTable, Column } from '@/ui/DataTable';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { Modal } from '@/ui/Modal';
import { ErrorState } from '@/ui/ErrorState';
import { SkeletonList } from '@/ui/SkeletonList';
import { useToast } from '@/ui/Toast';
import { colors, space } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import { formatUsdc } from '@/lib/dashboard/stats';
import { ProductForm, ProductRow } from './ProductForm';
import { useAsync } from '@/lib/useAsync';
import { NavyApiError } from '@/lib/navyApi';
import { detailOf } from '@/lib/httpError';
import { mapError } from '@/lib/mapError';

export default function Products() {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<ProductRow | null>(null);
  const [archiving, setArchiving] = useState(false);

  const { data: rows, loading, error, staleError, retry, setData } = useAsync<ProductRow[]>(async () => {
    const res = await fetch('/api/merchant/products');
    if (res.status === 401) { router.replace('/merchant/login'); throw new NavyApiError('unauthorized', 401); }
    if (!res.ok) throw new NavyApiError('products failed', res.status, await detailOf(res));
    return res.json();
  });

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/merchant/login'); };

  const doArchive = async () => {
    const p = confirmArchive;
    if (!p) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/merchant/products/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new NavyApiError('archive failed', res.status, await detailOf(res));
      setData((prev) => (prev ?? []).map((r) => (r.id === p.id ? { ...r, active: false } : r)));
      toast('Product archived', 'success');
      setConfirmArchive(null);
    } catch (e) {
      toast(mapError(e).detail, 'error');
    } finally {
      setArchiving(false);
    }
  };

  const closeAndReload = () => { setCreating(false); setEditing(null); retry(); };

  const cols: Column<ProductRow>[] = [
    { key: 'img', header: '', render: (p) => (
      p.imageUrl
        ? <img src={p.imageUrl} alt={p.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.borderStrong}` }} />
        : <div style={{ width: 40, height: 40, borderRadius: 8, background: colors.bgElevated, border: `1px solid ${colors.borderStrong}` }} aria-hidden />
    ) },
    { key: 'name', header: 'Name', render: (p) => <Text variant="bodyStrong" color={colors.textHi}>{p.name}</Text> },
    { key: 'sku', header: 'SKU', render: (p) => <Text variant="body" dim>{p.sku ?? '—'}</Text> },
    { key: 'price', header: 'Unit price', align: 'right', render: (p) => <Text variant="body" numeric>{formatUsdc(p.unitPrice)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (p) => <Pill label={p.active ? 'Active' : 'Archived'} tone={p.active ? 'success' : 'neutral'} /> },
    { key: 'act', header: '', align: 'right', render: (p) => (
      <div style={{ display: 'flex', gap: space.sm, justifyContent: 'flex-end' }}>
        <Button label="Edit" variant="ghost" full={false} onPress={() => setEditing(p)} />
        {p.active && <Button label="Archive" variant="danger" full={false} onPress={() => setConfirmArchive(p)} />}
      </div>
    ) },
  ];

  return (
    <AppShell items={MERCHANT_NAV} identity={{ title: 'Merchant', subtitle: 'Dashboard' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title="Products" right={<div style={{ minWidth: 160 }}><Button label="Add product" icon="plus" full onPress={() => setCreating(true)} /></div>} />
      {loading && !rows ? (
        <SkeletonList rows={5} height={56} />
      ) : error && !rows ? (
        <ErrorState error={error} onRetry={retry} />
      ) : (
        <>
          {staleError && (
            <button onClick={retry} style={{ marginBottom: space.md, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <Text variant="caption" color={colors.warning}>Couldn’t refresh · Retry</Text>
            </button>
          )}
          <DataTable columns={cols} rows={rows ?? []} empty="No products yet — add one to start invoicing." />
        </>
      )}
      <Modal open={creating} title="Add product" onClose={() => setCreating(false)}>
        <ProductForm onSaved={closeAndReload} />
      </Modal>
      <Modal open={!!editing} title="Edit product" onClose={() => setEditing(null)}>
        {editing && <ProductForm initial={editing} onSaved={closeAndReload} />}
      </Modal>
      <Modal open={!!confirmArchive} title="Archive product" subtitle={confirmArchive ? `“${confirmArchive.name}” will no longer be available for new invoices.` : undefined} onClose={() => setConfirmArchive(null)}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space.md }}>
          <div style={{ minWidth: 120 }}><Button label="Cancel" variant="ghost" onPress={() => setConfirmArchive(null)} /></div>
          <div style={{ minWidth: 120 }}><Button label="Archive" variant="danger" loading={archiving} onPress={doArchive} /></div>
        </div>
      </Modal>
    </AppShell>
  );
}
