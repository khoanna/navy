import { Wallet } from 'ethers';
import { verifyWalletSignature, isEvmAddress } from '../../../src/common/evm-signature.util';

describe('evm-signature.util', () => {
  describe('verifyWalletSignature', () => {
    it('verifies an EIP-191 personal_sign signature for the signing address', async () => {
      const wallet = Wallet.createRandom();
      const message = 'Navy payout authorization\nmerchant: m1\nnonce: abc';
      const signature = await wallet.signMessage(message);
      expect(verifyWalletSignature(wallet.address, message, signature)).toBe(true);
    });

    it('is case-insensitive on the address', async () => {
      const wallet = Wallet.createRandom();
      const message = 'hello';
      const signature = await wallet.signMessage(message);
      expect(verifyWalletSignature(wallet.address.toLowerCase(), message, signature)).toBe(true);
      expect(verifyWalletSignature(wallet.address.toUpperCase().replace('0X', '0x'), message, signature)).toBe(true);
    });

    it('returns false for a different address', async () => {
      const wallet = Wallet.createRandom();
      const other = Wallet.createRandom();
      const message = 'hello';
      const signature = await wallet.signMessage(message);
      expect(verifyWalletSignature(other.address, message, signature)).toBe(false);
    });

    it('returns false for a wrong message', async () => {
      const wallet = Wallet.createRandom();
      const signature = await wallet.signMessage('hello');
      expect(verifyWalletSignature(wallet.address, 'goodbye', signature)).toBe(false);
    });

    it('returns false (no throw) on a garbage signature', async () => {
      const wallet = Wallet.createRandom();
      expect(verifyWalletSignature(wallet.address, 'hello', 'not-a-signature')).toBe(false);
      expect(verifyWalletSignature(wallet.address, 'hello', '0xdeadbeef')).toBe(false);
      expect(verifyWalletSignature(wallet.address, 'hello', '')).toBe(false);
    });
  });

  describe('isEvmAddress', () => {
    it('accepts a valid 0x 40-hex address', () => {
      const wallet = Wallet.createRandom();
      expect(isEvmAddress(wallet.address)).toBe(true);
      expect(isEvmAddress(wallet.address.toLowerCase())).toBe(true);
    });

    it('rejects a Solana base58 address, garbage, and empty', () => {
      expect(isEvmAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')).toBe(false);
      expect(isEvmAddress('0x123')).toBe(false);
      expect(isEvmAddress('nope')).toBe(false);
      expect(isEvmAddress('')).toBe(false);
    });
  });
});
