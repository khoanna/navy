/**
 * Shared types for the pooled ERC-4626 vault client.
 * Mirrors the backend types in be/src/vault/vault-deposit.service.ts and
 * be/src/vault/vault-apy.service.ts.
 */

import type { Eip712TypedData } from '@/lib/pay/navyPayClient';

// ---------------------------------------------------------------------------
// Deposit (EIP-3009 ReceiveWithAuthorization)
// ---------------------------------------------------------------------------

export interface DepositAuthorizationResponse {
  id: string;
  typedData: Eip712TypedData;
  amountBase: string;
  expiresAt: string; // ISO date string
}

export interface DepositSubmitResponse {
  txHash: string;
  status: 'confirming';
  sharesBase: string;
}

// ---------------------------------------------------------------------------
// Redeem (EIP-2612 Permit)
// ---------------------------------------------------------------------------

export interface RedeemPermitResponse {
  id: string;
  typedData: Eip712TypedData;
  sharesBase: string;
  expiresAt: string; // ISO date string
}

export interface RedeemSubmitResponse {
  txHash: string;
  status: 'confirming';
  assetsBase: string;
}

// ---------------------------------------------------------------------------
// Vault position
// ---------------------------------------------------------------------------

export interface VaultPosition {
  sharesBase: string; // vault shares, base units (string BigInt)
  assetsBase: string; // current USDC value of those shares, 6-decimal base units
}

// ---------------------------------------------------------------------------
// APY data
// ---------------------------------------------------------------------------

export interface AdapterApy {
  address: string;
  name: string;
  apyBps: number;
  tvlBase: string;
}

/** Alias — what the farming screen and older code expect. */
export type VaultApy = AdapterApy;

export interface VaultApysResponse {
  adapters: AdapterApy[];
  aggregateApyBps: number;
  blockNumber: number;
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export interface StrategyAllocation {
  totalAssets: string;
  allocations: Array<{
    adapter: string;
    name: string;
    assets: string;
    percentage: number;
  }>;
}

// ---------------------------------------------------------------------------
// Harvests
// ---------------------------------------------------------------------------

export interface HarvestRecord {
  adapter: string;
  protocol: string;
  harvestedAt: string;
  grossBase: string;
  netBase: string;
  recipients: Array<{
    address: string;
    shares: string;
  }>;
}

export interface HarvestsResponse {
  harvests: HarvestRecord[];
  next?: string;
}
