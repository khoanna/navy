import { Body, Controller, Get, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { VaultService } from './vault.service';
import { DepositAuthorizationDto, RedeemPermitDto, SubmitDto } from './dto';

function reqAmount(s: string): bigint {
  if (!/^\d+$/.test(s)) throw new BadRequestException('amount must be a base-unit integer string');
  return BigInt(s);
}

@Controller('vault')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Post('deposit/authorization')
  depositAuth(@Req() req: any, @Body() dto: DepositAuthorizationDto) {
    return this.vault.buildDepositAuthorization(req.user.sub, req.user.walletAddress, reqAmount(dto.amountBase));
  }

  @Post('deposit/submit')
  depositSubmit(@Req() req: any, @Body() dto: SubmitDto) {
    return this.vault.submitDeposit(dto.id, dto.signature, req.user.walletAddress);
  }

  @Post('redeem/permit')
  redeemPermit(@Req() req: any, @Body() dto: RedeemPermitDto) {
    return this.vault.buildRedeemPermit(req.user.sub, req.user.walletAddress, reqAmount(dto.sharesBase));
  }

  @Post('redeem/submit')
  redeemSubmit(@Req() req: any, @Body() dto: SubmitDto) {
    return this.vault.submitRedeem(dto.id, dto.signature, req.user.walletAddress);
  }

  @Get('position')
  position(@Req() req: any) {
    return this.vault.getPosition(req.user.walletAddress);
  }

  @Get('apys')
  apys() {
    return this.vault.getApys();
  }
}
