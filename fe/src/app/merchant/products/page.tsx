'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { DataTable, Column } from '@/ui/DataTable';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { Modal } from '@/ui/Modal';
import { colors, space } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import { formatUsdc } from '@/lib/dashboard/stats';
import { ProductForm, ProductRow } from './ProductForm';

export default function Products() {
  const router = useRouter();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    const res = await fetch('/api/merchant/products');
    if (res.ok) setRows(await res.json());
  };
  useEffect(() => { reload(); }, []);

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/merchant/login'); };
  const archive = async (id: string) => { await fetch(`/api/merchant/products/${id}`, { method: 'DELETE' }); reload(); };
  const closeAndReload = () => { setCreating(false); setEditing(null); reload(); };

  const cols: Column<ProductRow>[] = [
    { key: 'name', header: 'Name', render: (p) => <Text variant="bodyStrong" color={colors.textHi}>{p.name}</Text> },
    { key: 'sku', header: 'SKU', render: (p) => <Text variant="body" dim>{p.sku ?? '—'}</Text> },
    { key: 'price', header: 'Unit price', align: 'right', render: (p) => <Text variant="body" numeric>{formatUsdc(p.unitPrice)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (p) => <Pill label={p.active ? 'Active' : 'Archived'} tone={p.active ? 'success' : 'neutral'} /> },
    { key: 'act', header: '', align: 'right', render: (p) => (
      <div style={{ display: 'flex', gap: space.sm, justifyContent: 'flex-end' }}>
        <Button label="Edit" variant="ghost" full={false} onPress={() => setEditing(p)} />
        {p.active && <Button label="Archive" variant="danger" full={false} onPress={() => archive(p.id)} />}
      </div>
    ) },
  ];

  return (
    <AppShell items={MERCHANT_NAV} identity={{ title: 'Merchant', subtitle: 'Dashboard' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title="Products" right={<div style={{ minWidth: 160 }}><Button label="Add product" icon="plus" full onPress={() => setCreating(true)} /></div>} />
      <DataTable columns={cols} rows={rows} empty="No products yet — add one to start invoicing." />
      <Modal open={creating} title="Add product" onClose={() => setCreating(false)}>
        <ProductForm onSaved={closeAndReload} />
      </Modal>
      <Modal open={!!editing} title="Edit product" onClose={() => setEditing(null)}>
        {editing && <ProductForm initial={editing} onSaved={closeAndReload} />}
      </Modal>
    </AppShell>
  );
}
