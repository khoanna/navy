import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { orderIdToInvoiceId, invoiceIdToHex } from './invoice-id';

export interface CreateOrderInput { amount: bigint; reference: string; callbackUrl?: string; expiresInSec?: number; }

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payBaseUrl: string,
    private readonly feeBps: number,
  ) {}

  async create(merchantId: string, input: CreateOrderInput) {
    if (!input.amount || input.amount <= 0n) throw new BadRequestException('amount must be > 0');
    const id = randomUUID();
    const onchainInvoiceId = invoiceIdToHex(orderIdToInvoiceId(id));
    const expiresAt = new Date(Date.now() + (input.expiresInSec ?? 900) * 1000);
    const order = await this.prisma.order.create({
      data: {
        id, merchantId, reference: input.reference, amount: input.amount, feeBps: this.feeBps,
        status: 'awaiting_payment', onchainInvoiceId, callbackUrl: input.callbackUrl ?? null, expiresAt,
      },
    });
    await this.audit.record({ actor: `merchant:${merchantId}`, action: 'order.create', target: id });
    const payUrl = `${this.payBaseUrl}/${order.id}`;
    const qr = await QRCode.toDataURL(payUrl);
    return { orderId: order.id, payUrl, qr, amount: order.amount.toString(), expiresAt, status: order.status };
  }

  get(id: string) { return this.prisma.order.findUnique({ where: { id } }); }

  private serialize(o: any) {
    return {
      id: o.id, reference: o.reference, amount: o.amount.toString(), status: o.status,
      createdAt: o.createdAt, paidAt: o.paidAt ?? null, payer: o.payer ?? null, txSignature: o.txSignature ?? null,
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
    const o = await this.prisma.order.findFirst({ where: { id, merchantId } });
    if (!o) throw new NotFoundException('Order not found');
    return this.serialize(o);
  }
}
