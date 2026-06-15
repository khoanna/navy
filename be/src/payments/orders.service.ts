import { BadRequestException, Injectable } from '@nestjs/common';
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
    const payUrl = `${this.payBaseUrl}/${id}`;
    const qr = await QRCode.toDataURL(payUrl);
    return { orderId: id, payUrl, qr, amount: order.amount.toString(), expiresAt, status: order.status };
  }

  get(id: string) { return this.prisma.order.findUnique({ where: { id } }); }
}
