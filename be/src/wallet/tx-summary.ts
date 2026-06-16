import { Transaction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export interface TxSummary { programIds: string[]; transferDestinations: string[]; }

function isSystemTransfer(programId: string, data: Buffer): boolean {
  return programId === SystemProgram.programId.toBase58() && data.length >= 4 && data.readUInt32LE(0) === 2;
}

function tokenTransferDestIndex(programId: string, data: Buffer): number | null {
  if (programId !== TOKEN_PROGRAM_ID.toBase58() || data.length < 1) return null;
  if (data[0] === 3) return 1;   // Transfer: [source, destination, owner]
  if (data[0] === 12) return 2;  // TransferChecked: [source, mint, destination, owner]
  return null;
}

export function deriveTxSummary(tx: Transaction): TxSummary {
  const programIds = new Set<string>();
  const transferDestinations: string[] = [];
  for (const ix of tx.instructions) {
    const pid = ix.programId.toBase58();
    programIds.add(pid);
    const data = Buffer.from(ix.data);
    if (isSystemTransfer(pid, data)) {
      transferDestinations.push(ix.keys[1].pubkey.toBase58());
      continue;
    }
    const ti = tokenTransferDestIndex(pid, data);
    if (ti !== null && ix.keys[ti]) transferDestinations.push(ix.keys[ti].pubkey.toBase58());
  }
  return { programIds: [...programIds], transferDestinations };
}
