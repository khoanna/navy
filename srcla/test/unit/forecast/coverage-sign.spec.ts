/**
 * Coverage is the share of periods the lower bound HELD, not the share it was
 * breached. Five call sites computed the complement and named it `coverage`;
 * one of them fed `evaluateReleaseGates`, whose gate fails when
 * `coverage < minCoverage` — so the gate passed only when coverage was bad.
 *
 * Every case below is asymmetric on purpose (9 held, 1 breached). A symmetric
 * fixture cannot tell the two definitions apart, which is how the inversion
 * survived: reverting any of these three sites left the whole suite green.
 */
import { calculateForecastMetrics } from '../../../src/evaluation/metrics/forecast.js';
import { CoverageTracker } from '../../../src/evaluation/coverage-tracker.js';
import { RollingForecast } from '../../../src/forecast/rolling.js';
import { WAD } from '../../../src/protocols/math.js';

/** 9 of 10 actuals sit above the bound → coverage 0.9, breach rate 0.1. */
const HELD = 9;
const BREACHED = 1;
const BOUND = WAD;
const ABOVE = WAD + 10_000_000_000_000_000n; // clears the bound
const BELOW = WAD - 10_000_000_000_000_000n; // breaches it

describe('coverage is the hit rate, not the breach rate', () => {
  it('calculateForecastMetrics reports 0.9, not 0.1', () => {
    const predictions = Array.from({ length: HELD + BREACHED }, () => ({
      lowerReturn: BOUND,
      meanReturn: BOUND + 20_000_000_000_000_000n,
    }));
    const realized = [
      ...Array.from({ length: HELD }, () => ABOVE),
      ...Array.from({ length: BREACHED }, () => BELOW),
    ];

    const m = calculateForecastMetrics(predictions, realized);
    expect(m.coverage).toBeCloseTo(0.9, 10);
    // The inverted definition would give 0.1 — assert it explicitly so a
    // regression cannot pass by drifting to "some number near zero".
    expect(m.coverage).not.toBeCloseTo(0.1, 10);
  });

  it('a bound that ALWAYS holds is coverage 1, and one always breached is 0', () => {
    const preds = Array.from({ length: 5 }, () => ({
      lowerReturn: BOUND,
      meanReturn: BOUND,
    }));
    expect(
      calculateForecastMetrics(preds, Array.from({ length: 5 }, () => ABOVE)).coverage,
    ).toBe(1);
    expect(
      calculateForecastMetrics(preds, Array.from({ length: 5 }, () => BELOW)).coverage,
    ).toBe(0);
  });

  it('CoverageTracker agrees with its own `covered` bookkeeping', () => {
    const tracker = new CoverageTracker();
    const t0 = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < HELD; i++) {
      tracker.recordOutcome('compound', new Date(t0.getTime() + i * 86_400_000), BOUND, ABOVE, 86_400);
    }
    for (let i = 0; i < BREACHED; i++) {
      tracker.recordOutcome('compound', new Date(t0.getTime() + (HELD + i) * 86_400_000), BOUND, BELOW, 86_400);
    }

    // calculateCoverage counts `covered` records directly and was already
    // correct; calculateForecastMetrics recomputed it and was inverted. The
    // two must not disagree - that disagreement WAS the bug.
    const viaRecords = tracker.calculateCoverage('compound').coverage;
    const viaMetrics = tracker.calculateForecastMetrics('compound').coverage;
    expect(viaMetrics).toBeCloseTo(0.9, 10);
    expect(viaMetrics).toBeCloseTo(viaRecords, 10);
  });

  it('RollingForecast penalises UNDER-coverage, not over-coverage', () => {
    const forecaster = new RollingForecast({ windowDays: 30, quantile: 0.05 });
    const mk = (n: number) =>
      Array.from({ length: n }, () => ({
        marketId: 'rolling',
        horizon: 86_400,
        meanReturn: BOUND,
        lowerReturn: BOUND,
        coverage: 0.95,
        method: 'rolling',
        config: {},
      })) as never;

    // A bound breached 8 times in 10 is badly under-covered (0.2 vs 0.95).
    const bad = forecaster.calculateLoss(mk(10), [
      ...Array.from({ length: 2 }, () => ABOVE),
      ...Array.from({ length: 8 }, () => BELOW),
    ]);
    // A bound that always holds meets the nominal level.
    const good = forecaster.calculateLoss(mk(10), Array.from({ length: 10 }, () => ABOVE));

    expect(bad.coverage).toBeCloseTo(0.2, 10);
    expect(good.coverage).toBe(1);
    // The whole point: the badly-covered forecaster must score WORSE. Under the
    // old form the penalty was max(0, 0.05 - breachRate), which charged the
    // good forecaster and let a bound breached 80% of the time through free.
    expect(bad.loss).toBeGreaterThan(good.loss);
  });
});
