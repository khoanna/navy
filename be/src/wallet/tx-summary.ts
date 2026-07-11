import { Transaction, TransactionInstruction, SystemProgram, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL').toBase58();
const SAVE_PROGRAM_ID = new PublicKey('ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx').toBase58();

export type IxKind =
  | 'system-transfer'
  | 'system-create'
  | 'token-transfer'
  | 'token-close'
  | 'token-init'
  | 'token-sync'
  | 'ata-create'
  | 'save'
  | 'token-dangerous'
  | 'unknown';

export interface DecodedIx {
  programId: string;
  kind: IxKind;
  destination?: string; // set for transfers (destination pubkey) and token-close (keys[1])
  rawOpcode?: number;
  lamports?: bigint;
}

export interface TxSummary {
  instructions: DecodedIx[];
}

const TOKEN_DANGEROUS_OPCODES = new Set([4, 13, 5, 6, 7, 8, 15, 10, 11]);

function keyAt(ix: TransactionInstruction, index: number): string | undefined {
  return ix.keys[index]?.pubkey.toBase58();
}

function decodeSystem(ix: TransactionInstruction, data: Buffer, programId: string): DecodedIx {
  if (data.length < 4) return { programId, kind: 'unknown' };
  const opcode = data.readUInt32LE(0);
  if (opcode === 2) {
    const lamports = data.length >= 12 ? data.readBigUInt64LE(4) : undefined;
    return { programId, kind: 'system-transfer', destination: keyAt(ix, 1), lamports };
  }
  if (opcode === 0 || opcode === 1) {
    return { programId, kind: 'system-create' };
  }
  return { programId, kind: 'unknown' };
}

function decodeToken(ix: TransactionInstruction, data: Buffer, programId: string): DecodedIx {
  if (data.length < 1) return { programId, kind: 'unknown' };
  const opcode = data[0];
  const base: DecodedIx = { programId, kind: 'unknown', rawOpcode: opcode };
  switch (opcode) {
    case 3:
      return { ...base, kind: 'token-transfer', destination: keyAt(ix, 1) };
    case 12:
      return { ...base, kind: 'token-transfer', destination: keyAt(ix, 2) };
    case 9:
      return { ...base, kind: 'token-close', destination: keyAt(ix, 1) };
    case 1:
    case 16:
    case 18:
      return { ...base, kind: 'token-init' };
    case 17:
      return { ...base, kind: 'token-sync' };
    default:
      if (TOKEN_DANGEROUS_OPCODES.has(opcode)) return { ...base, kind: 'token-dangerous' };
      return base;
  }
}

function decodeAta(data: Buffer, programId: string): DecodedIx {
  if (data.length === 0) return { programId, kind: 'ata-create' };
  const opcode = data[0];
  if (opcode === 0 || opcode === 1) return { programId, kind: 'ata-create' };
  return { programId, kind: 'unknown' };
}

function decodeInstruction(ix: TransactionInstruction): DecodedIx {
  const programId = ix.programId.toBase58();
  const data = Buffer.from(ix.data);
  switch (programId) {
    case SYSTEM_PROGRAM_ID:
      return decodeSystem(ix, data, programId);
    case TOKEN_PROGRAM:
      return decodeToken(ix, data, programId);
    case ATA_PROGRAM_ID:
      return decodeAta(data, programId);
    case SAVE_PROGRAM_ID:
      return { programId, kind: 'save' };
    default:
      return { programId, kind: 'unknown' };
  }
}

export function deriveTxSummary(tx: Transaction): TxSummary {
  return { instructions: tx.instructions.map(decodeInstruction) };
}
