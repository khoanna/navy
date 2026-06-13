import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/** Verify that `signatureB58` over `message` was produced by `addressB58`. */
export function verifyWalletSignature(addressB58: string, message: string, signatureB58: string): boolean {
  try {
    const pubkey = new PublicKey(addressB58).toBytes();
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signatureB58),
      pubkey,
    );
  } catch { return false; }
}
