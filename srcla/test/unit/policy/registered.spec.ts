import {
  REGISTERED_HORIZONS_SECONDS,
  REGISTERED_COVERAGE_TARGETS,
  REGISTERED_TIERS_BASE,
  ABLATION_IDS,
  BURNED_WINDOW,
} from '../../../src/policy/registered.js';

describe('registered policy constants (paper Appendix B)', () => {
  it('uses horizons of 1, 7 and 14 days', () => {
    expect(REGISTERED_HORIZONS_SECONDS).toEqual([86_400, 604_800, 1_209_600]);
  });

  it('uses coverage targets of 90, 95 and 99 percent', () => {
    expect(REGISTERED_COVERAGE_TARGETS).toEqual([0.9, 0.95, 0.99]);
  });

  it('uses tiers of 10k, 100k, 1M and 10M USDC in base units', () => {
    expect(REGISTERED_TIERS_BASE).toEqual([
      10_000_000_000n,
      100_000_000_000n,
      1_000_000_000_000n,
      10_000_000_000_000n,
    ]);
  });

  it('registers seven ablations', () => {
    expect(ABLATION_IDS).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']);
  });

  it('records the burned window that must stay in the calibration era', () => {
    expect(BURNED_WINDOW.startIso).toBe('2026-05-26T00:00:00.000Z');
    expect(BURNED_WINDOW.endIso).toBe('2026-08-23T23:59:59.999Z');
  });
});
