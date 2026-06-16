import { PublicKey, Transaction } from '@solana/web3.js';

export interface YieldPosition { principalLamports: bigint; currentValueLamports: bigint; cTokenAmount: bigint; }

export interface YieldAdapter {
  buildDeposit(subwallet: PublicKey, amountLamports: bigint): Promise<Transaction>;
  buildWithdraw(subwallet: PublicKey, ownerMainWallet: PublicKey, amount: bigint | 'all'): Promise<Transaction>;
  getPosition(subwallet: PublicKey): Promise<YieldPosition>;
  policyAllowlist(subwallet: PublicKey, ownerMainWallet: PublicKey): Promise<{ programIds: string[]; destinations: string[] }>;
}

export function computePositionValue(cTokenAmount: bigint, exchangeRate: number): bigint {
  const SCALE = 1_000_000_000n;
  const rateScaled = BigInt(Math.round(exchangeRate * 1e9));
  return (cTokenAmount * rateScaled) / SCALE;
}
