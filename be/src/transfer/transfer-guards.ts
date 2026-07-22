import { ethers } from 'ethers';
import { normalizeUsername, isValidUsername } from '../common/username';

export type Recipient = { kind: 'address'; value: string } | { kind: 'username'; value: string };

/** Classify a recipient string: a valid 0x address, or a normalized @username, else null. */
export function parseRecipient(input: string): Recipient | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  if (s.startsWith('0x') || /^0x/i.test(s)) {
    return ethers.isAddress(s) ? { kind: 'address', value: ethers.getAddress(s) } : null;
  }
  const u = normalizeUsername(s);
  return isValidUsername(u) ? { kind: 'username', value: u } : null;
}

export function assertNotSelfTransfer(from: string, to: string): void {
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('Cannot transfer to yourself');
}

export function assertSufficientBalance(balance: bigint, amount: bigint): void {
  if (balance < amount) throw new Error('Insufficient USDC balance');
}
