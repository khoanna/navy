import { exp, compound, utilization, annualize, expRate, SECONDS_PER_YEAR, RAY } from '../../../src/protocols/math.js';

describe('Protocol Math', () => {
  it('should calculate exponential growth correctly', () => {
    const rate = 50000000000000000n; // 5% per year in WAD
    const result = exp(1_000_000_000_000n, rate, SECONDS_PER_YEAR);
    // result is ~1.05127 × 1e12 (1,051,271 USDC for 1,000,000 USDC principal)
    const scaled = Number(result) / 1e12;
    expect(scaled).toBeCloseTo(1.05127, 4);
  });

  it('should calculate compound interest', () => {
    // 1000 USDC = 1_000_000_000n in 6-decimal units
    const principal = 1_000_000_000n;
    const rate = 50000000000000000n; // 5% APY
    const year = SECONDS_PER_YEAR;

    const result = compound(principal, rate, year);
    // 1000 * e^0.05 ≈ 1051.27 USDC
    const asUsdc = Number(result) / 1e6;
    expect(asUsdc).toBeCloseTo(1051.27, 1);
    // Verify exact raw value: 1000 * e^0.05 * 1e6 ≈ 1_051_271_096
    expect(result).toBe(1051271096n);
  });

  it('should calculate expRate correctly', () => {
    const rate = 50000000000000000n; // 5% per year in WAD
    const result = expRate(rate, SECONDS_PER_YEAR);
    // expRate returns RAY * e^x, e^0.05 ≈ 1.05127
    const asFloat = Number(result) / 1e27;
    expect(asFloat).toBeCloseTo(1.05127, 4);
  });

  it('should return RAY for zero rate', () => {
    const result = expRate(0n, SECONDS_PER_YEAR);
    expect(result).toBe(RAY);
  });

  it('should calculate utilization correctly', () => {
    const cash = 10_000_000_000_000n;
    const borrows = 5_000_000_000_000n;

    const util = utilization(cash, borrows);
    // Should be approximately 0.333... * RAY
    const asFloat = Number(util) / 1e27;
    expect(asFloat).toBeCloseTo(0.3333, 3);
  });

  it('should handle zero borrows', () => {
    expect(utilization(1000n, 0n)).toBe(0n);
  });

  it('should annualize a rate', () => {
    const rate = 10000000000000000n; // 1% per month in WAD
    const period = 2592000n; // 30 days in seconds
    const annualized = annualize(rate, period);
    // 1% per 30 days * (31557600/2592000) ≈ 12.175% APY in WAD
    const asFloat = Number(annualized) / 1e18;
    expect(asFloat).toBeCloseTo(0.12175, 4);
  });
});
