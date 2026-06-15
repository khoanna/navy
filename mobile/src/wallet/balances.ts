import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toString();
}
export function usdcBaseToDisplay(base: string | bigint): string {
  return (Number(base) / 1_000_000).toFixed(2);
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
