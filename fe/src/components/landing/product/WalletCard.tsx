import { colors, gradients } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard } from './MockCard';

/** Tiny inline sparkline — a normalized polyline, no chart lib. */
function Sparkline({ data, color }: { data: readonly number[]; color: string }) {
  const w = 88;
  const h = 26;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
    </svg>
  );
}

/** Beat `sail` — the wallet hero: an ocean-gradient balance header with a wallet
 *  identity, network chip, today's change + a sparkline, quick actions, and a
 *  compact recent-activity list, so it reads as a real wallet, not a placeholder. */
export function WalletCard() {
  const m = PRODUCT_MOCKS.sail;
  return (
    <MockCard>
      {/* Balance header on the ocean gradient (dark on-accent text). */}
      <div style={{ position: 'relative', background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, padding: 18, color: colors.onAccent, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 80% at 85% -10%, rgba(255,255,255,0.35), transparent 60%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: 999, background: 'rgba(4,17,31,0.55)', border: '1px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>N</div>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{m.wallet}</span>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, background: 'rgba(4,17,31,0.32)', border: '1px solid rgba(4,17,31,0.22)' }}>{m.network}</span>
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.8, letterSpacing: '0.04em' }}>Total balance</div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', margin: '2px 0', fontVariantNumeric: 'tabular-nums' }}>{m.balance}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9 }}>{m.change}</div>
          </div>
          <Sparkline data={m.spark} color={colors.onAccent} />
        </div>
      </div>

      {/* Quick actions. */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 16px 10px' }}>
        {m.actions.map((a) => (
          <div key={a} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: colors.textHi, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '10px 0', borderRadius: 12 }}>
            {a}
          </div>
        ))}
      </div>

      {/* Recent activity. */}
      <div style={{ padding: '2px 16px 16px' }}>
        {m.activity.map((t, i) => (
          <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }}>
            <div style={{ width: 30, height: 30, flex: 'none', borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: colors.aqua, background: colors.glassFill, border: `1px solid ${colors.borderStrong}` }}>{t.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.textHi }}>{t.label}</div>
              <div style={{ fontSize: 11.5, color: colors.textDim }}>{t.sub}</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.success, fontVariantNumeric: 'tabular-nums' }}>{t.amount}</div>
          </div>
        ))}
      </div>
    </MockCard>
  );
}
