import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from './webhook.service';

export interface SecretLookup { secretForMerchant(merchantId: string): Promise<string | null>; }

@Injectable()
export class ChainWatcherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
    private readonly secrets: SecretLookup,
  ) {}

  async markPaid(orderId: string, info: { payer: string; signature: string }): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'paid', payer: info.payer, txSignature: info.signature, paidAt: new Date() },
    });
    if (order.callbackUrl) {
      const secret = await this.secrets.secretForMerchant(order.merchantId);
      if (secret) {
        const fee = (updated.amount * BigInt(updated.feeBps)) / 10000n;
        await this.webhooks.deliver(orderId, order.callbackUrl, secret, {
          orderId, reference: updated.reference, amount: updated.amount.toString(),
          fee: fee.toString(), payer: info.payer, txSignature: info.signature,
          status: 'paid', paidAt: updated.paidAt,
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStale(): Promise<void> {
    const stale = await this.prisma.order.findMany({
      where: { status: 'awaiting_payment', expiresAt: { lt: new Date() } },
    });
    for (const o of stale) {
      await this.prisma.order.update({ where: { id: o.id }, data: { status: 'expired' } });
    }
  }
}
