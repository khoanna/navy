import { computeInvoiceTotals } from './invoice-totals';

describe('computeInvoiceTotals', () => {
  it('sums line items into subtotal', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 1_000_000n, quantity: 2 }, { unitPrice: 500_000n, quantity: 1 }],
      [],
    );
    expect(r.subtotal).toBe(2_500_000n);
    expect(r.total).toBe(2_500_000n);
    expect(r.charges).toEqual([]);
  });

  it('applies a percent charge on the subtotal (floored)', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 1_000_001n, quantity: 1 }],
      [{ name: 'VAT', mode: 'percent', value: 1000 }],
    );
    expect(r.charges[0].amount).toBe(100_000n);
    expect(r.total).toBe(1_100_001n);
  });

  it('applies a fixed charge as a flat base-unit amount', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 1_000_000n, quantity: 1 }],
      [{ name: 'Service', mode: 'fixed', value: 250_000 }],
    );
    expect(r.charges[0].amount).toBe(250_000n);
    expect(r.total).toBe(1_250_000n);
  });

  it('applies multiple charges independently on the subtotal', () => {
    const r = computeInvoiceTotals(
      [{ unitPrice: 2_000_000n, quantity: 1 }],
      [{ name: 'VAT', mode: 'percent', value: 1000 }, { name: 'Svc', mode: 'fixed', value: 100_000 }],
    );
    expect(r.total).toBe(2_000_000n + 200_000n + 100_000n);
  });
});
