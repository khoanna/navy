import {
  DEFAULT_CADENCE_SECONDS,
  enumerateOrigins,
} from '../../../../src/collector/archive/backfill.js';

const HOUR = 3600;

describe('enumerateOrigins', () => {
  it('emits one origin per cadence, inclusive of both ends', () => {
    expect(enumerateOrigins(0, 3 * HOUR, HOUR)).toEqual([0, HOUR, 2 * HOUR, 3 * HOUR]);
  });

  it('defaults to the hourly cadence the paper registers', () => {
    expect(DEFAULT_CADENCE_SECONDS).toBe(3600);
    expect(enumerateOrigins(0, 2 * HOUR)).toHaveLength(3);
  });

  it('ALIGNS to the cadence grid, so a resumed run reproduces the same origins', () => {
    // The load-bearing property. A resumed run whose origins are offset from
    // the first run's produces two interleaved half-datasets that look like
    // one dense dataset, and deriveCompletedLabels would average rates across
    // an irregular grid without complaining.
    const start = 1_725_148_800; // 2024-09-01T00:00:00Z, already hour-aligned
    const full = enumerateOrigins(start, start + 86_400, HOUR);
    // Resume from a NON-aligned instant halfway through.
    const resumed = enumerateOrigins(start + 43_200 + 137, start + 86_400, HOUR);
    expect(resumed.every((t) => full.includes(t))).toBe(true);
    expect(full.filter((t) => t >= start + 43_200 + 137)).toEqual(resumed);
  });

  it('produces grid points divisible by the cadence regardless of the start instant', () => {
    for (const start of [0, 1, 59, 1_725_148_801, 1_725_150_000]) {
      for (const t of enumerateOrigins(start, start + 5 * HOUR, HOUR)) {
        expect(t % HOUR).toBe(0);
      }
    }
  });

  it('yields ~8760 origins for a year and ~17700 for the registered two-year window', () => {
    const year = enumerateOrigins(1_725_148_800, 1_725_148_800 + 365 * 86_400, HOUR);
    expect(year.length).toBeGreaterThan(8_750);
    expect(year.length).toBeLessThan(8_770);
  });

  it('rejects a cadence that drifts against the hourly grid', () => {
    expect(() => enumerateOrigins(0, HOUR, 700)).toThrow(/drifts|divides/i);
  });

  it('rejects a non-positive or fractional cadence', () => {
    expect(() => enumerateOrigins(0, HOUR, 0)).toThrow(/positive/i);
    expect(() => enumerateOrigins(0, HOUR, -60)).toThrow(/positive/i);
    expect(() => enumerateOrigins(0, HOUR, 1.5)).toThrow(/positive integer/i);
  });

  it('rejects a reversed window rather than returning an empty one', () => {
    // An empty result would read as "nothing to do" and the run would report
    // success having collected nothing.
    expect(() => enumerateOrigins(HOUR, 0, HOUR)).toThrow(/precede/i);
  });

  it('accepts a sub-hour cadence that divides an hour', () => {
    expect(enumerateOrigins(0, HOUR, 900)).toEqual([0, 900, 1800, 2700, 3600]);
  });
});
