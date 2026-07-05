import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsArray, IsInt, IsOptional, IsPositive, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { parsePageSize, parseOffset } from '../common/amount.util';

class OrderLineDto {
  @IsUUID() productId!: string;
  @IsInt() @IsPositive() quantity!: number;
}
class CreateOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
  @IsString() @IsOptional() description?: string;
  @IsInt() @IsPositive() @IsOptional() expiresInSec?: number;
}

@Controller('merchant/orders')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class MerchantOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.orders.createForMerchant(req.user.sub, { items: dto.items, description: dto.description, expiresInSec: dto.expiresInSec });
  }

  @Get()
  list(@Req() req: any, @Query('status') status?: string, @Query('take') take = '50', @Query('skip') skip = '0') {
    return this.orders.listForMerchant(req.user.sub, { status, take: parsePageSize(take), skip: parseOffset(skip) });
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.orders.getForMerchant(req.user.sub, id);
  }
}
