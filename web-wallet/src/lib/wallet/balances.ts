import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toString();
}
/**
 * Format USDC base units (6 decimals) to a 2-dp display string using BigInt math,
 * so large amounts don't lose precision (Number.MAX_SAFE_INTEGER/1e6 ≈ 9e9 USDC)
 * and malformed input renders '0.00' instead of 'NaN' (which would leak into e.g.
 * a "Pay NaN USDC" button label).
 */
export function usdcBaseToDisplay(base: string | bigint): string {
  let b: bigint;
  try {
    b = typeof base === 'bigint' ? base : BigInt(base);
  } catch {
    return '0.00';
  }
  const neg = b < BigInt(0);
  if (neg) b = -b;
  const cents = (b + BigInt(5000)) / BigInt(10000); // round half-up to 2 decimals
  const whole = cents / BigInt(100);
  const frac = cents % BigInt(100);
  return `${neg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

export async function fetchBalances(connection: Connection, owner: PublicKey, usdcMint: PublicKey): Promise<{ solLamports: number; usdcBase: string }> {
  const solLamports = await connection.getBalance(owner);
  let usdcBase = '0';
  try {
    const ata = await getAssociatedTokenAddress(usdcMint, owner);
    const bal = await connection.getTokenAccountBalance(ata);
    usdcBase = bal.value.amount;
  } catch {
    usdcBase = '0';
  }
  return { solLamports, usdcBase };
}
