import { verifyMessage, isAddress } from 'ethers';

/**
 * Verify that `signature` is an EIP-191 personal_sign of `message` produced by `address`.
 * Case-insensitive on the address; returns false on any malformed input (never throws).
 */
export function verifyWalletSignature(address: string, message: string, signature: string): boolean {
  try {
    return verifyMessage(message, signature).toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

/** True when `a` is a syntactically valid EVM (0x + 40 hex) address. */
export function isEvmAddress(a: string): boolean {
  return isAddress(a);
}
