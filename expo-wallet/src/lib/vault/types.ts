/**
 * Shared types for the pooled ERC-4626 vault client.
 *
 * Paper §2.1 removed the relayer from farming: there is no EIP-3009 deposit
 * authorization and no EIP-2612 redeem permit any more. The backend returns
 * UNSIGNED transactions the user signs and pays for. Mirrors
 * `be/src/vault/vault.types.ts` and `be/src/vault/vault-apy.service.ts`.
 */

// ---------------------------------------------------------------------------
// Unsigned transaction proposals (POST /vault/transactions/*)
// ---------------------------------------------------------------------------

export type { TransactionProposal } from './proposals';

/** Envelope every `POST /vault/transactions/*` route returns. */
export interface VaultTransactionsResponse {
  transactions: import('./proposals').TransactionProposal[];
}

// ---------------------------------------------------------------------------
// Vault position
// ---------------------------------------------------------------------------

export interface VaultPosition {
  sharesBase: string; // vault shares, 12-decimal base units (string BigInt)
  assetsBase: string; // current USDC value of those shares, 6-decimal base units
  maxWithdrawBase?: string; // USDC withdrawable synchronously, 6 dp
  maxRedeemBase?: string; // shares redeemable synchronously, 12 dp
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
