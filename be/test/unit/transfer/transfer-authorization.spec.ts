import { ethers } from 'ethers';
import {
  buildTransferTypedData, transferDigest, recoverTransferSigner, randomNonce,
} from '../../../src/transfer/transfer-authorization';

const domain = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };

describe('transfer-authorization', () => {
  it('round-trips: a wallet signature over the typed data recovers the signer', async () => {
    const w = ethers.Wallet.createRandom();
    const td = buildTransferTypedData({
      domain, from: w.address, to: '0x000000000000000000000000000000000000dEaD',
      amount: 1_000000n, validAfter: 0, validBefore: 9999999999, nonce: randomNonce(),
    });
    const sig = await w.signTypedData(td.domain, td.types as any, td.message);
    expect(recoverTransferSigner(td, sig).toLowerCase()).toBe(w.address.toLowerCase());
  });
  it('digest equals ethers TypedDataEncoder.hash', () => {
    const td = buildTransferTypedData({
      domain, from: '0x000000000000000000000000000000000000bEEF',
      to: '0x000000000000000000000000000000000000dEaD',
      amount: 5n, validAfter: 0, validBefore: 100, nonce: randomNonce(),
    });
    expect(transferDigest(td)).toBe(ethers.TypedDataEncoder.hash(td.domain, td.types as any, td.message));
  });
  it('randomNonce is a 0x 32-byte hex', () => {
    expect(randomNonce()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
