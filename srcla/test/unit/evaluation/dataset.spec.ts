import { resolveReserveFactorBps } from '../../../src/evaluation/dataset.js';

describe('resolveReserveFactorBps (review round 2, fix 1)', () => {
  it('defaults a NULL reading to 0 for compound specifically', () => {
    expect(resolveReserveFactorBps('compound-v3-usdc', null)).toBe(0);
  });

  it('leaves a NULL reading undefined for aave -- a genuine missing reading, not a guess', () => {
    expect(resolveReserveFactorBps('aave-v3-usdc', null)).toBeUndefined();
  });

  it('leaves a NULL reading undefined for moonwell -- same reasoning', () => {
    expect(resolveReserveFactorBps('moonwell-usdc', null)).toBeUndefined();
  });

  it('passes through a real stored reading unchanged, for every protocol', () => {
    expect(resolveReserveFactorBps('compound-v3-usdc', 500)).toBe(500);
    expect(resolveReserveFactorBps('aave-v3-usdc', 1000)).toBe(1000);
    expect(resolveReserveFactorBps('moonwell-usdc', 1500)).toBe(1500);
  });

  it('never substitutes a stored 0 -- 0 is a real reading, not absence', () => {
    expect(resolveReserveFactorBps('aave-v3-usdc', 0)).toBe(0);
  });
});
