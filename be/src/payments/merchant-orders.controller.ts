import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class CreateOrderDto { amount!: string; reference!: string; expiresInSec?: number; }

@Controller('merchant/orders')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class MerchantOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.orders.createForMerchant(req.user.sub, {
      amount: BigInt(dto.amount), reference: dto.reference, expiresInSec: dto.expiresInSec,
    });
  }

  @Get()
  list(@Req() req: any, @Query('status') status?: string, @Query('take') take = '50', @Query('skip') skip = '0') {
    return this.orders.listForMerchant(req.user.sub, { status, take: parseInt(take, 10), skip: parseInt(skip, 10) });
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.orders.getForMerchant(req.user.sub, id);
  }
}
