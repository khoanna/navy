import { computeFundAmount } from '../../../src/farming/funding.util';

const bounds = { reserve: 5_000_000n, fundMin: 10_000_000n, fundMax: 1_000_000_000n };

describe('computeFundAmount', () => {
  it('returns null when spare (balance - reserve) is below fundMin', () => {
    expect(computeFundAmount(5_000_000n, bounds)).toBeNull();       // spare 0
    expect(computeFundAmount(14_000_000n, bounds)).toBeNull();      // spare 9m < 10m
  });
  it('returns spare when between fundMin and fundMax', () => {
    expect(computeFundAmount(25_000_000n, bounds)).toBe(20_000_000n); // spare 20m
  });
  it('clamps to fundMax when spare exceeds it', () => {
    expect(computeFundAmount(2_000_000_000n, bounds)).toBe(1_000_000_000n);
  });
});
