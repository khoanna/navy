import { randomBytes } from 'crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I,L,O,U)

/** Random human-facing order reference: `ORD-` + 8 Crockford-base32 chars (40 bits). */
export function generateOrderReference(): string {
  const bytes = randomBytes(5);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `ORD-${out}`;
}
