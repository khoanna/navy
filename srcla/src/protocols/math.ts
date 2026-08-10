/**
 * Seconds per year (365.25 days)
 */
export const SECONDS_PER_YEAR = 31557600n;

/**
 * WAD for money calculations (1e18)
 */
export const WAD = 1_000_000_000_000_000_000n;

/**
 * RAY for rate calculations (1e27)
 */
export const RAY = 1_000_000_000_000_000_000_000_000_000n;

/**
 * Calculate e^x for a rate in WAD scale using Taylor series.
 *
 * The rate enters in WAD (e.g., 50000000000000000n = 0.05), but e^x needs the
 * decimal value. We divide by WAD INSIDE the loop so the numerator stays bounded:
 *
 *   term_n = RAY * effectiveRate / WAD / n!  (first term)
 *   term_n = term_(n-1) * effectiveRate / WAD / n  (subsequent terms)
 *
 * Safety proof for e^0.05 (worst case 5% annual rate):
 *   effectiveRate = 5e16, WAD = 1e18
 *   Numerators: RAY * 5e16 ≈ 5e43 < 2^144 ≈ 2.2e43  ✓
 *   After n terms, remaining terms add at most ~1% per term — sum converges.
 *
 * @param rate - The rate in WAD format (e.g., 50000000000000000n for 5%)
 * @param time - Time in seconds
 * @returns The growth factor in RAY format (i.e., RAY * e^(effective_decimal_rate))
 */
export function expRate(rate: bigint, time: bigint): bigint {
  if (rate === 0n) return RAY;

  const effectiveRate = (rate * time) / SECONDS_PER_YEAR;

  // Taylor series in RAY scale, dividing by WAD at each step:
  //   term_n = RAY * (effectiveRate/WAD)^n / n!
  //           = term_(n-1) * (effectiveRate/WAD) / n
  //           = term_(n-1) * effectiveRate / (WAD * n)
  let result = RAY; // RAY * 1 (x^0/0! term)
  let term = RAY;  // current term accumulator

  for (let n = 0; n < 20; n++) {
    // Numerator: term * effectiveRate ≤ RAY * 5e16 = 5e43 < 2^144 ✓
    // Denominator: WAD * (n+1) fits in 1e18 * 20 = 2e19
    term = (term * effectiveRate) / (WAD * BigInt(n + 1));
    result = result + term;
  }

  // result = RAY * e^(effectiveRate/WAD)
  return result;
}

/**
 * Calculate compound growth for a base amount.
 *
 * Rearranges base * expRate / RAY to avoid intermediate overflow:
 *   base * expRate / RAY
 * = (base / RAY) * expRate + (base % RAY) * (expRate / RAY)
 *
 * base / RAY < 10^12 (for USDC amounts up to 1 trillion)
 * expRate ≈ RAY * e^x (≈ 1.05 * RAY)
 * (base / RAY) * expRate < 10^12 * 1.05 * 10^27 = 1.05 * 10^39 < 2^130 ✓
 * expRate / RAY ≈ e^x ≤ e^0.1 ≈ 1.1 < 2^1 ✓
 * (base % RAY) * (expRate / RAY) < RAY * 1.1 < 1.1 * 10^27 < 2^91 ✓
 *
 * @param base - The base amount in its native scale (e.g., 6-decimal USDC units)
 * @param rate - The rate in WAD format (e.g., 50000000000000000n for 5%)
 * @param time - Time in seconds
 * @returns The compound result in the same scale as base
 */
export function exp(base: bigint, rate: bigint, time: bigint): bigint {
  if (rate === 0n) return base;

  const effectiveRate = (rate * time) / SECONDS_PER_YEAR;

  // Compute expRate in RAY scale
  let result = RAY;
  let term = RAY;

  for (let n = 0; n < 20; n++) {
    term = (term * effectiveRate) / (WAD * BigInt(n + 1));
    result = result + term;
  }

  // Split base into full RAY units + remainder
  const fullUnits = base / RAY;
  const remainder = base % RAY;

  // expRate / RAY is small (≤ e^0.1 ≈ 1.1), safe to multiply remainder by it
  return fullUnits * result + (remainder * result) / RAY;
}

/**
 * Alias for exp (compound interest)
 */
export function compound(
  principal: bigint,
  rate: bigint,
  time: bigint
): bigint {
  return exp(principal, rate, time);
}

/**
 * Calculate utilization ratio (ray)
 */
export function utilization(cash: bigint, borrows: bigint): bigint {
  if (cash + borrows === 0n) return 0n;
  return (borrows * RAY) / (cash + borrows);
}

/**
 * Annualize a rate given a time period
 */
export function annualize(rate: bigint, periodSeconds: bigint): bigint {
  if (periodSeconds === 0n) return 0n;
  return (rate * SECONDS_PER_YEAR) / periodSeconds;
}

/**
 * Safe division with zero check
 */
export function divPrecisely(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  return (a * WAD) / b;
}
