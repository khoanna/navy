import { colors } from '@/ui/theme';
import { PRODUCT_MOCKS } from '@/lib/landing/copy';
import { MockCard, Row } from './MockCard';

/** Beat `sea` — the on-chain settlement proof (InvoicePaid event). */
export function SettlementReceipt() {
  const m = PRODUCT_MOCKS.sea;
  return (
    <MockCard style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.textHi }}>{m.event}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.success }}>✓ {m.status}</span>
      </div>
      <div style={{ fontSize: 12, color: colors.textDim, margin: '4px 0 6px', fontFamily: 'ui-monospace, monospace' }}>sig {m.sig}</div>
      {m.rows.map(([label, value]) => (
        <Row key={label} label={label} value={value} />
      ))}
    </MockCard>
  );
}
