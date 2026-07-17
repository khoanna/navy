import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { merchantIdHex } from '../evm/payment-authorization';
import { OrdersService } from './orders.service';
import { RelayerService } from './relayer.service';
import { ChainWatcherService } from './chain-watcher.service';
import { OrderAuthGuard } from './order-auth.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUrl, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class OrderLineDto {
  @IsUUID() productId!: string;
  @IsInt() @IsPositive() quantity!: number;
}
class CreateOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
  @IsOptional() @IsString() description?: string;
  // https-only, real TLD — an SSRF guard against loopback/link-local/private webhook targets.
  @IsOptional() @IsUrl({ protocols: ['https'], require_tld: true }) callbackUrl?: string;
  @IsInt() @IsPositive() @IsOptional() expiresInSec?: number;
}
class SubmitDto {
  @IsString() @IsNotEmpty() signature!: string;
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
      items: dto.items, description: dto.description,
      callbackUrl: dto.callbackUrl, expiresInSec: dto.expiresInSec,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const o = await this.orders.get(id);
    return o && {
      orderId: o.id, status: o.status, amount: o.amount.toString(), reference: o.reference, paidAt: o.paidAt,
      subtotal: o.subtotal != null ? o.subtotal.toString() : null,
      description: o.description ?? null,
      items: (o.items ?? []).map((it) => ({ name: it.name, unitPrice: it.unitPrice.toString(), quantity: it.quantity })),
      charges: (o.charges ?? []).map((c) => ({ name: c.name, mode: c.mode, value: c.value, amount: c.amount.toString() })),
    };
  }

  @Get(':id/payment-authorization')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('user')
  async paymentAuthorization(@Param('id') id: string, @Req() req: any) {
    const order = await this.orders.get(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'awaiting_payment' || order.expiresAt < new Date()) {
      throw new BadRequestException('Order is not awaiting payment');
    }
    const payer: string = req.user.walletAddress;
    if (!payer || !/^0x[0-9a-fA-F]{40}$/.test(payer)) throw new BadRequestException('EVM wallet address required');
    const { typedData } = await this.relayer.buildAuthorization(
      { id: order.id, amount: order.amount, expiresAt: order.expiresAt, reference: order.reference },
      merchantIdHex(order.merchantId),
      payer,
    );
    return {
      typedData,
      invoice: { merchant: order.merchantId, amount: order.amount.toString(), reference: order.reference, expiresAt: order.expiresAt },
    };
  }

  @Post(':id/submit')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('user')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async submit(@Param('id') id: string, @Body() dto: SubmitDto, @Req() req: any) {
    const { txHash, err } = await this.relayer.verifyAndSubmit(id, dto.signature, req.user.walletAddress);
    if (err) {
      // The submitted tx reverted. Reset the order so the user can re-authorize: clear the consumed
      // nonce + issued hash so a fresh `payment-authorization` can be built (build is gated on
      // `awaiting_payment`). Without this the nonce stays consumed and the order is permanently stuck.
      await this.prisma.order.update({
        where: { id },
        data: { status: 'awaiting_payment', issuedTxConsumedAt: null, issuedTxHash: null, txSignature: null },
      });
      // Wallet clients only recognize 'failed' (they treat any other string, incl. 'retry', as
      // success). The order is internally RESET to awaiting_payment above so the user can re-auth.
      return { txHash, status: 'failed' };
    }
    await this.prisma.order.update({ where: { id }, data: { status: 'confirming', txSignature: txHash } });
    await this.watcher.confirmOrder(id);
    const settled = await this.prisma.order.findUnique({ where: { id } });
    return { txHash, status: settled?.status ?? 'confirming' };
  }
}
