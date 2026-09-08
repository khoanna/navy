/**
 * A shortfall must never round DOWN — that would tell the user to top up by
 * less than they actually need, or by nothing at all. Every case below fails
 * if `formatBaseCeil` is replaced by a half-up or floor rounding.
 */
import { formatBaseCeil, sharesBaseToDisplay } from './amounts';

describe('formatBaseCeil', () => {
  it('rounds a sub-cent USDC shortfall UP to one cent, not down to zero', () => {
    // 1 USDC base unit = 0.000001 USDC. Half-up at 2 dp would give "0.00".
    expect(formatBaseCeil(1n, 6, 2)).toBe('0.01');
  });

  it('rounds 0.004 USDC up to 0.01 (half-up would give 0.00)', () => {
    expect(formatBaseCeil(4_000n, 6, 2)).toBe('0.01');
  });

  it('leaves an exactly representable amount alone', () => {
    expect(formatBaseCeil(1_500_000n, 6, 2)).toBe('1.5');
    expect(formatBaseCeil(2_000_000n, 6, 2)).toBe('2');
  });

  it('rounds 1.001 USDC up to 1.01 rather than back to 1.00', () => {
    expect(formatBaseCeil(1_001_000n, 6, 2)).toBe('1.01');
  });

  it('renders zero and negatives as "0"', () => {
    expect(formatBaseCeil(0n, 6, 2)).toBe('0');
    expect(formatBaseCeil(-5n, 6, 2)).toBe('0');
  });

  it('handles 18-decimal wei at 6 dp', () => {
    expect(formatBaseCeil(10n ** 18n, 18, 6)).toBe('1');
    expect(formatBaseCeil(1n, 18, 6)).toBe('0.000001'); // 1 wei still shows as non-zero
  });

  it('handles 12-decimal vault shares', () => {
    expect(formatBaseCeil(1_500_000_000_000n, 12, 4)).toBe('1.5');
    expect(formatBaseCeil(1n, 12, 4)).toBe('0.0001');
  });

  it('supports dp = 0 (whole units, rounded up)', () => {
    expect(formatBaseCeil(1_000_001n, 6, 0)).toBe('2');
    expect(formatBaseCeil(1_000_000n, 6, 0)).toBe('1');
  });

  it('keeps precision far beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 123_456_789_012_345_678_901_234n; // 1.23456789012345678901234e+23 base units
    expect(formatBaseCeil(huge, 6, 2)).toBe('123456789012345678.91');
  });
});

describe('sharesBaseToDisplay', () => {
  it('treats shares as 12 dp, not 6 — the ERC-4626 offset is 6 over a 6 dp asset', () => {
    // 1_000_000 base units is 0.000001 shares at 12 dp; at 6 dp it would read "1.00".
    expect(sharesBaseToDisplay(1_000_000n)).toBe('0');
    expect(sharesBaseToDisplay(1_000_000_000_000n)).toBe('1');
  });

  it('renders a fractional share balance', () => {
    expect(sharesBaseToDisplay(1_500_000_000_000n)).toBe('1.5');
    expect(sharesBaseToDisplay(2_250_000_000_000n)).toBe('2.25');
  });

  it('TRUNCATES rather than rounding up — a balance must never be overstated', () => {
    // 1.99999 shares at 4 dp is 1.9999, not 2.
    expect(sharesBaseToDisplay(1_999_990_000_000n)).toBe('1.9999');
  });

  it('accepts a decimal string as the backend sends it', () => {
    expect(sharesBaseToDisplay('3000000000000')).toBe('3');
  });

  it('renders zero and malformed input as "0"', () => {
    expect(sharesBaseToDisplay('0')).toBe('0');
    expect(sharesBaseToDisplay('')).toBe('0');
    expect(sharesBaseToDisplay('not-a-number')).toBe('0');
  });

  it('honours a custom precision', () => {
    expect(sharesBaseToDisplay(1_234_567_890_123n, 6)).toBe('1.234567');
  });

  it('keeps the sign on a negative balance', () => {
    expect(sharesBaseToDisplay(-1_500_000_000_000n)).toBe('-1.5');
  });
});
