import { spendingSeries } from './analytics';

describe('spendingSeries', () => {
  const orders = [
    { amount: '1000000', createdAt: new Date('2026-07-20T10:00:00Z'), status: 'paid' },
    { amount: '2000000', createdAt: new Date('2026-07-20T14:00:00Z'), status: 'paid' },
    { amount: '5000000', createdAt: new Date('2026-07-21T09:00:00Z'), status: 'paid' },
    { amount: '9000000', createdAt: new Date('2026-07-21T09:00:00Z'), status: 'awaiting_payment' },
  ];
  it('buckets paid orders per day and sums base units', () => {
    const s = spendingSeries(orders as any, 'day');
    expect(s.labels).toEqual(['2026-07-20', '2026-07-21']);
    expect(s.values).toEqual(['3000000', '5000000']);
    expect(s.totalBase).toBe('8000000');
    expect(s.count).toBe(3);
  });
});
