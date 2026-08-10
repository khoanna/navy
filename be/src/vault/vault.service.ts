/**
 * VaultService — provides vault position queries and unsigned transaction builders.
 * Replaces the old gasless EIP-3009/EIP-2612 relay flow with unsigned calldata
 * that the user's wallet signs locally.
 */
import { Injectable } from '@nestjs/common';
import { FarmingChainService } from '../farming-chain/farming-chain.service';
import { SrclaClient, StrategyAllocation } from './srcla-client';

export interface VaultPositionDto {
  sharesBase: string;
  assetsBase: string;
  maxWithdrawBase: string;
  maxRedeemBase: string;
}

export interface VaultLimitsDto {
  maxDeposit: string;
  maxWithdraw: string;
  maxRedeem: string;
}

@Injectable()
export class VaultService {
  constructor(
    private readonly farmingChain: FarmingChainService,
    private readonly srclaClient: SrclaClient,
  ) {}

  /**
   * Get user's vault position
   */
  async getPosition(walletAddress: string): Promise<VaultPositionDto> {
    const position = await this.farmingChain.getPosition(walletAddress);

    return {
      sharesBase: position.sharesBase.toString(),
      assetsBase: position.assetsBase.toString(),
      maxWithdrawBase: position.maxWithdrawBase.toString(),
      maxRedeemBase: position.maxRedeemBase.toString(),
    };
  }

  /**
   * Get vault limits for user
   */
  async getLimits(walletAddress: string): Promise<VaultLimitsDto> {
    const limits = await this.farmingChain.getLimits(walletAddress);

    return {
      maxDeposit: limits.maxDeposit.toString(),
      maxWithdraw: limits.maxWithdraw.toString(),
      maxRedeem: limits.maxRedeem.toString(),
    };
  }

  /**
   * Build deposit transaction calldata for wallet signing
   */
  async buildDepositTransactions(
    walletAddress: string,
    assetsBase: string,
  ): Promise<ReturnType<FarmingChainService['buildDepositTransaction']>[]> {
    const assets = BigInt(assetsBase);
    const proposals: ReturnType<FarmingChainService['buildDepositTransaction']>[] = [];

    // Check allowance
    const allowance = await this.farmingChain.getAllowance(walletAddress);

    if (allowance < assets) {
      // Need approval
      proposals.push({
        ...this.farmingChain.buildApprovalTransaction(walletAddress, assets),
        chainId: this.farmingChain.chainId,
        description: `Approve vault to spend ${assetsBase} USDC`,
      });
    }

    // Deposit transaction
    proposals.push({
      ...this.farmingChain.buildDepositTransaction(walletAddress, assets),
      chainId: this.farmingChain.chainId,
      description: `Deposit ${assetsBase} USDC into vault`,
    });

    return proposals;
  }

  /**
   * Build redeem transaction calldata for wallet signing
   */
  async buildRedeemTransactions(
    walletAddress: string,
    sharesBase: string,
  ): Promise<ReturnType<FarmingChainService['buildRedeemTransaction']>[]> {
    const shares = BigInt(sharesBase);

    return [
      {
        ...this.farmingChain.buildRedeemTransaction(walletAddress, shares),
        chainId: this.farmingChain.chainId,
        description: `Redeem ${sharesBase} shares from vault`,
      },
    ];
  }

  /**
   * Build withdraw transaction calldata for wallet signing
   */
  async buildWithdrawTransactions(
    walletAddress: string,
    assetsBase: string,
  ): Promise<ReturnType<FarmingChainService['buildWithdrawTransaction']>[]> {
    const assets = BigInt(assetsBase);

    return [
      {
        ...this.farmingChain.buildWithdrawTransaction(walletAddress, assets),
        chainId: this.farmingChain.chainId,
        description: `Withdraw ${assetsBase} USDC from vault`,
      },
    ];
  }

  /**
   * Get current strategy allocation from SRCLA
   */
  async getStrategy(): Promise<StrategyAllocation> {
    return this.srclaClient.getCurrentAllocation();
  }

  /**
   * Get recent decisions from SRCLA
   */
  async getDecisions(params?: { cursor?: string; limit?: string }) {
    return this.srclaClient.getDecisions(params);
  }

  /**
   * Get recent harvests from SRCLA
   */
  async getHarvests(params?: { adapter?: string; cursor?: string; limit?: string }) {
    return this.srclaClient.getHarvests(params);
  }
}
