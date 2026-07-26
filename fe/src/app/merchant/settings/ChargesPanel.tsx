'use client';
import { useEffect, useState } from 'react';
import { usdcInputToBaseUnits } from '@/lib/money';
import { formatUsdc } from '@/lib/dashboard/stats';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { useToast } from '@/ui/Toast';
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';
import { colors, space, radius } from '@/ui/theme';

async function detailOf(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (typeof b.message === 'string') return b.message;
  }
  return undefined;
}

interface Charge {
  id: string;
  name: string;
  mode: 'percent' | 'fixed';
  value: number;
  active: boolean;
  sortOrder: number;
}

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md,
  color: colors.text,
  padding: '10px 12px',
  outline: 'none',
};

function describe(c: Charge) {
  return c.mode === 'percent'
    ? `${(c.value / 100).toFixed(2)}%`
    : `${formatUsdc(String(c.value))} USDC`;
}

export function ChargesPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<Charge[]>([]);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent');
  const [val, setVal] = useState('');
  const [error, setError] = useState('');

  const reload = async () => {
    const r = await fetch('/api/merchant/charges');
    if (r.ok) setRows(await r.json());
  };
  useEffect(() => { reload(); }, []);

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    let value: number;
    if (mode === 'percent') {
      const pct = Number(val);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setError('Enter a percentage between 0 and 100');
        return;
      }
      value = Math.round(pct * 100);
    } else {
      try {
        value = Number(usdcInputToBaseUnits(val));
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    if (!name.trim()) { setError('Name is required'); return; }
    try {
      const res = await fetch('/api/merchant/charges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), mode, value }),
      });
      if (!res.ok) throw new NavyApiError('add charge failed', res.status, await detailOf(res));
      setName(''); setVal(''); toast('Charge added', 'success'); reload();
    } catch (err) {
      setError(mapError(err).detail);
    }
  }

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/merchant/charges/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new NavyApiError('remove charge failed', res.status, await detailOf(res));
      toast('Charge removed', 'success'); reload();
    } catch (err) {
      toast(mapError(err).detail, 'error');
    }
  };

  return (
    <div>
      <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.xs }}>
        Taxes &amp; fees
      </Text>
      <Text variant="caption" dim style={{ display: 'block', marginBottom: space.md }}>
        Applied automatically to every invoice&apos;s subtotal.
      </Text>
      <div style={{ display: 'grid', gap: space.sm, marginBottom: space.lg }}>
        {rows.length === 0 && (
          <Text variant="caption" dim>No charges configured.</Text>
        )}
        {rows.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${space.sm}px ${space.md}px`,
              border: `1px solid ${colors.border}`,
              borderRadius: radius.md,
            }}
          >
            <Text variant="bodyStrong" color={colors.textHi}>{c.name}</Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
              <Text variant="body" numeric>{describe(c)}</Text>
              <Button label="Remove" variant="danger" full={false} onPress={() => remove(c.id)} />
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={add}
        style={{ display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. VAT)"
          style={inputStyle}
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'percent' | 'fixed')}
          style={inputStyle}
        >
          <option value="percent">Percent (%)</option>
          <option value="fixed">Fixed (USDC)</option>
        </select>
        <input
          value={val}
          inputMode="decimal"
          onChange={(e) => setVal(e.target.value)}
          placeholder={mode === 'percent' ? '10' : '1.00'}
          style={{ ...inputStyle, width: 120 }}
        />
        <Button label="Add" full={false} />
      </form>
      {error && (
        <Text variant="caption" color={colors.danger} style={{ display: 'block', marginTop: space.sm }}>
          {error}
        </Text>
      )}
    </div>
  );
}
