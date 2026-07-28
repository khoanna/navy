import { ethers } from 'ethers';
import {
  buildDepositAuthorizationTypedData,
  depositAuthorizationDigest,
  recoverDepositSigner,
  buildRedeemPermitTypedData,
  redeemPermitDigest,
  recoverRedeemSigner,
  randomNonce,
} from './vault-authorization';

const usdcDomain = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
const vaultDomain = { name: 'Navy Vault USDC', version: '1', chainId: 11155111, verifyingContract: '0x000000000000000000000000000000000000b0a7' };

describe('vault deposit authorization (EIP-3009 ReceiveWithAuthorization)', () => {
  it('round-trips: a wallet signs the typed data, and the digest recovers that wallet', async () => {
    const w = ethers.Wallet.createRandom();
    const td = buildDepositAuthorizationTypedData({
      domain: usdcDomain,
      from: w.address,
      to: '0x000000000000000000000000000000000000b0a7',
      amount: 1_000_000n,
      validAfter: 0,
      validBefore: Math.floor(Date.now() / 1000) + 3600,
      nonce: randomNonce(),
    });
    const sig = await w.signTypedData(td.domain, td.types, td.message);
    expect(recoverDepositSigner(td, sig).toLowerCase()).toBe(w.address.toLowerCase());
    expect(depositAuthorizationDigest(td)).toBe(ethers.TypedDataEncoder.hash(td.domain, td.types, td.message));
  });
});

describe('vault redeem permit (EIP-2612 Permit on the share token)', () => {
  it('round-trips: owner signs Permit(owner, spender, value, nonce, deadline)', async () => {
    const w = ethers.Wallet.createRandom();
    const spender = '0x000000000000000000000000000000000000dEaD';
    const td = buildRedeemPermitTypedData({
      domain: vaultDomain,
      owner: w.address,
      spender,
      value: 500_000n,
      nonce: 0n,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    const sig = await w.signTypedData(td.domain, td.types, td.message);
    expect(recoverRedeemSigner(td, sig).toLowerCase()).toBe(w.address.toLowerCase());
    expect(redeemPermitDigest(td)).toBe(ethers.TypedDataEncoder.hash(td.domain, td.types, td.message));
  });
});

describe('randomNonce', () => {
  it('produces a 32-byte hex string', () => {
    expect(randomNonce()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
