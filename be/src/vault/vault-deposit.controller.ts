/**
 * VaultDepositController — Gasless vault deposit and redeem endpoints.
 * All routes require a valid Navy JWT; walletAddress is extracted from req.user.
 */
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { VaultDepositService } from './vault-deposit.service';
import { JwtGuard } from '../auth/jwt.guard';
import { DepositAuthorizationDto, DepositSubmitDto, RedeemPermitDto, RedeemSubmitDto } from './dto/vault-deposit.dto';

interface AuthenticatedRequest extends Request {
  user: { walletAddress: string; sub: string; id?: string };
}

/**
 * POST /vault/deposit/authorization
 * Build EIP-3009 ReceiveWithAuthorization typed data for a gasless vault deposit.
 * The user signs the typed data with their wallet; the relayer submits on their behalf.
 */
@Controller('vault/deposit')
@UseGuards(JwtGuard)
export class VaultDepositController {
  constructor(private readonly vaultDeposit: VaultDepositService) {}

  @Post('authorization')
  @HttpCode(200)
  async buildAuthorization(@Req() req: AuthenticatedRequest, @Body() dto: DepositAuthorizationDto) {
    return this.vaultDeposit.buildDepositAuthorization(
      req.user.sub,
      req.user.walletAddress,
      dto.amountBase,
    );
  }

  @Post('submit')
  @HttpCode(200)
  async submitDeposit(@Req() req: AuthenticatedRequest, @Body() dto: DepositSubmitDto) {
    return this.vaultDeposit.submitDeposit(
      req.user.sub,
      req.user.walletAddress,
      dto.id,
      dto.signature,
    );
  }
}

/**
 * POST /vault/redeem/permit
 * Build EIP-2612 Permit typed data for a gasless vault redeem (no gas needed from user).
 * The user signs the typed data with their wallet; the relayer submits on their behalf.
 */
@Controller('vault/redeem')
@UseGuards(JwtGuard)
export class VaultRedeemController {
  constructor(private readonly vaultDeposit: VaultDepositService) {}

  @Post('permit')
  @HttpCode(200)
  async buildPermit(@Req() req: AuthenticatedRequest, @Body() dto: RedeemPermitDto) {
    return this.vaultDeposit.buildRedeemPermit(
      req.user.sub,
      req.user.walletAddress,
      dto.sharesBase,
    );
  }

  @Post('submit')
  @HttpCode(200)
  async submitRedeem(@Req() req: AuthenticatedRequest, @Body() dto: RedeemSubmitDto) {
    return this.vaultDeposit.submitRedeem(
      req.user.sub,
      req.user.walletAddress,
      dto.id,
      dto.signature,
    );
  }
}
