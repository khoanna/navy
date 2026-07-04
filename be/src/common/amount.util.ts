import { BadRequestException } from '@nestjs/common';

/**
 * Parse a user-supplied base-unit amount string into a positive BigInt.
 * Rejects missing / non-integer / non-positive input with a clean 400 instead
 * of letting `BigInt('abc')` throw an unhandled 500 (info leak / easy DoS).
 */
export function parsePositiveAmount(raw: unknown, field = 'amount'): bigint {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new BadRequestException(`${field} must be a base-unit integer string`);
  }
  const value = BigInt(raw);
  if (value <= 0n) throw new BadRequestException(`${field} must be greater than zero`);
  return value;
}

/** Clamp a query pagination value to a safe range, defaulting on garbage input. */
export function parsePageSize(raw: string | undefined, def = 50, max = 200): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

export function parseOffset(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
