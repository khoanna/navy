/**
 * Base-unit → display formatting for amounts the user is being told to *find*
 * (a gas shortfall, a USDC shortfall).
 *
 * These always round **up**. `usdcBaseToDisplay` rounds half-up, which is right
 * for showing a balance but wrong for showing a shortfall: 1 base unit short
 * would render "0.00", i.e. "top up by nothing".
 *
 * UNITS: `value` is an integer in base units of `decimals` places
 * (USDC = 6, ETH/wei = 18, navUSDC shares = 12). `dp` is how many decimal
 * places to display.
 */
export function formatBaseCeil(value: bigint, decimals: number, dp: number): string {
  if (value <= 0n) return '0';
  const base = 10n ** BigInt(decimals);
  const scale = 10n ** BigInt(dp);
  // ceil(value * 10^dp / 10^decimals)
  const units = (value * scale + base - 1n) / base;
  const whole = units / scale;
  const frac = dp > 0 ? (units % scale).toString().padStart(dp, '0').replace(/0+$/, '') : '';
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * A navUSDC share balance (12 dp) as a display string, **truncated** to `dp`
 * places — a balance must never be shown larger than it is.
 *
 * The vault's ERC-4626 `_decimalsOffset()` is 6 over a 6-decimal asset, so the
 * share token carries 12 decimals. Formatting shares with `usdcBaseToDisplay`
 * (6 dp) overstates them by a factor of 10^6.
 */
export function sharesBaseToDisplay(base: string | bigint, dp = 4): string {
  let v: bigint;
  try {
    v = typeof base === 'bigint' ? base : BigInt(base || '0');
  } catch {
    return '0';
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const scale = 10n ** BigInt(12 - dp);
  const units = v / scale; // truncate, never round up
  const whole = units / 10n ** BigInt(dp);
  const frac = (units % 10n ** BigInt(dp)).toString().padStart(dp, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
