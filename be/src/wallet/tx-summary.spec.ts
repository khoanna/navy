import { Transaction, SystemProgram, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createTransferInstruction, createTransferCheckedInstruction } from '@solana/spl-token';
import { deriveTxSummary } from './tx-summary';

describe('deriveTxSummary', () => {
  it('collects program ids from every instruction', () => {
    const a = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: a, toPubkey: PublicKey.default, lamports: 1 }));
    expect(deriveTxSummary(tx).programIds).toContain(SystemProgram.programId.toBase58());
  });
  it('extracts the destination of a SystemProgram.transfer', () => {
    const from = Keypair.generate().publicKey; const to = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 5 }));
    expect(deriveTxSummary(tx).transferDestinations).toEqual([to.toBase58()]);
  });
  it('extracts the destination of an SPL token Transfer', () => {
    const src = Keypair.generate().publicKey, dst = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
    const tx = new Transaction().add(createTransferInstruction(src, dst, owner, 10));
    expect(deriveTxSummary(tx).transferDestinations).toContain(dst.toBase58());
  });
  it('extracts the destination of an SPL token TransferChecked', () => {
    const src = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, dst = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
    const tx = new Transaction().add(createTransferCheckedInstruction(src, mint, dst, owner, 10, 6));
    expect(deriveTxSummary(tx).transferDestinations).toContain(dst.toBase58());
  });
  it('ignores non-transfer instructions but records their program id', () => {
    const prog = Keypair.generate().publicKey;
    const tx = new Transaction().add(new TransactionInstruction({ programId: prog, keys: [], data: Buffer.from([9, 9]) }));
    const s = deriveTxSummary(tx);
    expect(s.programIds).toContain(prog.toBase58());
    expect(s.transferDestinations).toEqual([]);
  });
});
