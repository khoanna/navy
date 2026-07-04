/**
 * Convert a user-entered USDC decimal string to base units (6 decimals) using
 * string math — never floats. `parseFloat(x) * 1e6` reintroduces the exact
 * float imprecision the BigInt/string pipeline exists to avoid, and loses
 * integer precision past 2^53. Returns the base-unit amount as a decimal string.
 *
 * Throws on invalid input (non-numeric, negative, or more than 6 fractional digits).
 */
export function usdcInputToBaseUnits(input: string, decimals = 6): string {
  const trimmed = (input ?? '').trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error('Enter a valid amount');
  }
  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  if (fracRaw.length > decimals) {
    throw new Error(`At most ${decimals} decimal places are allowed`);
  }
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = fracRaw.padEnd(decimals, '0');
  // Strip leading zeros but keep at least one digit.
  const base = `${whole}${frac}`.replace(/^0+(?=\d)/, '');
  return base;
}
