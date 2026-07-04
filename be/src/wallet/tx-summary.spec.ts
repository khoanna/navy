import { Transaction, TransactionInstruction, SystemProgram, PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { deriveTxSummary } from './tx-summary';

const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SAVE_PROGRAM_ID = new PublicKey('ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx');

function key(): PublicKey {
  return Keypair.generate().publicKey;
}

function meta(pubkey: PublicKey) {
  return { pubkey, isSigner: false, isWritable: true };
}

function wrap(ix: TransactionInstruction): Transaction {
  return new Transaction().add(ix);
}

describe('deriveTxSummary', () => {
  it('classifies a System transfer with destination = keys[1]', () => {
    const from = key();
    const to = key();
    const ix = SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 1000 });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions).toHaveLength(1);
    expect(instructions[0].kind).toBe('system-transfer');
    expect(instructions[0].destination).toBe(to.toBase58());
    expect(instructions[0].programId).toBe(SystemProgram.programId.toBase58());
  });

  it('classifies a System CreateAccount (opcode 0) as system-create', () => {
    const ix = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [meta(key()), meta(key())],
      data: Buffer.from([0, 0, 0, 0]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('system-create');
  });

  it('classifies SPL Transfer (opcode 3) with destination = keys[1]', () => {
    const source = key();
    const dest = key();
    const owner = key();
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [meta(source), meta(dest), meta(owner)],
      data: Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('token-transfer');
    expect(instructions[0].destination).toBe(dest.toBase58());
    expect(instructions[0].rawOpcode).toBe(3);
  });

  it('classifies SPL TransferChecked (opcode 12) with destination = keys[2]', () => {
    const source = key();
    const mint = key();
    const dest = key();
    const owner = key();
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [meta(source), meta(mint), meta(dest), meta(owner)],
      data: Buffer.from([12, 0, 0, 0, 0, 0, 0, 0, 0, 6]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('token-transfer');
    expect(instructions[0].destination).toBe(dest.toBase58());
    expect(instructions[0].rawOpcode).toBe(12);
  });

  it('classifies SPL CloseAccount (opcode 9) with destination = keys[1]', () => {
    const account = key();
    const dest = key();
    const owner = key();
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [meta(account), meta(dest), meta(owner)],
      data: Buffer.from([9]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('token-close');
    expect(instructions[0].destination).toBe(dest.toBase58());
    expect(instructions[0].rawOpcode).toBe(9);
  });

  it('classifies SPL Approve (opcode 4) as token-dangerous', () => {
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [meta(key()), meta(key()), meta(key())],
      data: Buffer.from([4, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('token-dangerous');
    expect(instructions[0].rawOpcode).toBe(4);
  });

  it('classifies SPL SyncNative (opcode 17) as token-sync', () => {
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [meta(key())],
      data: Buffer.from([17]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('token-sync');
    expect(instructions[0].rawOpcode).toBe(17);
  });

  it('classifies SPL InitializeAccount (opcode 1) as token-init', () => {
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [meta(key()), meta(key()), meta(key()), meta(key())],
      data: Buffer.from([1]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('token-init');
    expect(instructions[0].rawOpcode).toBe(1);
  });

  it('classifies an ATA create (empty data, ATA program) as ata-create', () => {
    const ix = new TransactionInstruction({
      programId: ATA_PROGRAM_ID,
      keys: [meta(key()), meta(key()), meta(key()), meta(key())],
      data: Buffer.from([]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('ata-create');
  });

  it('classifies an ATA CreateIdempotent (opcode 1) as ata-create', () => {
    const ix = new TransactionInstruction({
      programId: ATA_PROGRAM_ID,
      keys: [meta(key()), meta(key())],
      data: Buffer.from([1]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('ata-create');
  });

  it('classifies a Save/Solend instruction as save', () => {
    const ix = new TransactionInstruction({
      programId: SAVE_PROGRAM_ID,
      keys: [meta(key())],
      data: Buffer.from([42, 1, 2, 3]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('save');
    expect(instructions[0].programId).toBe(SAVE_PROGRAM_ID.toBase58());
  });

  it('classifies an unknown program instruction as unknown', () => {
    const ix = new TransactionInstruction({
      programId: key(),
      keys: [meta(key())],
      data: Buffer.from([9, 9, 9]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('unknown');
  });

  it('classifies an unknown System opcode as unknown', () => {
    const ix = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [meta(key())],
      data: Buffer.from([99, 0, 0, 0]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('unknown');
  });

  it('classifies an unknown token opcode as unknown but keeps rawOpcode', () => {
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [meta(key())],
      data: Buffer.from([250]),
    });
    const { instructions } = deriveTxSummary(wrap(ix));
    expect(instructions[0].kind).toBe('unknown');
    expect(instructions[0].rawOpcode).toBe(250);
  });
});
