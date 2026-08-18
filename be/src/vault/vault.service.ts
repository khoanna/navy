/**
 * VaultService — Deep module providing vault position queries, ERC-4626 limits,
 * unsigned calldata builders for local wallet signing, and SRCLA strategy integration.
 */
import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { NavyConfigService } from '../config/config.service';
import { SrclaClient, StrategyAllocation } from './srcla-client';
import { TransactionProposal, VaultPositionDto, VaultLimitsDto } from './vault.types';

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

const VAULT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
] as const;

@Injectable()
export class VaultService {
  readonly provider: ethers.JsonRpcProvider;
  readonly chainId: number;
  readonly usdcAddress: string;
  readonly vaultAddress: string;
  readonly usdc: ethers.Contract;
  readonly vault: ethers.Contract;

  constructor(
    private readonly config: NavyConfigService,
    private readonly srclaClient: SrclaClient,
  ) {
    const rpcUrl = config.farmingBaseRpcUrl;
    this.chainId = config.farmingBaseChainId;
    this.usdcAddress = config.farmingBaseUsdcAddress;
    this.vaultAddress = config.farmingVaultAddress;

    if (!rpcUrl) throw new Error('Missing required env var: FARMING_BASE_RPC_URL');
    if (!this.usdcAddress) throw new Error('Missing required env var: FARMING_BASE_USDC_ADDRESS');
    if (!this.vaultAddress) throw new Error('Missing required env var: FARMING_VAULT_ADDRESS');

    this.provider = new ethers.JsonRpcProvider(rpcUrl, this.chainId);
    this.usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.provider);
    this.vault = new ethers.Contract(this.vaultAddress, VAULT_ABI, this.provider);
  }

  /**
   * Get user's vault position
   */
  async getPosition(walletAddress: string): Promise<VaultPositionDto> {
    const [sharesBase, maxWithdrawBase, maxRedeemBase] = await Promise.all([
      this.vault.balanceOf(walletAddress),
      this.vault.maxWithdraw(walletAddress),
      this.vault.maxRedeem(walletAddress),
    ]);
    const assetsBase = await this.vault.convertToAssets(sharesBase);

    return {
      sharesBase: sharesBase.toString(),
      assetsBase: assetsBase.toString(),
      maxWithdrawBase: maxWithdrawBase.toString(),
      maxRedeemBase: maxRedeemBase.toString(),
    };
  }

  /**
   * Get vault limits for user
   */
  async getLimits(walletAddress: string): Promise<VaultLimitsDto> {
    const [maxDeposit, maxWithdraw, maxRedeem] = await Promise.all([
      this.vault.maxDeposit(walletAddress),
      this.vault.maxWithdraw(walletAddress),
      this.vault.maxRedeem(walletAddress),
    ]);

    return {
      maxDeposit: maxDeposit.toString(),
      maxWithdraw: maxWithdraw.toString(),
      maxRedeem: maxRedeem.toString(),
    };
  }

  /**
   * Get USDC allowance granted by a wallet to the vault
   */
  async getAllowance(walletAddress: string): Promise<bigint> {
    return this.usdc.allowance(walletAddress, this.vaultAddress) as Promise<bigint>;
  }

  /**
   * Build deposit transaction calldata for wallet signing
   */
  async buildDepositTransactions(
    walletAddress: string,
    assetsBase: string,
  ): Promise<TransactionProposal[]> {
    const assets = BigInt(assetsBase);
    const proposals: TransactionProposal[] = [];

    const allowance = await this.getAllowance(walletAddress);

    if (allowance < assets) {
      const approveData = this.usdc.interface.encodeFunctionData('approve', [
        this.vaultAddress,
        assets,
      ]);
      proposals.push({
        to: this.usdcAddress,
        data: approveData,
        value: '0',
        chainId: this.chainId,
        description: `Approve vault to spend ${assetsBase} USDC`,
      });
    }

    const depositData = this.vault.interface.encodeFunctionData('deposit', [assets, walletAddress]);
    proposals.push({
      to: this.vaultAddress,
      data: depositData,
      value: '0',
      chainId: this.chainId,
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
  ): Promise<TransactionProposal[]> {
    const shares = BigInt(sharesBase);
    const redeemData = this.vault.interface.encodeFunctionData('redeem', [
      shares,
      walletAddress,
      walletAddress,
    ]);

    return [
      {
        to: this.vaultAddress,
        data: redeemData,
        value: '0',
        chainId: this.chainId,
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
  ): Promise<TransactionProposal[]> {
    const assets = BigInt(assetsBase);
    const withdrawData = this.vault.interface.encodeFunctionData('withdraw', [
      assets,
      walletAddress,
      walletAddress,
    ]);

    return [
      {
        to: this.vaultAddress,
        data: withdrawData,
        value: '0',
        chainId: this.chainId,
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
