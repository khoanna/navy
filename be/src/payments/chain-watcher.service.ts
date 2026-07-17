import { ethers } from 'ethers';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from './webhook.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { merchantIdHex, invoiceIdHexFromOrderId, invoiceKey } from '../evm/payment-authorization';

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
    // Never expire an order whose issued authorization was already consumed (submitted): it may be
    // mid-flight on-chain (or crashed after broadcast). Expiring it would drop a real payment with
    // no webhook. `sweepConfirming`/`confirmOrder` own the terminal state of a submitted order.
    const stale = await this.prisma.order.findMany({
      where: { status: 'awaiting_payment', expiresAt: { lt: new Date() }, issuedTxConsumedAt: null },
    });
    for (const o of stale) {
      await this.prisma.order.update({ where: { id: o.id }, data: { status: 'expired' } });
    }
  }

  /**
   * Recover the crash-window "consumed-but-unrecorded" orders (settlement gap).
   *
   * `RelayerService.verifyAndSubmit` consumes the single-use nonce (sets `issuedTxConsumedAt`) and
   * broadcasts `payInvoice` BEFORE it persists `{status:'confirming', txSignature}`. A crash in that
   * window strands the order at `awaiting_payment` with `issuedTxConsumedAt != null` and
   * `txSignature = null` — invisible to `sweepConfirming` (scans `confirming`) and skipped by
   * `expireStale` (skips consumed nonces). If the broadcast actually landed, funds moved with NO
   * settlement/webhook. This sweep is the sole recovery path for those orders.
   *
   * For each stranded order we read the authoritative on-chain guard `invoicePaid(key)`:
   *   - TRUE  → the payment landed. Find the InvoicePaid event to reconstruct payer/amount/fee + the
   *             tx hash, record `txSignature`, move the order to `confirming`, then `confirmOrder`
   *             settles it (fires the webhook).
   *   - FALSE + expired → no funds moved; clear the consumed nonce so the order can be re-authorized
   *             (or later expired by `expireStale` once the nonce is un-consumed).
   */
  @Interval(45000)
  async recoverConsumedOrders(): Promise<void> {
    const stranded = await this.prisma.order.findMany({
      where: { status: 'awaiting_payment', issuedTxConsumedAt: { not: null }, txSignature: null },
    });
    for (const o of stranded) {
      try {
        await this.recoverConsumedOrder(o);
      } catch (e) {
        this.logger.warn(`recoverConsumedOrders: recover(${o.id}) failed: ${(e as Error).message}`);
      }
    }
  }

  private async recoverConsumedOrder(order: {
    id: string;
    merchantId: string;
    issuedTxExpiresAt: Date | null;
    expiresAt: Date;
  }): Promise<void> {
    let key: string;
    try {
      key = invoiceKey(merchantIdHex(order.merchantId), invoiceIdHexFromOrderId(order.id));
    } catch (e) {
      this.logger.warn(`recoverConsumedOrder(${order.id}): bad invoice key: ${(e as Error).message}`);
      return;
    }

    const paid: boolean = await this.chain.payments.invoicePaid(key);
    if (paid) {
      // The payment landed on-chain but we never recorded it. Reconstruct the settlement from the
      // InvoicePaid event so `confirmOrder` can verify the receipt + amount and settle/webhook.
      const found = await this.findPaidEvent(order.merchantId, order.id);
      if (!found) {
        // invoicePaid() says paid but we can't locate the event/tx yet (log range, RPC lag). Leave
        // the order stranded and retry next tick — do NOT settle without the on-chain proof.
        this.logger.warn(
          `recoverConsumedOrder(${order.id}): invoicePaid=true but no InvoicePaid event located yet; will retry`,
        );
        return;
      }
      // Guarded transition: only flip a still-stranded row (status unchanged, txSignature still null)
      // so we never race sweepConfirming or resurrect a row another sweep already advanced.
      const claimed = await this.prisma.order.updateMany({
        where: { id: order.id, status: 'awaiting_payment', txSignature: null },
        data: { status: 'confirming', txSignature: found.txHash },
      });
      this.logger.warn(
        `recoverConsumedOrder(${order.id}): recovered crash-window payment tx=${found.txHash}; settling`,
      );
      if (claimed.count === 1) await this.confirmOrder(order.id);
      return;
    }

    // Not paid on-chain: no funds moved. If the issued authorization window has passed, un-consume the
    // nonce so the order returns to a clean re-payable state (expireStale will terminate it if stale).
    const deadline = order.issuedTxExpiresAt ?? order.expiresAt;
    if (deadline < new Date()) {
      await this.prisma.order.updateMany({
        where: { id: order.id, status: 'awaiting_payment', txSignature: null },
        data: { issuedTxConsumedAt: null, issuedTxHash: null },
      });
      this.logger.warn(
        `recoverConsumedOrder(${order.id}): invoicePaid=false + expired; reset consumed nonce (no funds moved)`,
      );
    }
  }

  /** Locate the InvoicePaid event for this order via a topic-filtered log query; returns payer/amount/fee + tx hash. */
  private async findPaidEvent(
    merchantUuid: string,
    orderId: string,
  ): Promise<{ payer: string; amount: bigint; fee: bigint; txHash: string } | null> {
    let wantMerchant: string, wantInvoice: string;
    try {
      wantMerchant = merchantIdHex(merchantUuid);
      wantInvoice = invoiceIdHexFromOrderId(orderId);
    } catch {
      return null;
    }
    // merchantId + invoiceId are indexed → an exact topic filter. Scan a bounded recent window so a
    // busy chain doesn't force a full-history query on every tick.
    const filter = this.chain.payments.filters.InvoicePaid(wantMerchant, wantInvoice);
    const latest = await this.chain.provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 50_000);
    const events = await this.chain.payments.queryFilter(filter, fromBlock, latest);
    const ev = events[events.length - 1] as ethers.EventLog | undefined;
    if (!ev || !('args' in ev) || !ev.args) return null;
    return {
      payer: String(ev.args.payer),
      amount: BigInt(ev.args.amount.toString()),
      fee: BigInt(ev.args.fee.toString()),
      txHash: ev.transactionHash,
    };
  }
}
