import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { merchantIdFromUuid } from '../onchain/payments-client';
import { OrdersService } from './orders.service';
import { RelayerService } from './relayer.service';
import { ChainWatcherService } from './chain-watcher.service';
import { OrderAuthGuard } from './order-auth.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';

class CreateOrderDto {
  @IsString() @Matches(/^\d+$/, { message: 'must be a base-unit integer string' }) amount!: string;
  @IsString() @IsNotEmpty() reference!: string;
  @IsOptional() @IsString() callbackUrl?: string;
  @IsInt() @IsPositive() @IsOptional() expiresInSec?: number;
}
class SubmitDto {
  @IsString() @IsNotEmpty() signedTx!: string;
}

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
      amount: parsePositiveAmount(dto.amount), reference: dto.reference,
      callbackUrl: dto.callbackUrl, expiresInSec: dto.expiresInSec,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const o = await this.orders.get(id);
    return o && { orderId: o.id, status: o.status, amount: o.amount.toString(), reference: o.reference, paidAt: o.paidAt };
  }

  @Get(':id/payment-tx')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('user')
  async paymentTx(@Param('id') id: string, @Req() req: any) {
    const order = await this.orders.get(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'awaiting_payment' || order.expiresAt < new Date()) {
      throw new BadRequestException('Order is not awaiting payment');
    }
    let payer: PublicKey;
    try {
      payer = new PublicKey(req.user.walletAddress);
    } catch {
      throw new BadRequestException('Wallet address required');
    }
    const merchant = await this.prisma.merchant.findUnique({ where: { id: order.merchantId } });
    // merchant_id is the deterministic 16-byte encoding of the merchant uuid (matches the PDA seed).
    const merchantId = merchantIdFromUuid(order.merchantId);
    const payoutWallet = new PublicKey(merchant!.payoutAddress!);
    const tx = await this.relayer.buildPaymentTx(
      { id: order.id, amount: order.amount, expiresAt: order.expiresAt }, merchantId, payoutWallet, payer);
    return { tx, invoice: { merchant: order.merchantId, amount: order.amount.toString(), reference: order.reference, expiresAt: order.expiresAt } };
  }

  @Post(':id/submit')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('user')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async submit(@Param('id') id: string, @Body() dto: SubmitDto) {
    const { signature, err } = await this.relayer.verifyAndSubmit(id, dto.signedTx);
    if (err) {
      // The tx landed but reverted on-chain — do NOT mark paid or fire the merchant webhook.
      await this.prisma.order.update({ where: { id }, data: { status: 'failed', txSignature: signature } });
      return { txSignature: signature, status: 'failed' };
    }
    // Tx submitted: mark confirming with the signature, then reconcile against
    // the on-chain InvoicePaid event (fast path). Settlement always goes through
    // event reconciliation; if the event isn't visible yet the background sweep
    // retries. Re-read the order so the response reflects the resulting status.
    await this.prisma.order.update({ where: { id }, data: { status: 'confirming', txSignature: signature } });
    await this.watcher.confirmOrder(id);
    const settled = await this.prisma.order.findUnique({ where: { id } });
    return { txSignature: signature, status: settled?.status ?? 'confirming' };
  }
}
