import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { FarmingService } from './farming.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { parsePositiveAmount } from '../common/amount.util';

class DepositDto { amountLamports!: string; }
class WithdrawDto { amount!: string; }

@Controller('farming')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class FarmingController {
  constructor(private readonly farming: FarmingService) {}

  @Post('subwallet')
  create(@Req() req: any) { return this.farming.createSubwallet(req.user.sub, req.user.walletAddress); }

  @Get()
  position(@Req() req: any) { return this.farming.getPosition(req.user.sub); }

  @Post('deposit')
  deposit(@Req() req: any, @Body() dto: DepositDto) { return this.farming.deposit(req.user.sub, parsePositiveAmount(dto.amountLamports, 'amountLamports')); }

  @Post('withdraw')
  withdraw(@Req() req: any, @Body() dto: WithdrawDto) { return this.farming.withdraw(req.user.sub, dto.amount === 'all' ? 'all' : parsePositiveAmount(dto.amount)); }

  @Get('history')
  history(@Req() req: any) { return this.farming.listHistory(req.user.sub); }
}
