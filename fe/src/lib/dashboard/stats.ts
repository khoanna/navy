// fe/src/lib/dashboard/stats.ts
const USDC_DECIMALS = 6;

/** Format a base-unit integer string (6 decimals) as a grouped USDC amount. Pure string math. */
export function formatUsdc(baseUnits: string): string {
  const neg = baseUnits.startsWith('-');
  const digits = (neg ? baseUnits.slice(1) : baseUnits).replace(/\D/g, '') || '0';
  const padded = digits.padStart(USDC_DECIMALS + 1, '0');
  const whole = padded.slice(0, padded.length - USDC_DECIMALS);
  const frac = padded.slice(padded.length - USDC_DECIMALS).replace(/0+$/, '');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${groupedWhole}.${frac}` : groupedWhole;
  return neg && body !== '0' ? `-${body}` : body;
}

/** Rounded percentage change from `base` to `current`; null when base is 0/undefined. */
export function pctDelta(current: number, base: number): number | null {
  if (!base) return null;
  return Math.round(((current - base) / base) * 100);
}
