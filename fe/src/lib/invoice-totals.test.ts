import { computeInvoiceTotals } from './invoice-totals';

it('mirrors backend math: subtotal + percent + fixed', () => {
  const r = computeInvoiceTotals(
    [{ unitPrice: 2_000_000n, quantity: 1 }],
    [{ name: 'VAT', mode: 'percent', value: 1000 }, { name: 'Svc', mode: 'fixed', value: 100_000 }],
  );
  expect(r.subtotal).toBe(2_000_000n);
  expect(r.charges.map((c) => c.amount)).toEqual([200_000n, 100_000n]);
  expect(r.total).toBe(2_300_000n);
});
