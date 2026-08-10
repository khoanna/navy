import { Injectable } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { ethers } from 'ethers';
import type { VaultPosition, TransactionProposal } from './farming-chain.types';

// Minimal ERC20 ABI for approval and allowance checks
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

// Minimal ERC4626 vault ABI for reads and calldata building
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
export class FarmingChainService {
  /** Read-only JsonRpcProvider for Base chain (no signer attached). */
  readonly provider: ethers.JsonRpcProvider;
  readonly chainId: number;
  readonly usdcAddress: string;
  readonly vaultAddress: string;
  readonly usdc: ethers.Contract;
  readonly vault: ethers.Contract;

  constructor(private readonly config: NavyConfigService) {
    const rpcUrl = config.farmingBaseRpcUrl;
    this.chainId = config.farmingBaseChainId;
    this.usdcAddress = config.farmingBaseUsdcAddress;
    this.vaultAddress = config.farmingVaultAddress;

    // Explicit validation — ethers.Contract accepts empty strings silently
    if (!rpcUrl) throw new Error('Missing required env var: FARMING_BASE_RPC_URL');
    if (!this.usdcAddress) throw new Error('Missing required env var: FARMING_BASE_USDC_ADDRESS');
    if (!this.vaultAddress) throw new Error('Missing required env var: FARMING_VAULT_ADDRESS');

    // Read-only provider — no signer attached
    this.provider = new ethers.JsonRpcProvider(rpcUrl, this.chainId);
    this.usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.provider);
    this.vault = new ethers.Contract(this.vaultAddress, VAULT_ABI, this.provider);
  }

  /**
   * Get a user's vault position (shares, assets, withdrawal limits).
   */
  async getPosition(walletAddress: string): Promise<VaultPosition> {
    const [sharesBase, maxWithdrawBase, maxRedeemBase] = await Promise.all([
      this.vault.balanceOf(walletAddress),
      this.vault.maxWithdraw(walletAddress),
      this.vault.maxRedeem(walletAddress),
    ]);
    const assetsBase = await this.vault.convertToAssets(sharesBase);
    return { sharesBase, assetsBase, maxWithdrawBase, maxRedeemBase };
  }

  /**
   * Get USDC allowance granted by a wallet to the vault.
   */
  async getAllowance(walletAddress: string): Promise<bigint> {
    return this.usdc.allowance(walletAddress, this.vaultAddress) as Promise<bigint>;
  }

  /**
   * Get a user's vault deposit/withdrawal limits.
   */
  async getLimits(walletAddress: string): Promise<{
    maxDeposit: bigint;
    maxWithdraw: bigint;
    maxRedeem: bigint;
  }> {
    const [maxDeposit, maxWithdraw, maxRedeem] = await Promise.all([
      this.vault.maxDeposit(walletAddress),
      this.vault.maxWithdraw(walletAddress),
      this.vault.maxRedeem(walletAddress),
    ]);
    return { maxDeposit, maxWithdraw, maxRedeem };
  }

  /**
   * Preview the number of shares minted for a given deposit amount.
   */
  async previewDeposit(assets: bigint): Promise<bigint> {
    return this.vault.previewDeposit(assets) as Promise<bigint>;
  }

  /**
   * Preview the number of assets returned for a given redeem amount.
   */
  async previewRedeem(shares: bigint): Promise<bigint> {
    return this.vault.previewRedeem(shares) as Promise<bigint>;
  }

  /**
   * Get the total assets held by the vault.
   */
  async getTotalAssets(): Promise<bigint> {
    return this.vault.totalAssets() as Promise<bigint>;
  }

  /**
   * Build an unsigned USDC approve transaction for the vault.
   */
  buildApprovalTransaction(walletAddress: string, amount: bigint): TransactionProposal {
    const data = this.usdc.interface.encodeFunctionData('approve', [
      this.vaultAddress,
      amount,
    ]);
    return {
      to: this.usdcAddress,
      data,
      value: '0',
      chainId: this.chainId,
      description: `Approve ${amount.toString()} USDC for vault ${this.vaultAddress}`,
    };
  }

  /**
   * Build an unsigned vault deposit transaction.
   * The user signs this with their wallet.
   */
  buildDepositTransaction(walletAddress: string, assets: bigint): TransactionProposal {
    const data = this.vault.interface.encodeFunctionData('deposit', [assets, walletAddress]);
    return {
      to: this.vaultAddress,
      data,
      value: '0',
      chainId: this.chainId,
      description: `Deposit ${assets.toString()} USDC into vault`,
    };
  }

  /**
   * Build an unsigned vault redeem transaction.
   * The user signs this with their wallet.
   */
  buildRedeemTransaction(
    walletAddress: string,
    shares: bigint,
  ): TransactionProposal {
    const data = this.vault.interface.encodeFunctionData('redeem', [
      shares,
      walletAddress, // receiver
      walletAddress, // owner (msg.sender must be owner or have permit)
    ]);
    return {
      to: this.vaultAddress,
      data,
      value: '0',
      chainId: this.chainId,
      description: `Redeem ${shares.toString()} shares from vault`,
    };
  }

  /**
   * Build an unsigned vault withdraw transaction.
   * The user signs this with their wallet.
   */
  buildWithdrawTransaction(
    walletAddress: string,
    assets: bigint,
  ): TransactionProposal {
    const data = this.vault.interface.encodeFunctionData('withdraw', [
      assets,
      walletAddress, // receiver
      walletAddress, // owner
    ]);
    return {
      to: this.vaultAddress,
      data,
      value: '0',
      chainId: this.chainId,
      description: `Withdraw ${assets.toString()} USDC from vault`,
    };
  }
}
