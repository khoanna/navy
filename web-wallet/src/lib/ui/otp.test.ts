import { normalizeOtp, isComplete } from './otp';

describe('otp helpers', () => {
  it('keeps only digits and caps at length', () => {
    expect(normalizeOtp('12ab34', 6)).toBe('1234');
    expect(normalizeOtp('123456789', 6)).toBe('123456');
    expect(normalizeOtp('  1 2 3 ', 6)).toBe('123');
  });

  it('detects completeness at exact length', () => {
    expect(isComplete('12345', 6)).toBe(false);
    expect(isComplete('123456', 6)).toBe(true);
  });
});
