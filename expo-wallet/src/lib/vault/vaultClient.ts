/**
 * VaultClient — client for the pooled ERC-4626 vault (NavyVaultSRCLA).
 *
 * All routes require a valid Navy JWT; walletAddress is extracted from req.user.
 * Routes through `authedFetch` so an expired access token is transparently
 * refreshed + retried on 401.
 *
 * Flows (both gasless — relayer pays gas):
 *
 * Deposit (EIP-3009 ReceiveWithAuthorization):
 *   1. POST /vault/deposit/authorization → typed data
 *   2. Sign typed data with Privy embedded wallet
 *   3. POST /vault/deposit/submit → relayer calls USDC.receiveWithAuthorization + vault.deposit
 *
 * Redeem (EIP-2612 Permit):
 *   1. POST /vault/redeem/permit → typed data
 *   2. Sign typed data with Privy embedded wallet
 *   3. POST /vault/redeem/submit → relayer calls vault.redeem with the permit
 */

import type { Eip712TypedData } from '@/lib/pay/navyPayClient';
import type {
  DepositAuthorizationResponse,
  DepositSubmitResponse,
  RedeemPermitResponse,
  RedeemSubmitResponse,
  VaultPosition,
  VaultApysResponse,
  AdapterApy,
  StrategyAllocation,
  HarvestsResponse,
  HarvestRecord,
} from './types';

/**
 * Client for the pooled vault's 2-step deposit/redeem flow.
 *
 * Mirrors `TransferClient` and `NavyPayClient`: every call routes through the
 * session's `authedFetch` so an expired access token is transparently
 * refreshed + retried on 401.  The `signTypedData` callback is the Privy
 * embedded-wallet signer (`useMobileSigner`).
 */
export class VaultClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
    private readonly signTypedData: (typedData: Eip712TypedData) => Promise<string>,
  ) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.authedFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body && (body.message || body.error) ? `: ${body.message ?? body.error}` : '';
      } catch {
        try {
          const t = (await res.text()).trim();
          if (t) detail = `: ${t}`;
        } catch { /* ignore */ }
      }
      throw new Error(`vault ${path} failed (${res.status})${detail}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Deposit `amountBase` USDC (6-decimal base units).
   * Calls authorization → signs typed data → submits.
   */
  async deposit(amountBase: string): Promise<DepositSubmitResponse> {
    // Step 1: Get EIP-3009 typed data
    const auth = await this.json<DepositAuthorizationResponse>('/vault/deposit/authorization', {
      method: 'POST',
      body: JSON.stringify({ amountBase }),
    });

    // Step 2: Sign with Privy embedded wallet
    const signature = await this.signTypedData(auth.typedData);

    // Step 3: Submit — relayer pays gas
    return this.json<DepositSubmitResponse>('/vault/deposit/submit', {
      method: 'POST',
      body: JSON.stringify({ id: auth.id, signature }),
    });
  }

  /**
   * Redeem `sharesBase` vault shares (base units).
   * Calls permit → signs typed data → submits.
   */
  async redeemShares(sharesBase: string): Promise<RedeemSubmitResponse> {
    // Step 1: Get EIP-2612 permit typed data
    const permit = await this.json<RedeemPermitResponse>('/vault/redeem/permit', {
      method: 'POST',
      body: JSON.stringify({ sharesBase }),
    });

    // Step 2: Sign with Privy embedded wallet
    const signature = await this.signTypedData(permit.typedData);

    // Step 3: Submit — relayer pays gas
    return this.json<RedeemSubmitResponse>('/vault/redeem/submit', {
      method: 'POST',
      body: JSON.stringify({ id: permit.id, signature }),
    });
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
  DepositSubmitResponse,
  RedeemSubmitResponse,
};
