import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { orderIdToInvoiceId, invoiceIdToHex } from './invoice-id';
import { computeInvoiceTotals } from './invoice-totals';
import { generateOrderReference } from './order-reference';
import { MerchantChargesService } from '../merchant/merchant-charges.service';

export interface OrderLineInput { productId: string; quantity: number; }
export interface CreateOrderInput { items: OrderLineInput[]; description?: string; callbackUrl?: string; expiresInSec?: number; }

/** On-chain pay_invoice enforces amount >= 10_000 base units; reject smaller orders up front. */
export const MIN_INVOICE_AMOUNT = 10_000n;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payBaseUrl: string,
    private readonly feeBps: number,
    private readonly charges: MerchantChargesService,
  ) {}

  async create(merchantId: string, input: CreateOrderInput) {
    if (!input.items || input.items.length === 0) throw new BadRequestException('An invoice needs at least one item');
    for (const it of input.items) {
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new BadRequestException('quantity must be a positive integer');
    }

    const ids = [...new Set(input.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, merchantId, active: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new BadRequestException(`Unknown or inactive product(s): ${missing.join(', ')}`);

    const lineSnapshots = input.items.map((i) => {
      const p = byId.get(i.productId)!;
      return { productId: p.id, name: p.name, unitPrice: p.unitPrice as bigint, quantity: i.quantity };
    });

    const chargeRows = await this.charges.activeForMerchant(merchantId);
    const totals = computeInvoiceTotals(
      lineSnapshots.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
      chargeRows.map((c) => ({ name: c.name, mode: c.mode as 'percent' | 'fixed', value: c.value })),
    );

    if (totals.total < MIN_INVOICE_AMOUNT) {
      throw new BadRequestException(`Invoice total must be at least ${MIN_INVOICE_AMOUNT} base units`);
    }

    const id = randomUUID();
    const onchainInvoiceId = invoiceIdToHex(orderIdToInvoiceId(id));
    const expiresAt = new Date(Date.now() + (input.expiresInSec ?? 900) * 1000);
    const reference = generateOrderReference();

    const order = await this.prisma.order.create({
      data: {
        id, merchantId, reference, amount: totals.total, subtotal: totals.subtotal,
        description: input.description ?? null, feeBps: this.feeBps, status: 'awaiting_payment',
        onchainInvoiceId, callbackUrl: input.callbackUrl ?? null, expiresAt,
        items: { create: lineSnapshots },
        charges: { create: totals.charges.map((c) => ({ name: c.name, mode: c.mode, value: c.value, amount: c.amount })) },
      },
    });

    await this.audit.record({ actor: `merchant:${merchantId}`, action: 'order.create', target: id });
    const payUrl = `${this.payBaseUrl}/${order.id}`;
    const qr = await QRCode.toDataURL(payUrl);
    return { orderId: order.id, reference, payUrl, qr, subtotal: totals.subtotal.toString(), amount: order.amount.toString(), expiresAt, status: order.status };
  }

  get(id: string) { return this.prisma.order.findUnique({ where: { id }, include: { items: true, charges: true } }); }

  private serialize(o: any) {
    return {
      id: o.id, reference: o.reference, amount: o.amount.toString(),
      subtotal: o.subtotal != null ? o.subtotal.toString() : null,
      description: o.description ?? null, status: o.status,
      createdAt: o.createdAt, paidAt: o.paidAt ?? null, payer: o.payer ?? null, txSignature: o.txSignature ?? null,
      items: (o.items ?? []).map((it: any) => ({ name: it.name, unitPrice: it.unitPrice.toString(), quantity: it.quantity })),
      charges: (o.charges ?? []).map((c: any) => ({ name: c.name, mode: c.mode, value: c.value, amount: c.amount.toString() })),
    };
  }

  async createForMerchant(merchantId: string, input: CreateOrderInput) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant || merchant.approvalStatus !== 'approved') {
      throw new ConflictException('Merchant is not approved');
    }
    return this.create(merchantId, input);
  }

  async listForMerchant(merchantId: string, opts: { status?: string; take: number; skip: number }) {
    const where: any = { merchantId };
    if (opts.status && opts.status !== 'all') where.status = opts.status;
    const rows = await this.prisma.order.findMany({ where, take: opts.take, skip: opts.skip, orderBy: { createdAt: 'desc' } });
    return rows.map((o) => this.serialize(o));
  }

  async getForMerchant(merchantId: string, id: string) {
    const o = await this.prisma.order.findFirst({ where: { id, merchantId }, include: { items: true, charges: true } });
    if (!o) throw new NotFoundException('Order not found');
    return this.serialize(o);
  }

  async listForPayer(payer: string, opts: { take: number; skip: number }) {
    const rows = await this.prisma.order.findMany({
      where: { payer, status: 'paid' },
      orderBy: { paidAt: 'desc' }, take: opts.take, skip: opts.skip,
      include: { merchant: { select: { businessName: true } } },
    });
    return rows.map((o: any) => ({
      orderId: o.id, reference: o.reference, amount: o.amount.toString(), status: o.status,
      paidAt: o.paidAt, txSignature: o.txSignature ?? null, merchant: o.merchant?.businessName ?? null,
    }));
  }
}
