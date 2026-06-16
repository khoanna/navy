import { computePositionValue } from './yield-adapter';
describe('computePositionValue', () => {
  it('multiplies cToken amount by the exchange rate (lamports per cToken)', () => {
    expect(computePositionValue(1_000_000_000n, 1.05)).toBe(1_050_000_000n);
  });
  it('handles a 1.0 exchange rate', () => {
    expect(computePositionValue(2_000_000_000n, 1.0)).toBe(2_000_000_000n);
  });
});
