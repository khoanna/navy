// be/src/merchant/merchant-stats.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildDailySeries, SeriesBucket } from '../common/stats.util';

const WINDOW_DAYS = 30;

export interface MerchantStats {
  totalRevenue: string;
  paidCount: number;
  awaitingCount: number;
  expiredCount: number;
  payoutConfigured: boolean;
  series: SeriesBucket[];
}

@Injectable()
export class MerchantStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async forMerchant(merchantId: string, now: Date = new Date()): Promise<MerchantStats> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [agg, paidCount, awaitingCount, expiredCount, paidRows, merchant] = await Promise.all([
      this.prisma.order.aggregate({ _sum: { amount: true }, where: { merchantId, status: 'paid' } }),
      this.prisma.order.count({ where: { merchantId, status: 'paid' } }),
      this.prisma.order.count({ where: { merchantId, status: 'awaiting_payment' } }),
      this.prisma.order.count({ where: { merchantId, status: 'expired' } }),
      this.prisma.order.findMany({
        where: { merchantId, status: 'paid', paidAt: { gte: since } },
        select: { paidAt: true, amount: true },
      }),
      this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { payoutAddress: true } }),
    ]);
    return {
      totalRevenue: (agg._sum.amount ?? 0n).toString(),
      paidCount,
      awaitingCount,
      expiredCount,
      payoutConfigured: !!merchant?.payoutAddress,
      series: buildDailySeries(paidRows, now, WINDOW_DAYS),
    };
  }
}
