// fe/src/lib/dashboard/stats.test.ts
import { formatUsdc, pctDelta } from './stats';

describe('formatUsdc', () => {
  it('formats base-unit strings (6 decimals) into grouped USDC, trimming trailing zeros', () => {
    expect(formatUsdc('1500000')).toBe('1.5');
    expect(formatUsdc('1000000')).toBe('1');
    expect(formatUsdc('1234567')).toBe('1.234567');
    expect(formatUsdc('0')).toBe('0');
    expect(formatUsdc('1000000000')).toBe('1,000');
  });

  it('is safe on large values (no float precision loss)', () => {
    expect(formatUsdc('123456789000000')).toBe('123,456,789');
  });
});

describe('pctDelta', () => {
  it('computes a rounded percentage change, guarding a zero base', () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(80, 100)).toBe(-20);
    expect(pctDelta(5, 0)).toBe(null); // undefined base -> no delta
  });
});
