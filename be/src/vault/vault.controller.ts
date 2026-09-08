import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { VaultService } from './vault.service';
import { TransactionProposal } from './vault.types';
import { JwtGuard } from '../auth/jwt.guard';

interface AuthenticatedRequest extends Request {
  user: { walletAddress: string; sub: string };
}

@Controller('vault')
@UseGuards(JwtGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  /**
   * GET /vault/position
   * Get user's vault position
   */
  @Get('position')
  async getPosition(@Req() req: AuthenticatedRequest) {
    return this.vaultService.getPosition(req.user.walletAddress);
  }

  /**
   * GET /vault/limits
   * Get vault deposit/withdraw limits
   */
  @Get('limits')
  async getLimits(@Req() req: AuthenticatedRequest) {
    return this.vaultService.getLimits(req.user.walletAddress);
  }

  /**
   * POST /vault/transactions/approve
   * Get the unsigned ERC-20 approve transaction granting the vault an allowance.
   * Paper §2.1: the farming entry path is a user-signed, user-paid approval
   * followed by `deposit`/`mint` — there is no relayer.
   */
  @Post('transactions/approve')
  @HttpCode(200)
  buildApproveTransactions(
    @Body() body: { amountBase: string },
  ): { transactions: TransactionProposal[] } {
    const transactions = this.vaultService.buildApproveTransactions(body.amountBase);
    return { transactions };
  }

  /**
   * POST /vault/transactions/deposit
   * Get unsigned transaction calldata for deposit
   */
  @Post('transactions/deposit')
  @HttpCode(200)
  async buildDepositTransactions(
    @Req() req: AuthenticatedRequest,
    @Body() body: { assetsBase: string },
  ): Promise<{ transactions: TransactionProposal[] }> {
    const transactions = await this.vaultService.buildDepositTransactions(
      req.user.walletAddress,
      body.assetsBase,
    );
    return { transactions };
  }

  /**
   * POST /vault/transactions/redeem
   * Get unsigned transaction calldata for redeem
   */
  @Post('transactions/redeem')
  @HttpCode(200)
  async buildRedeemTransactions(
    @Req() req: AuthenticatedRequest,
    @Body() body: { sharesBase: string },
  ): Promise<{ transactions: TransactionProposal[] }> {
    const transactions = await this.vaultService.buildRedeemTransactions(
      req.user.walletAddress,
      body.sharesBase,
    );
    return { transactions };
  }

  /**
   * POST /vault/transactions/withdraw
   * Get unsigned transaction calldata for withdraw
   */
  @Post('transactions/withdraw')
  @HttpCode(200)
  async buildWithdrawTransactions(
    @Req() req: AuthenticatedRequest,
    @Body() body: { assetsBase: string },
  ): Promise<{ transactions: TransactionProposal[] }> {
    const transactions = await this.vaultService.buildWithdrawTransactions(
      req.user.walletAddress,
      body.assetsBase,
    );
    return { transactions };
  }

  /**
   * GET /vault/strategy
   * Get current SRCLA strategy allocation
   */
  @Get('strategy')
  async getStrategy() {
    return this.vaultService.getStrategy();
  }

  /**
   * GET /vault/decisions
   * Get SRCLA decision history
   */
  @Get('decisions')
  async getDecisions(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vaultService.getDecisions({ cursor, limit });
  }

  /**
   * GET /vault/harvests
   * Get harvest history
   */
  @Get('harvests')
  async getHarvests(
    @Query('adapter') adapter?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vaultService.getHarvests({ adapter, cursor, limit });
  }
}
