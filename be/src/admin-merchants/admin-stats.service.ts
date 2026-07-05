// be/src/admin-merchants/admin-stats.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildDailySeries, SeriesBucket } from '../common/stats.util';

const WINDOW_DAYS = 30;

export interface AdminStats {
  merchantsTotal: number;
  pending: number;
  approved: number;
  rejected: number;
  onchainRegistered: number;
  ordersTotal: number;
  volumeTotal: string;
  series: SeriesBucket[];
  recentPending: { id: string; businessName: string; email?: string; createdAt: Date }[];
  recentPayments: { id: string; reference: string; amount: string; status: string; paidAt: Date | null; payer: string | null }[];
}

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async platform(now: Date = new Date()): Promise<AdminStats> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [
      merchantsTotal, pending, approved, rejected, onchainRegistered,
      ordersTotal, agg, seriesRows, recentPending, recentPayments,
    ] = await Promise.all([
      this.prisma.merchant.count(),
      this.prisma.merchant.count({ where: { approvalStatus: 'pending' } }),
      this.prisma.merchant.count({ where: { approvalStatus: 'approved' } }),
      this.prisma.merchant.count({ where: { approvalStatus: 'rejected' } }),
      this.prisma.merchant.count({ where: { onchainRegisteredAt: { not: null } } }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({ _sum: { amount: true }, where: { status: 'paid' } }),
      this.prisma.order.findMany({ where: { status: 'paid', paidAt: { gte: since } }, select: { paidAt: true, amount: true } }),
      this.prisma.merchant.findMany({ where: { approvalStatus: 'pending' }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, businessName: true, email: true, createdAt: true } }),
      this.prisma.order.findMany({ where: { status: 'paid' }, orderBy: { paidAt: 'desc' }, take: 6, select: { id: true, reference: true, amount: true, status: true, paidAt: true, payer: true } }),
    ]);
    return {
      merchantsTotal, pending, approved, rejected, onchainRegistered, ordersTotal,
      volumeTotal: (agg._sum.amount ?? 0n).toString(),
      series: buildDailySeries(seriesRows, now, WINDOW_DAYS),
      recentPending: recentPending.map((m) => ({ id: m.id, businessName: m.businessName, email: m.email, createdAt: m.createdAt })),
      recentPayments: recentPayments.map((o) => ({
        id: o.id, reference: o.reference, amount: o.amount.toString(), status: o.status, paidAt: o.paidAt ?? null, payer: o.payer ?? null,
      })),
    };
  }
}
