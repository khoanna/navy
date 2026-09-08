/**
 * VaultClient — client for the pooled ERC-4626 vault (NavyVaultSRCLA).
 *
 * All routes require a valid Navy JWT; walletAddress is taken from the token,
 * never from a parameter. Routes through `authedFetch` so an expired access
 * token is transparently refreshed + retried on 401.
 *
 * SRCLA paper §2.1: "Farming has no backend relayer, EIP-3009 deposit flow,
 * sponsored gas, or relayed redemption." So this client no longer signs typed
 * data or submits anything — it asks the backend for UNSIGNED transactions and
 * the caller broadcasts them from the user's own wallet, paying their own gas:
 *
 *   1. POST /vault/transactions/deposit  → [approve?, deposit]
 *   2. the user signs and broadcasts each leg in order (see `proposals.ts`)
 *
 * Redeem is the same with a single `redeem` leg.
 *
 * The backend refuses a proposal it can already see will revert (short USDC
 * balance, redeem beyond synchronous liquidity) and returns a structured
 * `reason`. `VaultRequestError.reason` carries it through so the UI can say
 * *by how much* the user is short instead of "400 Bad Request".
 */

import { readVaultReason, type VaultFailureReason } from './failures';
import type { TransactionProposal } from './proposals';
import type {
  VaultPosition,
  VaultApysResponse,
  AdapterApy,
  StrategyAllocation,
  HarvestsResponse,
  HarvestRecord,
  VaultTransactionsResponse,
} from './types';

/** A non-2xx response from the vault BFF, with the backend's machine-readable reason attached. */
export class VaultRequestError extends Error {
  readonly status: number;
  readonly reason: VaultFailureReason | null;

  constructor(message: string, status: number, reason: VaultFailureReason | null) {
    super(message);
    this.name = 'VaultRequestError';
    this.status = status;
    this.reason = reason;
  }
}

export class VaultClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.authedFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = '';
      let reason: VaultFailureReason | null = null;
      try {
        const body = await res.json();
        reason = readVaultReason(body);
        detail = body && (body.message || body.error) ? `: ${body.message ?? body.error}` : '';
      } catch {
        try {
          const t = (await res.text()).trim();
          if (t) detail = `: ${t}`;
        } catch { /* ignore */ }
      }
      throw new VaultRequestError(
        `vault ${path} failed (${res.status})${detail}`,
        res.status,
        reason,
      );
    }
    return (await res.json()) as T;
  }

  private async transactions(path: string, body: object): Promise<TransactionProposal[]> {
    const res = await this.json<VaultTransactionsResponse>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.transactions ?? [];
  }

  /**
   * Unsigned legs to deposit `assetsBase` USDC (6-decimal base units): an ERC-20
   * `approve` when the current allowance is short, then `deposit`.
   *
   * @throws VaultRequestError with `reason.code === 'INSUFFICIENT_USDC_BALANCE'`
   *         when the wallet cannot fund the deposit.
   */
  buildDeposit(assetsBase: string): Promise<TransactionProposal[]> {
    return this.transactions('/vault/transactions/deposit', { assetsBase });
  }

  /**
   * Unsigned leg to redeem `sharesBase` vault shares (12-decimal base units).
   *
   * @throws VaultRequestError with `reason.code === 'EXCEEDS_MAX_REDEEM'` when
   *         the vault cannot pay out that many shares synchronously.
   */
  buildRedeem(sharesBase: string): Promise<TransactionProposal[]> {
    return this.transactions('/vault/transactions/redeem', { sharesBase });
  }

  /** Unsigned leg to withdraw `assetsBase` USDC (6-decimal base units). */
  buildWithdraw(assetsBase: string): Promise<TransactionProposal[]> {
    return this.transactions('/vault/transactions/withdraw', { assetsBase });
  }

  /** Unsigned standalone ERC-20 `approve` granting the vault an allowance. */
  buildApprove(amountBase: string): Promise<TransactionProposal[]> {
    return this.transactions('/vault/transactions/approve', { amountBase });
  }

  /** Get user's vault position. */
  getPosition(): Promise<VaultPosition> {
    return this.json<VaultPosition>('/vault/position');
  }

  /** Get current vault APY and TVL per adapter. */
  getApys(): Promise<VaultApysResponse> {
    return this.json<VaultApysResponse>('/vault/apys');
  }

  /** Get current SRCLA strategy allocation. */
  getStrategy(): Promise<StrategyAllocation> {
    return this.json<StrategyAllocation>('/vault/strategy');
  }

  /** Get harvest history with optional adapter filter and cursor pagination. */
  getHarvests(params?: {
    adapter?: string;
    cursor?: string;
    limit?: string;
  }): Promise<HarvestsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.adapter) searchParams.set('adapter', params.adapter);
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.limit) searchParams.set('limit', params.limit);
    const query = searchParams.toString();
    return this.json<HarvestsResponse>(
      `/vault/harvests${query ? `?${query}` : ''}`,
    );
  }
}

// Re-export types for consumers
export type {
  VaultPosition,
  VaultApysResponse,
  AdapterApy as VaultApy, // backward compat with farming.tsx
  StrategyAllocation,
  HarvestsResponse,
  HarvestRecord,
  TransactionProposal,
};
