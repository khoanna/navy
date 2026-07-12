import { colors } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard, Badge, Row } from './MockCard';

/** Beat `treasure` — the farming yield widget (APY, non-custodial). */
export function YieldWidget() {
  const m = PRODUCT_MOCKS.treasure;
  return (
    <MockCard style={{ padding: 20 }}>
      <div style={{ fontSize: 12, color: colors.textDim, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Farming · {m.protocol}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '10px 0 4px' }}>
        <span style={{ fontSize: 40, fontWeight: 700, color: colors.aqua, letterSpacing: '-0.02em' }}>{m.apy}</span>
        <span style={{ fontSize: 13, color: colors.textDim }}>APY</span>
      </div>
      <Row label="Principal" value={m.principal} />
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {m.badges.map((b) => (
          <Badge key={b}>{b}</Badge>
        ))}
      </div>
    </MockCard>
  );
}
