import { colors } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard, Badge } from './MockCard';

/** Beat `port` — a merchant checkout sheet (gasless, 1% fee, Pay). */
export function CheckoutSheet() {
  const m = PRODUCT_MOCKS.port;
  return (
    <MockCard style={{ padding: 20 }}>
      <div style={{ fontSize: 12, color: colors.textDim, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pay merchant</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colors.textHi, margin: '6px 0 14px' }}>{m.merchant}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 40, fontWeight: 700, color: colors.textHi, letterSpacing: '-0.02em' }}>{m.amount}</span>
        <span style={{ fontSize: 15, color: colors.textDim }}>{m.unit}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0 16px' }}>
        {m.badges.map((b) => (
          <Badge key={b}>{b}</Badge>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '12px 0', borderRadius: 12 }}>
        {m.cta}
      </div>
    </MockCard>
  );
}
