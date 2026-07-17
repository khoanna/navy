import { ethers } from 'ethers';
import {
  merchantIdHex,
  invoiceIdHexFromOrderId,
  invoiceKey,
  buildAuthorizationTypedData,
  authorizationDigest,
  recoverAuthorizationSigner,
  type UsdcDomain,
} from './payment-authorization';

const DOMAIN: UsdcDomain = { name: 'USDC', version: '1', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
const PAYMENTS = '0x1111111111111111111111111111111111111111';

describe('payment-authorization', () => {
  it('encodes a uuid to a 16-byte 0x hex string', () => {
    expect(merchantIdHex('11111111-2222-3333-4444-555555555555')).toBe('0x11111111222233334444555555555555');
    expect(invoiceIdHexFromOrderId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('0xaaaaaaaabbbbccccddddeeeeeeeeeeee');
  });

  it('rejects a non-uuid', () => {
    expect(() => merchantIdHex('not-a-uuid')).toThrow(/invalid uuid/);
  });

  it('derives the invoice key as keccak256(merchantId ++ invoiceId), matching the contract', () => {
    const m = merchantIdHex('11111111-2222-3333-4444-555555555555');
    const i = invoiceIdHexFromOrderId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const expected = ethers.keccak256(ethers.concat([m, i]));
    expect(invoiceKey(m, i)).toBe(expected);
  });

  it('builds an EIP-2612 Permit whose digest a wallet signs and we recover', async () => {
    const wallet = ethers.Wallet.createRandom();
    const td = buildAuthorizationTypedData({
      domain: DOMAIN, payer: wallet.address, spender: PAYMENTS,
      amount: 1_000_000n, nonce: 0n, deadline: 9_999_999_999,
    });
    const sig = await wallet.signTypedData(td.domain, td.types, td.message);
    expect(recoverAuthorizationSigner(td, sig)).toBe(wallet.address);
    // The digest we persist equals ethers' TypedDataEncoder hash and recovers via raw ecrecover too.
    expect(ethers.recoverAddress(authorizationDigest(td), sig)).toBe(wallet.address);
  });

  it('recovers a DIFFERENT address for a tampered amount (signature no longer matches)', async () => {
    const wallet = ethers.Wallet.createRandom();
    const signed = buildAuthorizationTypedData({ domain: DOMAIN, payer: wallet.address, spender: PAYMENTS, amount: 1_000_000n, nonce: 0n, deadline: 9_999_999_999 });
    const sig = await wallet.signTypedData(signed.domain, signed.types, signed.message);
    const tampered = buildAuthorizationTypedData({ domain: DOMAIN, payer: wallet.address, spender: PAYMENTS, amount: 2_000_000n, nonce: 0n, deadline: 9_999_999_999 });
    expect(recoverAuthorizationSigner(tampered, sig)).not.toBe(wallet.address);
  });
});
