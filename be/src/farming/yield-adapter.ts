import type { EvmCall } from '../wallet/tx-summary';

/**
 * A yield position, in base units of the farmed asset (Circle USDC, 6 dec).
 * Field names are preserved across the Solana→EVM migration; `*Lamports` now hold
 * USDC base units and `cTokenAmount` holds the Comet supplier balance (balanceOf,
 * which grows with accrued interest).
 */
export interface YieldPosition { principalLamports: bigint; currentValueLamports: bigint; cTokenAmount: bigint; }

/** Allowlist derived by the adapter and stored on the subwallet's policy. */
export interface PolicyAllowlist { programIds: string[]; destinations: string[]; }

/**
 * Chain-agnostic yield adapter. Each build* method returns an ordered list of EVM
 * calls ({ to, data, value? }) for the subwallet to send; the caller (SigningService)
 * policy-checks and broadcasts each one.
 */
export interface YieldAdapter {
  buildDeposit(subwallet: string, amountBase: bigint): Promise<EvmCall[]>;
  buildWithdraw(subwallet: string, ownerMainWallet: string, amount: bigint | 'all'): Promise<EvmCall[]>;
  getPosition(subwallet: string): Promise<YieldPosition>;
  policyAllowlist(subwallet: string, ownerMainWallet: string): Promise<PolicyAllowlist>;
}
