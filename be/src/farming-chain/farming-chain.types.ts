/**
 * Types for the read-only Base chain farming provider.
 * This module provides a read-only provider for Base chain (no wallet/signer).
 * Used by VaultService to build unsigned transactions for user wallet signing.
 */

export interface FarmingChainConfig {
  rpcUrl: string;
  chainId: number;
  usdcAddress: string;
  vaultAddress: string;
}

export interface VaultPosition {
  sharesBase: bigint;
  assetsBase: bigint;
  maxWithdrawBase: bigint;
  maxRedeemBase: bigint;
}

export interface TransactionProposal {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description: string;
}

export interface StrategyInfo {
  totalAssets: string;
  allocations: Array<{
    adapter: string;
    name: string;
    assets: string;
    percentage: number;
  }>;
}
