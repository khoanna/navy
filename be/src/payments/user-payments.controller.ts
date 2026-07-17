import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { parsePageSize, parseOffset } from '../common/amount.util';

@Controller('user/payments')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class UserPaymentsController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Req() req: any, @Query('take') take?: string, @Query('skip') skip?: string) {
    const payer = req.user.walletAddress;
    if (!payer) return [];
    return this.orders.listForPayer(payer, { take: parsePageSize(take), skip: parseOffset(skip) });
  }
}
