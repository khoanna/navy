/**
 * Parse USDC string to BigInt (6 decimals)
 * @example parseUsdc('100.50') => 100500000n
 */
export function parseUsdc(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  const padded = fraction.padEnd(6, '0').slice(0, 6);
  return BigInt(whole + padded);
}

/**
 * Format BigInt to USDC string (6 decimals, trailing zeros stripped, min 2 decimals shown)
 * @example formatUsdc(100500000n) => '100.50'
 */
export function formatUsdc(value: bigint): string {
  const str = value.toString().padStart(7, '0');
  const whole = str.slice(0, -6) || '0';
  const fraction = str.slice(-6);
  // Strip trailing zeros but keep at least 2 decimal places
  const trimmed = fraction.replace(/0+$/, '');
  const minFraction = trimmed.length >= 2 ? trimmed : fraction.slice(0, 2);
  return `${whole}.${minFraction}`;
}

/**
 * Convert basis points to fraction
 * @example bpsToFraction(100n) => 0.01
 */
export function bpsToFraction(bps: bigint): number {
  return Number(bps) / 10000;
}

/**
 * Calculate basis points of an amount
 * @example calcBps(1000e6, 100n) => 1e6 (1% of 1000 USDC)
 */
export function calcBps(amount: bigint, bps: bigint): bigint {
  return (amount * bps) / 10000n;
}

/**
 * Safe BigInt comparison
 */
export function bigintLt(a: bigint, b: bigint): boolean { return a < b; }
export function bigintLte(a: bigint, b: bigint): boolean { return a <= b; }
export function bigintGt(a: bigint, b: bigint): boolean { return a > b; }
export function bigintGte(a: bigint, b: bigint): boolean { return a >= b; }

/**
 * Clamp value between min and max
 */
export function bigintClamp(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
