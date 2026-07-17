import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { FarmingService } from './farming.service';
import { DelegationService } from './delegation.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsString, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';

class DepositDto {
  @IsString() @Matches(/^\d+$/, { message: 'must be a base-unit integer string' }) amountBase!: string;
}
class WithdrawDto {
  @IsString() @Matches(/^(all|\d+)$/) amount!: string;
}

@Controller('farming')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class FarmingController {
  constructor(
    private readonly farming: FarmingService,
    private readonly delegation: DelegationService,
  ) {}

  @Post('subwallet')
  create(@Req() req: any) { return this.farming.createSubwallet(req.user.sub, req.user.walletAddress); }

  @Get()
  position(@Req() req: any) { return this.farming.getPosition(req.user.sub); }

  @Post('deposit')
  deposit(@Req() req: any, @Body() dto: DepositDto) { return this.farming.deposit(req.user.sub, parsePositiveAmount(dto.amountBase, 'amountBase')); }

  @Post('withdraw')
  withdraw(@Req() req: any, @Body() dto: WithdrawDto) { return this.farming.withdraw(req.user.sub, dto.amount === 'all' ? 'all' : parsePositiveAmount(dto.amount)); }

  @Get('history')
  history(@Req() req: any) { return this.farming.listHistory(req.user.sub); }

  @Get('delegation')
  delegationStatus(@Req() req: any) { return this.delegation.status(req.user.sub); }

  @Post('delegation')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  enableDelegation(@Req() req: any) { return this.delegation.enable(req.user.sub); }

  @Delete('delegation')
  disableDelegation(@Req() req: any) { return this.delegation.disable(req.user.sub); }

  @Post('fund-now')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  fundNow(@Req() req: any) { return this.delegation.fundNow(req.user.sub); }
}
