import {
  REGISTERED_COVERAGE_FLOOR,
  REGISTERED_STRESS_DEMAND_BPS,
  stressedCoverage,
} from '../../../src/policy/steps/coverage.js';

const M = (o: Record<string, bigint>) => new Map(Object.entries(o));

describe('stressedCoverage', () => {
  it('counts idle as fully liquid', () => {
    const r = stressedCoverage({
      holdings: M({}), idleBase: 1_000_000n,
      venueCashByMarket: M({}), totalAssetsBase: 1_000_000n,
    });
    expect(r.worst).toBe(1);
    expect(r.liquidBase).toBe(1_000_000n);
  });

  it('credits only the venue cash IN EXCESS of our own balance', () => {
    // We hold 500 in a venue with 600 cash: 100 is external, so our
    // conservative exit is min(500, 100) = 100. This is the "assume our own
    // supplied cash is borrowed out" rule §11.4 grades on.
    const r = stressedCoverage({
      holdings: M({ a: 500n }), idleBase: 0n,
      venueCashByMarket: M({ a: 600n }), totalAssetsBase: 500n,
    });
    expect(r.liquidBase).toBe(100n);
  });

  it('credits nothing when the venue holds no more than we do', () => {
    const r = stressedCoverage({
      holdings: M({ a: 500n }), idleBase: 0n,
      venueCashByMarket: M({ a: 500n }), totalAssetsBase: 500n,
    });
    expect(r.liquidBase).toBe(0n);
    expect(r.worst).toBe(0);
  });

  it('caps the credit at our own balance', () => {
    const r = stressedCoverage({
      holdings: M({ a: 100n }), idleBase: 0n,
      venueCashByMarket: M({ a: 10_000n }), totalAssetsBase: 100n,
    });
    expect(r.liquidBase).toBe(100n);
  });

  it('is worst-case over the registered demand set, which the 50% leg dominates', () => {
    const r = stressedCoverage({
      holdings: M({}), idleBase: 250n,
      venueCashByMarket: M({}), totalAssetsBase: 1000n,
    });
    // 250 liquid against demands of 50/100/250/500 -> worst is 250/500 = 0.5
    expect(r.worst).toBeCloseTo(0.5, 12);
    expect(r.byDemand.map((d) => d.demandBps)).toEqual([...REGISTERED_STRESS_DEMAND_BPS]);
  });

  it('returns 1 for an empty vault rather than dividing by zero', () => {
    expect(stressedCoverage({
      holdings: M({}), idleBase: 0n, venueCashByMarket: M({}), totalAssetsBase: 0n,
    }).worst).toBe(1);
  });

  it('registers the floor at the value §11.4 grades', () => {
    expect(REGISTERED_COVERAGE_FLOOR).toBe(0.99);
    expect(REGISTERED_STRESS_DEMAND_BPS).toEqual([500, 1000, 2500, 5000]);
  });

  it('is pure — the same inputs give the same answer', () => {
    const args = {
      holdings: M({ a: 300n, b: 200n }), idleBase: 50n,
      venueCashByMarket: M({ a: 900n, b: 250n }), totalAssetsBase: 1000n,
    };
    expect(stressedCoverage(args)).toEqual(stressedCoverage(args));
  });
});
