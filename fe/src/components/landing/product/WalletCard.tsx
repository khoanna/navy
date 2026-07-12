import { colors, gradients } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard } from './MockCard';

/** Beat `sail` — the wallet hero balance card (Send / Scan / Farm). */
export function WalletCard() {
  const m = PRODUCT_MOCKS.sail;
  return (
    <MockCard>
      <div style={{ background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, padding: 20, color: colors.onAccent }}>
        <div style={{ fontSize: 12, opacity: 0.8, letterSpacing: '0.04em' }}>Total balance</div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em', margin: '4px 0 2px' }}>{m.balance}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>{m.unit}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 16 }}>
        {m.actions.map((a) => (
          <div key={a} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: colors.textHi, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '10px 0', borderRadius: 12 }}>
            {a}
          </div>
        ))}
      </div>
    </MockCard>
  );
}
