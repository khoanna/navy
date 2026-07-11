import { SystemProgram, Transaction, Keypair, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { deriveTxSummary } from './tx-summary';
import { DelegatedPolicyValidator } from './delegated-policy.validator';

const sub = Keypair.generate().publicKey;
const user = Keypair.generate().publicKey;
const ctx = { subwallet: sub.toBase58(), minLamports: 1000n, maxLamports: 1_000_000n };

function summaryOf(tx: Transaction) { return deriveTxSummary(tx); }

describe('DelegatedPolicyValidator', () => {
  const v = new DelegatedPolicyValidator();

  it('allows a single bounded system-transfer to the subwallet', () => {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 5000 }));
    expect(v.check(summaryOf(tx), ctx)).toEqual({ ok: true });
  });
  it('denies when there is more than one instruction', () => {
    const tx = new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 5000 }))
      .add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 5000 }));
    expect(v.check(summaryOf(tx), ctx).ok).toBe(false);
  });
  it('denies a transfer to a destination other than the subwallet', () => {
    const other = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: other, lamports: 5000 }));
    expect(v.check(summaryOf(tx), ctx).ok).toBe(false);
  });
  it('denies an amount below min or above max', () => {
    const low = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 500 }));
    const high = new Transaction().add(SystemProgram.transfer({ fromPubkey: user, toPubkey: sub, lamports: 2_000_000 }));
    expect(v.check(summaryOf(low), ctx).ok).toBe(false);
    expect(v.check(summaryOf(high), ctx).ok).toBe(false);
  });
  it('denies a non-system-program instruction', () => {
    const ix = new TransactionInstruction({ keys: [], programId: TOKEN_PROGRAM_ID, data: Buffer.alloc(0) });
    const tx = new Transaction().add(ix);
    expect(v.check(summaryOf(tx), ctx).ok).toBe(false);
  });
});
