// be/src/merchant/merchant-stats.service.spec.ts
import { MerchantStatsService } from './merchant-stats.service';

function deps() {
  const prisma = {
    order: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1500n } }),
      count: jest
        .fn()
        .mockResolvedValueOnce(3) // paid
        .mockResolvedValueOnce(2) // awaiting_payment
        .mockResolvedValueOnce(1), // expired
      findMany: jest.fn().mockResolvedValue([
        { paidAt: new Date('2026-07-05T10:00:00Z'), amount: 1500n },
      ]),
    },
    merchant: { findUnique: jest.fn().mockResolvedValue({ payoutAddress: '0x1111111111111111111111111111111111111111' }) },
  } as any;
  return { svc: new MerchantStatsService(prisma), prisma };
}

describe('MerchantStatsService', () => {
  it('scopes every query to the merchant and returns string money + counts + 30-pt series', async () => {
    const { svc, prisma } = deps();
    const now = new Date('2026-07-05T12:00:00Z');
    const out = await svc.forMerchant('m1', now);

    expect(out.totalRevenue).toBe('1500');
    expect(out.paidCount).toBe(3);
    expect(out.awaitingCount).toBe(2);
    expect(out.expiredCount).toBe(1);
    expect(out.payoutConfigured).toBe(true);
    expect(out.series).toHaveLength(30);
    expect(out.series[29]).toEqual({ date: '2026-07-05', amount: '1500' });

    // aggregate scoped to this merchant + paid only
    expect(prisma.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: 'm1', status: 'paid' } }),
    );
    // findMany scoped to merchant + paid
    expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({ merchantId: 'm1', status: 'paid' });
  });

  it('treats a null aggregate sum as 0', async () => {
    const { svc, prisma } = deps();
    prisma.order.aggregate.mockResolvedValue({ _sum: { amount: null } });
    const out = await svc.forMerchant('m1', new Date('2026-07-05T12:00:00Z'));
    expect(out.totalRevenue).toBe('0');
  });
});
