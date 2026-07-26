// be/src/admin-merchants/admin-stats.service.spec.ts
import { AdminStatsService } from '../../../src/admin-merchants/admin-stats.service';

function deps() {
  const prisma = {
    merchant: {
      count: jest
        .fn()
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(5) // approved
        .mockResolvedValueOnce(2) // rejected
        .mockResolvedValueOnce(4), // onchainRegistered
      findMany: jest.fn().mockResolvedValue([{ id: 'm1', businessName: 'Acme', approvalStatus: 'pending', createdAt: new Date() }]),
    },
    order: {
      count: jest.fn().mockResolvedValue(42),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 999n } }),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ paidAt: new Date('2026-07-05T10:00:00Z'), amount: 999n }]) // series rows
        .mockResolvedValueOnce([{ id: 'o1', reference: 'r1', amount: 999n, status: 'paid', paidAt: new Date(), payer: 'PK' }]), // recent paid
    },
  } as any;
  return { svc: new AdminStatsService(prisma), prisma };
}

describe('AdminStatsService', () => {
  it('aggregates platform totals with string money and a 30-pt series', async () => {
    const { svc } = deps();
    const out = await svc.platform(new Date('2026-07-05T12:00:00Z'));
    expect(out.merchantsTotal).toBe(10);
    expect(out.pending).toBe(3);
    expect(out.approved).toBe(5);
    expect(out.rejected).toBe(2);
    expect(out.onchainRegistered).toBe(4);
    expect(out.ordersTotal).toBe(42);
    expect(out.volumeTotal).toBe('999');
    expect(out.series).toHaveLength(30);
    expect(out.recentPending[0].businessName).toBe('Acme');
    expect(out.recentPayments[0].amount).toBe('999'); // stringified
  });
});
