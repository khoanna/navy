import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('user/payments')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class UserPaymentsController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Req() req: any, @Query('take') take = '50', @Query('skip') skip = '0') {
    const payer = req.user.walletAddress;
    if (!payer) return [];
    return this.orders.listForPayer(payer, { take: parseInt(take, 10), skip: parseInt(skip, 10) });
  }
}
