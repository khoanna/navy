import { supplyRateAt, forecastUtilization, stateSpaceForecast } from '../../../src/forecast/state-space.js';

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;

const comet = {
  baseRateWad: 0n,
  kinkRay: (RAY * 90n) / 100n,          // Compound Base USDC: 90%, NOT the 80% placeholder
  slopeLowWad: (WAD * 36n) / 1000n,     // ~3.6%
  slopeHighWad: (WAD * 30n) / 100n,
  reserveFactorBps: 0,
};

describe('P19: state-space forecast', () => {
  it('reproduces the kinked curve below, at and above the kink', () => {
    const below = supplyRateAt((WAD * 50n) / 100n, comet);
    const atKink = supplyRateAt((WAD * 90n) / 100n, comet);
    const above = supplyRateAt((WAD * 95n) / 100n, comet);
    expect(below).toBeLessThan(atKink);
    expect(atKink).toBeLessThan(above);
    // slope above the kink is strictly steeper
    const slopeBelow = atKink - below;
    const slopeAbove = above - atKink;
    expect(slopeAbove * 10n).toBeGreaterThan(slopeBelow);
  });

  it('mean-reverts utilization toward the window mean', () => {
    const flat = Array<bigint>(48).fill((WAD * 70n) / 100n);
    expect(forecastUtilization(flat, { halfLifeObservations: 24 })).toBe((WAD * 70n) / 100n);
    const spiked = [...flat, (WAD * 99n) / 100n];
    const f = forecastUtilization(spiked, { halfLifeObservations: 24 });
    expect(f).toBeGreaterThan((WAD * 70n) / 100n);
    expect(f).toBeLessThan((WAD * 99n) / 100n);   // reverts, does not chase
  });

  it('REFUSES to extrapolate outside the observed utilization range', () => {
    const hist = Array<bigint>(48).fill((WAD * 70n) / 100n);
    const out = stateSpaceForecast(hist, comet, { halfLifeObservations: 24 },
      { minWad: (WAD * 60n) / 100n, maxWad: (WAD * 75n) / 100n });
    const clampedAtMax = supplyRateAt((WAD * 75n) / 100n, comet);
    expect(out).toBeLessThanOrEqual(clampedAtMax);
  });

  it('a governance reparameterization changes the map, not the state history', () => {
    const hist = Array<bigint>(48).fill((WAD * 70n) / 100n);
    const steeper = { ...comet, slopeLowWad: comet.slopeLowWad * 2n };
    const a = stateSpaceForecast(hist, comet, { halfLifeObservations: 24 }, { minWad: 0n, maxWad: WAD });
    const b = stateSpaceForecast(hist, steeper, { halfLifeObservations: 24 }, { minWad: 0n, maxWad: WAD });
    expect(b).toBeGreaterThan(a);
  });
});
