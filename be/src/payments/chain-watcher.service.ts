import { ethers } from 'ethers';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from './webhook.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { merchantIdHex, invoiceIdHexFromOrderId } from '../evm/payment-authorization';

export interface SecretLookup { secretForMerchant(merchantId: string): Promise<string | null>; }

@Injectable()
export class ChainWatcherService {
  private readonly logger = new Logger(ChainWatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
    private readonly secrets: SecretLookup,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  async markPaid(orderId: string, info: { payer: string; txHash: string; fee?: bigint }): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    // Atomic guarded write: only a `confirming` order flips → paid, so exactly ONE concurrent caller
    // (submit fast-path vs. sweep) wins and we never resurrect an expired/failed order.
    const claimed = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'confirming' },
      data: { status: 'paid', payer: info.payer, txSignature: info.txHash, paidAt: new Date() },
    });
    if (claimed.count !== 1) return; // another caller already settled — do not fire the webhook
    const updated = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (order.callbackUrl && updated) {
      const secret = await this.secrets.secretForMerchant(order.merchantId);
      if (secret) {
        const fee = info.fee ?? (updated.amount * BigInt(updated.feeBps)) / 10000n;
        await this.webhooks.deliver(orderId, order.callbackUrl, secret, {
          orderId, reference: updated.reference, amount: updated.amount.toString(),
          fee: fee.toString(), payer: info.payer, txSignature: info.txHash,
          status: 'paid', paidAt: updated.paidAt,
        });
      }
    }
  }

  /** Settlement source of truth: settle only if the tx mined successfully AND emitted a matching InvoicePaid. */
  async confirmOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    if (!order.txSignature) return; // submit hasn't recorded a tx hash yet

    const receipt = await this.chain.provider.getTransactionReceipt(order.txSignature);
    if (receipt == null) return; // not yet mined — a later sweep retries
    if (receipt.status !== 1) {
      await this.prisma.order.update({ where: { id: orderId }, data: { status: 'failed' } });
      return;
    }
    const event = this.findInvoicePaid(order.merchantId, order.id, receipt.logs ?? []);
    if (!event) return; // don't settle without the event; a sweep retries
    // Defense in depth: the on-chain paid amount MUST equal what we issued. A mismatch means the
    // event was tampered/misdecoded — never settle; log + skip (leaves the order in `confirming`).
    if (event.amount !== order.amount) {
      this.logger.warn(
        `confirmOrder(${orderId}): InvoicePaid amount ${event.amount} != order amount ${order.amount}; refusing to settle`,
      );
      return;
    }
    await this.markPaid(orderId, { payer: event.payer, txHash: order.txSignature, fee: event.fee });
  }

  /** Decode InvoicePaid logs and return the one matching this order's (merchantId, invoiceId). */
  private findInvoicePaid(
    merchantUuid: string,
    orderId: string,
    logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }>,
  ): { payer: string; amount: bigint; fee: bigint } | null {
    let wantMerchant: string, wantInvoice: string;
    try {
      wantMerchant = merchantIdHex(merchantUuid);
      wantInvoice = invoiceIdHexFromOrderId(orderId);
    } catch {
      return null;
    }
    for (const log of logs) {
      let parsed: ethers.LogDescription | null;
      try {
        parsed = this.chain.payments.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        continue;
      }
      if (!parsed || parsed.name !== 'InvoicePaid') continue;
      const mId = String(parsed.args.merchantId).toLowerCase();
      const iId = String(parsed.args.invoiceId).toLowerCase();
      if (mId !== wantMerchant.toLowerCase() || iId !== wantInvoice.toLowerCase()) continue;
      return {
        payer: String(parsed.args.payer),
        amount: BigInt(parsed.args.amount.toString()),
        fee: BigInt(parsed.args.fee.toString()),
      };
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
