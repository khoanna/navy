import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { OrdersService } from './orders.service';
import { RelayerService } from './relayer.service';
import { ChainWatcherService } from './chain-watcher.service';
import { OrderAuthGuard } from './order-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

class CreateOrderDto { amount!: string; reference!: string; callbackUrl?: string; expiresInSec?: number; }
class SubmitDto { signedTx!: string; }

@Controller('v1/orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly relayer: RelayerService,
    private readonly watcher: ChainWatcherService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseGuards(OrderAuthGuard)
  async create(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.orders.create(req.merchantId, {
      amount: BigInt(dto.amount), reference: dto.reference,
      callbackUrl: dto.callbackUrl, expiresInSec: dto.expiresInSec,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const o = await this.orders.get(id);
    return o && { orderId: o.id, status: o.status, amount: o.amount.toString(), reference: o.reference, paidAt: o.paidAt };
  }

  @Get(':id/payment-tx')
  async paymentTx(@Param('id') id: string, @Req() req: any) {
    const order = await this.orders.get(id);
    if (!order) return { error: 'not found' };
    const payer = new PublicKey(req.query.payer);
    const merchant = await this.prisma.merchant.findUnique({ where: { id: order.merchantId } });
    const merchantAuthority = new PublicKey(merchant!.payoutAddress!);
    const tx = await this.relayer.buildPaymentTx(
      { id: order.id, amount: order.amount, expiresAt: order.expiresAt }, merchantAuthority, payer);
    return { tx, invoice: { merchant: order.merchantId, amount: order.amount.toString(), reference: order.reference, expiresAt: order.expiresAt } };
  }

  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body() dto: SubmitDto) {
    const signature = await this.relayer.verifyAndSubmit(id, dto.signedTx);
    await this.prisma.order.update({ where: { id }, data: { status: 'confirming', txSignature: signature } });
    const order = await this.orders.get(id);
    await this.watcher.markPaid(id, { payer: order!.payer ?? 'unknown', signature });
    return { txSignature: signature, status: 'confirming' };
  }
}
