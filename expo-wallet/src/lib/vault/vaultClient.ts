import type { Eip712TypedData } from '@/lib/pay/navyPayClient';
import type { VaultPosition } from './withdrawShares';

// The pooled ERC-4626 vault backend (be/src/vault) exposes a 2-step, gasless flow
// that mirrors the transfer/payment rails: build typed data → sign with the Privy
// embedded wallet → submit the signature (the relayer pays gas).
//   - deposit: EIP-3009 `receiveWithAuthorization` on USDC → vault deposits for the user
//   - redeem:  EIP-2612 `permit` on the vault share token → vault redeems shares → USDC
// Amounts are base units (USDC 6-decimals; shares in the share token's base units).

export interface VaultAuthResult {
  typedData: Eip712TypedData;
  deposit: { id: string };
}
export interface VaultPermitResult {
  typedData: Eip712TypedData;
  redeem: { id: string };
}
export interface VaultSubmitResult {
  status: string;
  txHash: string;
}
export interface VaultApy {
  adapter: string;
  aprE18: string;
  assetsBase: string;
}

export type { VaultPosition };

/**
 * Client for the pooled vault's 2-step deposit/redeem flow.
 *
 * Mirrors `TransferClient`: every call routes through the session's `authedFetch`
 * so an expired access token is transparently refreshed + retried on 401. The
 * `signTypedData` callback is the Privy embedded-wallet signer (`useMobileSigner`),
 * i.e. the exact same EIP-712 signature path payments/transfers use.
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
    if (!res.ok) throw new Error(`vault ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  /** Deposit `amountBase` USDC (base units): build → sign → submit. */
  async deposit(amountBase: string): Promise<VaultSubmitResult> {
    const { typedData, deposit } = await this.json<VaultAuthResult>('/vault/deposit/authorization', {
      method: 'POST',
      body: JSON.stringify({ amountBase }),
    });
    const signature = await this.signTypedData(typedData);
    return this.json<VaultSubmitResult>('/vault/deposit/submit', {
      method: 'POST',
      body: JSON.stringify({ id: deposit.id, signature }),
    });
  }

  /** Redeem `sharesBase` vault shares (base units): permit → sign → submit. */
  async redeemShares(sharesBase: string): Promise<VaultSubmitResult> {
    const { typedData, redeem } = await this.json<VaultPermitResult>('/vault/redeem/permit', {
      method: 'POST',
      body: JSON.stringify({ sharesBase }),
    });
    const signature = await this.signTypedData(typedData);
    return this.json<VaultSubmitResult>('/vault/redeem/submit', {
      method: 'POST',
      body: JSON.stringify({ id: redeem.id, signature }),
    });
  }

  getPosition(): Promise<VaultPosition> {
    return this.json<VaultPosition>('/vault/position');
  }

  getApys(): Promise<VaultApy[]> {
    return this.json<VaultApy[]>('/vault/apys');
  }
}
