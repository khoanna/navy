import { usdcInputToBaseUnits } from './money';

describe('usdcInputToBaseUnits', () => {
  it('converts whole amounts', () => {
    expect(usdcInputToBaseUnits('5')).toBe('5000000');
  });
  it('converts fractional amounts without float error', () => {
    expect(usdcInputToBaseUnits('4.56')).toBe('4560000');
    expect(usdcInputToBaseUnits('0.1')).toBe('100000');
    expect(usdcInputToBaseUnits('0.000001')).toBe('1');
  });
  it('handles leading-dot and trailing-dot forms', () => {
    expect(usdcInputToBaseUnits('.5')).toBe('500000');
    expect(usdcInputToBaseUnits('12.')).toBe('12000000');
  });
  it('preserves precision beyond 2^53', () => {
    // 10,000,000,000.500000 USDC -> would lose precision via Number
    expect(usdcInputToBaseUnits('10000000000.5')).toBe('10000000000500000');
  });
  it('rejects too many decimals', () => {
    expect(() => usdcInputToBaseUnits('1.1234567')).toThrow(/decimal/i);
  });
  it('rejects non-numeric / empty input', () => {
    expect(() => usdcInputToBaseUnits('abc')).toThrow();
    expect(() => usdcInputToBaseUnits('')).toThrow();
    expect(() => usdcInputToBaseUnits('.')).toThrow();
    expect(() => usdcInputToBaseUnits('-5')).toThrow();
  });
});
