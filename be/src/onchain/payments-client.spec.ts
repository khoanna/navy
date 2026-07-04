import { PublicKey } from '@solana/web3.js';
import { configPda, merchantPda, invoicePda, merchantIdFromUuid } from './payments-client';

const PROGRAM = new PublicKey('5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az');

describe('payments-client PDAs', () => {
  it('derives the config PDA deterministically', () => {
    expect(configPda(PROGRAM).equals(configPda(PROGRAM))).toBe(true);
  });
  it('derives distinct merchant PDAs per merchant_id', () => {
    const m1 = merchantPda(PROGRAM, Array.from(Buffer.alloc(16, 1)));
    const m2 = merchantPda(PROGRAM, Array.from(Buffer.alloc(16, 2)));
    expect(m1.equals(m2)).toBe(false);
  });
  it('derives the invoice PDA from merchant_id + invoice_id', () => {
    const merchantId = Array.from(Buffer.alloc(16, 3));
    const id = Array.from(Buffer.alloc(16, 7));
    expect(invoicePda(PROGRAM, merchantId, id)).toBeInstanceOf(PublicKey);
  });
});

describe('merchantIdFromUuid', () => {
  it('produces a deterministic 16-byte array from a uuid', () => {
    const uuid = '00112233-4455-6677-8899-aabbccddeeff';
    const a = merchantIdFromUuid(uuid);
    const b = merchantIdFromUuid(uuid);
    expect(a).toHaveLength(16);
    expect(a).toEqual(b);
    expect(Buffer.from(a).toString('hex')).toBe('00112233445566778899aabbccddeeff');
  });
  it('rejects a non-uuid string', () => {
    expect(() => merchantIdFromUuid('not-a-uuid')).toThrow(/invalid uuid/);
  });
});
