import { PublicKey } from '@solana/web3.js';
import { configPda, merchantPda, invoicePda } from './payments-client';

const PROGRAM = new PublicKey('5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az');

describe('payments-client PDAs', () => {
  it('derives the config PDA deterministically', () => {
    expect(configPda(PROGRAM).equals(configPda(PROGRAM))).toBe(true);
  });
  it('derives distinct merchant PDAs per authority', () => {
    // NOTE: '111...1' (32 ones) IS PublicKey.default (all-zero bytes); use a
    // genuinely distinct address so PDAs are different as the test intends.
    const m1 = merchantPda(PROGRAM, new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
    const m2 = merchantPda(PROGRAM, PublicKey.default);
    expect(m1.equals(m2)).toBe(false);
  });
  it('derives the invoice PDA from authority + invoice_id', () => {
    const id = Array.from(Buffer.alloc(16, 7));
    expect(invoicePda(PROGRAM, PublicKey.default, id)).toBeInstanceOf(PublicKey);
  });
});
