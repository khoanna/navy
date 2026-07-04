import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { EventParser } from '@coral-xyz/anchor';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from './webhook.service';
import { NAVY_ONCHAIN, type NavyOnchain } from '../onchain/onchain.module';
import { orderIdToInvoiceId, invoiceIdToHex } from './invoice-id';

export interface SecretLookup { secretForMerchant(merchantId: string): Promise<string | null>; }

@Injectable()
export class ChainWatcherService {
  private readonly logger = new Logger(ChainWatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
    private readonly secrets: SecretLookup,
    @Inject(NAVY_ONCHAIN) private readonly onchain: NavyOnchain,
  ) {}

  async markPaid(orderId: string, info: { payer: string; signature: string; fee?: bigint }): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'paid', payer: info.payer, txSignature: info.signature, paidAt: new Date() },
    });
    if (order.callbackUrl) {
      const secret = await this.secrets.secretForMerchant(order.merchantId);
      if (secret) {
        // Prefer the reconciled on-chain fee; fall back to the feeBps recompute.
        const fee = info.fee ?? (updated.amount * BigInt(updated.feeBps)) / 10000n;
        await this.webhooks.deliver(orderId, order.callbackUrl, secret, {
          orderId, reference: updated.reference, amount: updated.amount.toString(),
          fee: fee.toString(), payer: info.payer, txSignature: info.signature,
          status: 'paid', paidAt: updated.paidAt,
        });
      }
    }
  }

  /**
   * Reconcile a `confirming` order against the on-chain `InvoicePaid` event
   * before settling it. This is the settlement source of truth: an order only
   * becomes `paid` if its submitted tx confirmed successfully AND emitted a
   * matching InvoicePaid event; a reverted tx becomes `failed` (no webhook).
   */
  async confirmOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    if (!order.txSignature) return; // submit path hasn't recorded a signature yet

    const tx = await this.onchain.connection.getTransaction(order.txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx == null) return; // not yet confirmed — a later sweep retries

    if (tx.meta?.err) {
      // The tx landed but reverted on-chain: fail the order, never settle/webhook.
      await this.prisma.order.update({ where: { id: orderId }, data: { status: 'failed' } });
      return;
    }

    const event = this.findInvoicePaid(order.id, tx.meta?.logMessages ?? []);
    if (!event) return; // don't settle without the event; a sweep retries

    await this.markPaid(orderId, { payer: event.payer, signature: order.txSignature, fee: event.fee });
  }

  /** Parse InvoicePaid events from tx logs and return the one matching this order. */
  private findInvoicePaid(
    orderId: string,
    logs: string[],
  ): { payer: string; amount: bigint; fee: bigint } | null {
    let wantHex: string;
    try {
      wantHex = invoiceIdToHex(orderIdToInvoiceId(orderId));
    } catch {
      return null;
    }
    const parser = new EventParser(this.onchain.program.programId, this.onchain.program.coder);
    let events: Array<{ name: string; data: any }>;
    try {
      events = [...parser.parseLogs(logs)] as Array<{ name: string; data: any }>;
    } catch {
      return null;
    }
    for (const ev of events) {
      if (ev.name.toLowerCase() !== 'invoicepaid') continue;
      const data = ev.data;
      const invoiceId: number[] = Array.from(data.invoiceId ?? data.invoice_id ?? []);
      if (invoiceIdToHex(invoiceId) !== wantHex) continue;
      const payer: string = typeof data.payer?.toBase58 === 'function' ? data.payer.toBase58() : String(data.payer);
      return { payer, amount: BigInt(data.amount.toString()), fee: BigInt(data.fee.toString()) };
    }
    return null;
  }

  @Interval(15000)
  async sweepConfirming(): Promise<void> {
    const pending = await this.prisma.order.findMany({ where: { status: 'confirming' } });
    for (const o of pending) {
      try {
        await this.confirmOrder(o.id);
      } catch (e) {
        this.logger.warn(`sweepConfirming: confirmOrder(${o.id}) failed: ${(e as Error).message}`);
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
