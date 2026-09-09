import { K_CANDIDATES } from '../../../src/policy/registered.js';

describe('P8 no-trade band candidates', () => {
  it('searches BELOW the previous grid, where the evidence points', () => {
    // The old grid's smallest non-zero value, 0.25, already blocked 99.28% of
    // moves on the calibration era. A grid whose whole non-zero range is
    // saturated cannot find an optimum.
    expect(K_CANDIDATES).toContain(0.05);
    expect(K_CANDIDATES).toContain(0.1);
    expect(Math.min(...K_CANDIDATES.filter((k) => k > 0))).toBeLessThanOrEqual(0.05);
  });

  it('keeps 0 as a legitimate outcome', () => {
    // k=0 means the band earns nothing on this data. That is a finding about
    // P8, to be reported, not an error to be excluded.
    expect(K_CANDIDATES).toContain(0);
  });

  it('is sorted ascending, so ties break toward the smaller band', () => {
    expect([...K_CANDIDATES].sort((a, b) => a - b)).toEqual([...K_CANDIDATES]);
  });
});
