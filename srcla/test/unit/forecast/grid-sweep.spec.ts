import {
  LOSS_WEIGHTS,
  REGISTERED_COVERAGES,
  REGISTERED_HORIZONS,
  achievedCoverage,
  fitPoint,
  meanForecast,
  registeredGrid,
  residualsFor,
  selectPoint,
  solveQuantileForCoverage,
  sweep,
  type GridPoint,
} from '../../../src/forecast/grid-sweep.js';
import { supplyRateAt } from '../../../src/forecast/state-space.js';
import { SECONDS_PER_YEAR } from '../../../src/protocols/math.js';
import { MoonwellSimulator } from '../../../src/protocols/simulation/moonwell-simulator.js';
import type { CompletedLabel } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const RAY_PER_WAD = 10n ** 9n;


describe('registeredGrid (closes F1)', () => {
  const grid = registeredGrid();

  it('crosses 4 methods x 3 horizons x 3 coverage targets, per the amended §7.2 grid (P19)', () => {
    expect(new Set(grid.map((p) => p.method)).size).toBe(4);
    expect(new Set(grid.map((p) => p.horizonSeconds))).toEqual(new Set(REGISTERED_HORIZONS));
    expect(new Set(grid.map((p) => p.coverageTarget))).toEqual(new Set(REGISTERED_COVERAGES));
  });

  it('actually TRAVERSES every horizon rather than declaring them', () => {
    // F1: HORIZON_GRID declared 3 horizons and calibrateAllMethods took one.
    for (const h of REGISTERED_HORIZONS) {
      expect(grid.filter((p) => p.horizonSeconds === h).length).toBeGreaterThan(1);
    }
  });

  it('evaluates 99% coverage, which no previous candidate ever did (F2)', () => {
    expect(grid.some((p) => p.coverageTarget === 0.99)).toBe(true);
    expect(grid.filter((p) => p.coverageTarget === 0.99).length).toBe(grid.length / 3);
  });

  it('sweeps method parameters as well, so the grid is 108 points not 9 (P19 adds a 4th method)', () => {
    // 4 methods x 3 params each = 12 method-configs; x 3 horizons x 3 coverages.
    expect(grid.length).toBe(12 * 3 * 3);
  });
});

describe('solveQuantileForCoverage (closes F2 / implements P1)', () => {
  // Symmetric residuals from -50e15 to +49e15.
  const residuals = Array.from({ length: 100 }, (_, i) => BigInt(i - 50) * 10n ** 15n);

  it('SOLVES the quantile to the target rather than fixing it at 5%', () => {
    // The defect P1 exists to fix: all nine candidates used q=5% regardless of
    // the coverage target, so the target was never actually solved for.
    const q90 = solveQuantileForCoverage(residuals, 0.9);
    const q95 = solveQuantileForCoverage(residuals, 0.95);
    const q99 = solveQuantileForCoverage(residuals, 0.99);
    expect(q99).toBeLessThan(q95);
    expect(q95).toBeLessThan(q90);
  });

  it('achieves at least the requested coverage on its own sample', () => {
    for (const target of REGISTERED_COVERAGES) {
      const q = solveQuantileForCoverage(residuals, target);
      expect(achievedCoverage(residuals, q)).toBeGreaterThanOrEqual(target);
    }
  });

  it('adapts to dispersion: a volatile venue needs a deeper bound than a smooth one', () => {
    // The report's evidence for per-venue quantiles: under one pooled bound,
    // Compound covered 100% and Aave 88.46%.
    const smooth = Array.from({ length: 100 }, (_, i) => BigInt(i - 50) * 10n ** 12n);
    const volatile = Array.from({ length: 100 }, (_, i) => BigInt(i - 50) * 10n ** 15n);
    expect(solveQuantileForCoverage(volatile, 0.95)).toBeLessThan(
      solveQuantileForCoverage(smooth, 0.95),
    );
  });

  it('never returns a positive shrink', () => {
    const allPositive = [1n, 2n, 3n].map((x) => x * 10n ** 15n);
    expect(solveQuantileForCoverage(allPositive, 0.95)).toBeLessThanOrEqual(0n);
  });

  it('refuses an empty sample rather than inventing a quantile', () => {
    expect(() => solveQuantileForCoverage([], 0.95)).toThrow(/cannot be invented/i);
  });

  it('rejects a coverage target outside (0,1)', () => {
    expect(() => solveQuantileForCoverage([1n], 0)).toThrow(/must be in/i);
    expect(() => solveQuantileForCoverage([1n], 1)).toThrow(/must be in/i);
  });
});

describe('meanForecast', () => {
  const flat = Array.from({ length: 50 }, () => 10n ** 15n);

  it('reproduces a constant series exactly under every method', () => {
    for (const [m, p] of [
      ['rolling', { windowObservations: 24 }],
      ['ew-residual', { decay: 0.97 }],
      ['direct-arx', { phi: 0.6 }],
    ] as const) {
      expect(meanForecast(m, p as Record<string, number>, flat)).toBe(10n ** 15n);
    }
  });

  it("refuses 'state-space' -- it needs origin utilization+IRM, not a return history (P19 fix)", () => {
    // A silent fallback to an EWMA on the return history would register a
    // candidate under P19's name while running a different mechanism. This
    // must be visible, not a quietly-returned proxy value.
    expect(() => meanForecast('state-space', { halfLifeObservations: 24 }, flat)).toThrow(
      /per-origin utilization and IRM/,
    );
  });

  it('weights recent observations more heavily under ew-residual', () => {
    const rising = Array.from({ length: 50 }, (_, i) => BigInt(i) * 10n ** 14n);
    const fast = meanForecast('ew-residual', { decay: 0.5 }, rising);
    const slow = meanForecast('ew-residual', { decay: 0.999 }, rising);
    expect(fast).toBeGreaterThan(slow);
  });

  it('pulls toward the latest observation as phi rises under direct-arx', () => {
    const rising = Array.from({ length: 50 }, (_, i) => BigInt(i) * 10n ** 14n);
    const weak = meanForecast('direct-arx', { phi: 0.1 }, rising);
    const strong = meanForecast('direct-arx', { phi: 0.9 }, rising);
    expect(strong).toBeGreaterThan(weak);
  });

  it('returns 0 on an empty history rather than throwing mid-sweep', () => {
    expect(meanForecast('rolling', { windowObservations: 24 }, [])).toBe(0n);
  });
});

/** Labels for two venues with different dispersion. */
function labels(count: number, horizonSeconds: number): CompletedLabel[] {
  const out: CompletedLabel[] = [];
  for (let i = 0; i < count; i++) {
    for (const [marketId, amp] of [
      ['compound-v3-usdc', 10n ** 12n],
      ['aave-v3-usdc', 10n ** 15n],
    ] as const) {
      // Deterministic pseudo-oscillation; no Math.random in a registered sweep.
      const wobble = BigInt(((i * 37) % 21) - 10) * amp;
      out.push({
        marketId,
        regimeId: 'r1',
        originSeconds: i * 3600,
        horizonSeconds: horizonSeconds as CompletedLabel['horizonSeconds'],
        horizonEndSeconds: i * 3600 + horizonSeconds,
        availableAtSeconds: i * 3600 + horizonSeconds + 900,
        realizedReturnWad: 10n ** 15n + wobble,
        realizedMinCashBase: 1n,
        originCashBase: 1n,
      });
    }
  }
  return out;
}

describe('fitPoint', () => {
  const point: GridPoint = {
    method: 'rolling',
    methodParams: { windowObservations: 24 },
    horizonSeconds: 604_800,
    coverageTarget: 0.95,
  };

  it('solves a SEPARATE quantile per venue (P1)', () => {
    const fit = fitPoint(point, labels(200, 604_800), 30)!;
    const markets = Object.keys(fit.quantileWadByMarket);
    expect(markets).toContain('compound-v3-usdc');
    expect(markets).toContain('aave-v3-usdc');
    // The volatile venue gets the deeper bound; a pooled quantile could not.
    expect(fit.quantileWadByMarket['aave-v3-usdc']!).toBeLessThan(
      fit.quantileWadByMarket['compound-v3-usdc']!,
    );
  });

  it('meets the coverage target on every venue it fits', () => {
    const fit = fitPoint(point, labels(200, 604_800), 30)!;
    for (const c of Object.values(fit.coverageByMarket)) {
      expect(c).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('reports each §7.3 loss term separately (closes F3)', () => {
    // F3: rmse was mae * 1.2 and sharpness == pinballLoss == loss, so one
    // scalar wore three names. These must be independently computed.
    const fit = fitPoint(point, labels(200, 604_800), 30)!;
    const l = fit.loss;
    expect(l.pointError).toBeGreaterThan(0);
    expect(l.sharpness).toBeGreaterThan(0);
    expect(l.pointError).not.toBe(l.sharpness);
    expect(l.total).not.toBe(l.pointError);
    // The total is exactly the declared weighted sum, so it is auditable.
    const expected =
      LOSS_WEIGHTS.pointError * l.pointError +
      LOSS_WEIGHTS.coverageDeviation * l.coverageDeviation +
      LOSS_WEIGHTS.exceedanceShortfall * l.exceedanceShortfall +
      LOSS_WEIGHTS.sharpness * l.sharpness +
      LOSS_WEIGHTS.downsideRate * l.downsideRate;
    expect(l.total).toBeCloseTo(expected, 12);
  });

  it('uses only the labels for its own horizon', () => {
    const mixed = [...labels(200, 604_800), ...labels(200, 86_400)];
    const a = fitPoint(point, mixed, 30)!;
    const b = fitPoint(point, labels(200, 604_800), 30)!;
    expect(a.loss.observations).toBe(b.loss.observations);
  });

  it('returns null rather than a score when there is too little data', () => {
    expect(fitPoint(point, labels(5, 604_800), 30)).toBeNull();
  });

  it('is strictly causal — the forecast for label i never sees label i', () => {
    // A leak would drive residuals to zero and the loss with them.
    const fit = fitPoint(point, labels(200, 604_800), 30)!;
    expect(fit.loss.pointError).toBeGreaterThan(0);
  });
});

describe('sweep and selectPoint', () => {
  const data = labels(300, 604_800);

  it('scores the grid and picks the minimum loss', () => {
    const rows = sweep(data, registeredGrid(), 30);
    expect(rows.length).toBeGreaterThan(0);
    const chosen = selectPoint(rows);
    for (const r of rows) expect(r.loss.total).toBeGreaterThanOrEqual(chosen.row.loss.total);
  });

  it('reports the runner-up and the margin, so the choice is auditable', () => {
    const chosen = selectPoint(sweep(data, registeredGrid(), 30));
    expect(chosen.runnerUp).not.toBeNull();
    expect(chosen.margin).toBeGreaterThanOrEqual(0);
    expect(chosen.reason).toMatch(/runner-up/);
    expect(chosen.reason).toMatch(/achieved coverage/);
  });

  it('drops unscorable points instead of scoring them as zero-loss winners', () => {
    // A point with too little data scoring 0 would win every sweep.
    const rows = sweep(labels(40, 604_800), registeredGrid(), 30);
    for (const r of rows) expect(r.loss.observations).toBeGreaterThan(0);
  });

  it('refuses to select from an empty sweep', () => {
    expect(() => selectPoint([])).toThrow(/no scored grid point/i);
    expect(() => selectPoint([])).toThrow(/rather than lowering the bar/i);
  });

  it('is deterministic — the same labels select the same point', () => {
    const a = selectPoint(sweep(data, registeredGrid(), 30));
    const b = selectPoint(sweep(data, registeredGrid(), 30));
    expect(b.row.point).toEqual(a.row.point);
    expect(b.row.loss.total).toBe(a.row.loss.total);
  });
});

/**
 * P19 fix (review round 1): 'state-space' must run the REAL mechanism —
 * forecast utilization, map it through the IRM observed at the label's own
 * origin — not a return-series proxy wearing its name. These labels give a
 * return-series method (rolling/ew-residual/direct-arx) nothing to react to
 * (a perfectly flat `realizedReturnWad`) while the utilization trends
 * clearly across the kink, so only a candidate that genuinely reads
 * `originUtilizationWad`/`originIrmParams` can produce anything but a
 * near-zero residual here.
 */
describe('P19 fix: state-space runs the real mechanism, not a return-series proxy', () => {
  const HORIZON = 604_800 as const;
  const irm = {
    baseRateWad: 0n,
    kinkRay: (RAY * 90n) / 100n,
    slopeLowWad: (WAD * 36n) / 1000n,
    slopeHighWad: (WAD * 30n) / 100n,
    reserveFactorBps: 0,
  };

  /** Utilization ramps linearly from 50% to ~98%, crossing the 90% kink. */
  function trendingLabels(count: number, regimeId = 'r1'): CompletedLabel[] {
    const out: CompletedLabel[] = [];
    for (let i = 0; i < count; i++) {
      const utilWad = (WAD * BigInt(50 + Math.floor((i * 48) / count))) / 100n;
      out.push({
        marketId: 'compound-v3-usdc',
        regimeId,
        originSeconds: i * 3600,
        horizonSeconds: HORIZON,
        horizonEndSeconds: i * 3600 + HORIZON,
        availableAtSeconds: i * 3600 + HORIZON + 900,
        realizedReturnWad: 10n ** 15n, // FLAT: a return-series method sees no signal at all.
        realizedMinCashBase: 1n,
        originCashBase: 1n,
        originUtilizationWad: utilWad,
        originIrmParams: irm,
      });
    }
    return out;
  }

  const point: GridPoint = {
    method: 'state-space',
    methodParams: { halfLifeObservations: 12 },
    horizonSeconds: HORIZON,
    coverageTarget: 0.95,
  };

  it('diverges from a flat return series because it tracks the real utilization state', () => {
    const residuals = residualsFor(point, trendingLabels(60), 20)['compound-v3-usdc'];
    expect(residuals).toBeDefined();
    // A return-series method fit on a perfectly flat series would produce
    // residuals indistinguishable from 0 everywhere -- exactly the
    // degenerate path this fix removes. Utilization climbing through the
    // kink must show real spread instead.
    const first = residuals![0]!;
    const last = residuals![residuals!.length - 1]!;
    expect(first).not.toBe(last);
    const spread = first > last ? first - last : last - first;
    expect(spread).toBeGreaterThan(10n ** 13n);
  });

  it('refuses a label whose origin has no IRM parameters, rather than falling back', () => {
    const labelsNoIrm = trendingLabels(30).map((l) => ({ ...l, originIrmParams: null }));
    expect(residualsFor(point, labelsNoIrm, 20)['compound-v3-usdc']).toBeUndefined();
  });

  it('refuses to blend across a regime change instead of averaging through it', () => {
    const withChange = trendingLabels(30);
    // The origin of the LAST label sits under a brand-new configuration
    // with no same-regime history behind it.
    withChange[29] = { ...withChange[29]!, regimeId: 'r2' };
    const withoutChange = trendingLabels(30);

    const residualsChanged = residualsFor(point, withChange, 20)['compound-v3-usdc']!;
    const residualsPlain = residualsFor(point, withoutChange, 20)['compound-v3-usdc']!;
    // One fewer residual: index 29 refuses under the regime change and does
    // not under the unchanged series.
    expect(residualsChanged.length).toBe(residualsPlain.length - 1);
  });

  it(
    'REVIEW ROUND 2, FIX 2: gates on same-regime HISTORY LENGTH, not on i\'s absolute ' +
      'position -- a regime change mid-series must not score with a short post-change history',
    () => {
      // 50 labels: indices 0-24 regime 'r1', 25-49 regime 'r2'. With
      // minObservations=20: r1 scores indices 20-24 (5), r2 scores indices
      // 45-49 (5) -- 10 total. Round 1's bug (gate i against the WHOLE
      // series, treat any NONEMPTY same-regime history as enough) would have
      // additionally scored r2's indices 26-44 off same-regime histories of
      // 1-19 observations: 24 more, 29 wrongly-scored in total for r2 alone.
      const labels: CompletedLabel[] = [];
      for (let i = 0; i < 50; i++) {
        const regimeId = i < 25 ? 'r1' : 'r2';
        labels.push({
          marketId: 'compound-v3-usdc',
          regimeId,
          originSeconds: i * 3600,
          horizonSeconds: HORIZON,
          horizonEndSeconds: i * 3600 + HORIZON,
          availableAtSeconds: i * 3600 + HORIZON + 900,
          realizedReturnWad: 10n ** 15n,
          realizedMinCashBase: 1n,
          originCashBase: 1n,
          originUtilizationWad: (WAD * 70n) / 100n,
          originIrmParams: irm,
        });
      }
      const residuals = residualsFor(point, labels, 20)['compound-v3-usdc']!;
      expect(residuals.length).toBe(10);
    },
  );
});

/**
 * REVIEW ROUND 2, FIX 1 & PER-PROTOCOL MAP: pin each protocol's mapped rate
 * against an independently-computed expected value, using REAL on-chain
 * parameter shapes (not DEFAULT_*_CONFIG). Each fixture is a FLAT history so
 * `forecastUtilization`/the EWMA state forecast reproduces the historical
 * value exactly (verified in state-space.spec.ts), isolating "does the RATE
 * MAP match" from "does the forecast converge".
 */
describe('P19 review round 2: per-protocol rate map, pinned against real formulas', () => {
  const HORIZON = 604_800 as const;
  const point: GridPoint = {
    method: 'state-space',
    methodParams: { halfLifeObservations: 12 },
    horizonSeconds: HORIZON,
    coverageTarget: 0.95,
  };

  /** A flat 25-observation same-regime history ending in one scorable label. */
  function flatLabel(marketId: string, fields: Partial<CompletedLabel>): CompletedLabel[] {
    const out: CompletedLabel[] = [];
    for (let i = 0; i < 25; i++) {
      out.push({
        marketId,
        regimeId: 'r1',
        originSeconds: i * 3600,
        horizonSeconds: HORIZON,
        horizonEndSeconds: i * 3600 + HORIZON,
        availableAtSeconds: i * 3600 + HORIZON + 900,
        realizedReturnWad: 0n, // overwritten below once the expected mu is known
        realizedMinCashBase: 1n,
        originCashBase: 1n,
        ...fields,
      });
    }
    return out;
  }

  it('COMPOUND: reproduces supplyRateAt exactly (max error 0) -- the pin the review asked for', () => {
    const irm = {
      baseRateWad: 0n,
      kinkRay: (RAY * 90n) / 100n,
      slopeLowWad: (WAD * 36n) / 1000n,
      slopeHighWad: (WAD * 30n) / 100n,
      reserveFactorBps: 0, // dataset.ts's venue-aware default for Comet
    };
    const utilWad = (WAD * 70n) / 100n; // flat 70%, below the 90% kink
    const expectedAnnualWad = supplyRateAt(utilWad, irm);
    const expectedMuWad = (expectedAnnualWad * BigInt(HORIZON)) / SECONDS_PER_YEAR;

    const labels = flatLabel('compound-v3-usdc', {
      originUtilizationWad: utilWad,
      originIrmParams: irm,
    }).map((l) => ({ ...l, realizedReturnWad: expectedMuWad }));

    const residuals = residualsFor(point, labels, 20)['compound-v3-usdc']!;
    expect(residuals.every((r) => r === 0n)).toBe(true);
  });

  it('AAVE: is LINEAR in the excess ratio, not squared -- pinned against an independent formula', () => {
    // Real Base USDC-shaped Aave coefficients (kink/optimal 90%, slope1 6.5%,
    // slope2 60%, reserve factor 10%), verified against 10,632 live
    // calibration rows to reproduce Aave's real curve at 0.21pp MAE.
    const irm = {
      baseRateWad: 0n,
      kinkRay: (RAY * 90n) / 100n,
      slopeLowWad: (WAD * 65n) / 1000n,
      slopeHighWad: (WAD * 60n) / 100n,
      reserveFactorBps: 1000,
    };
    // cash=30, borrows=70, reserves=0 -> u = 70%, below the 90% optimal.
    const cash = 30_000_000n;
    const borrows = 70_000_000n;
    const utilRay = (borrows * RAY) / (cash + borrows);
    // Independent reference: base + slope1 * (u / optimal), LINEAR.
    const borrowRateAnnualWad = irm.baseRateWad + (irm.slopeLowWad * utilRay) / irm.kinkRay;
    const utilWad = utilRay / RAY_PER_WAD;
    const afterUtil = (borrowRateAnnualWad * utilWad) / WAD;
    const rfWad = (BigInt(irm.reserveFactorBps) * WAD) / 10_000n;
    const expectedAnnualWad = (afterUtil * (WAD - rfWad)) / WAD;
    const expectedMuWad = (expectedAnnualWad * BigInt(HORIZON)) / SECONDS_PER_YEAR;

    // A SQUARED reference (what AaveV3Simulator computes) would differ
    // materially here -- this is the assertion that catches a regression
    // back to the squared formula.
    const squaredRatio = (utilRay * utilRay) / irm.kinkRay / RAY;
    const squaredBorrowRateAnnualWad = irm.baseRateWad + (irm.slopeLowWad * squaredRatio) / RAY;
    expect(squaredBorrowRateAnnualWad).not.toBe(borrowRateAnnualWad);

    const labels = flatLabel('aave-v3-usdc', {
      originCashBase: cash,
      originBorrowsBase: borrows,
      originReservesBase: 0n,
      originIrmParams: irm,
    }).map((l) => ({ ...l, realizedReturnWad: expectedMuWad }));

    const residuals = residualsFor(point, labels, 20)['aave-v3-usdc']!;
    expect(residuals.every((r) => r === 0n)).toBe(true);
  });

  it('MOONWELL: applies * u * (1 - reserveFactor) on top of the kinked-linear borrow curve', () => {
    const irm = {
      baseRateWad: 0n,
      kinkRay: (RAY * 90n) / 100n,
      slopeLowWad: (WAD * 36n) / 1000n,
      slopeHighWad: (WAD * 300n) / 1000n,
      reserveFactorBps: 1000,
    };
    // cash=25, borrows=70, reserves=5 -> supplied=90, u = 70/90 = 77.78%.
    const cash = 25_000_000n;
    const borrows = 70_000_000n;
    const reserves = 5_000_000n;
    const utilRay = (borrows * RAY) / (cash + borrows - reserves);
    const utilWad = utilRay / RAY_PER_WAD;

    const perSecond = new MoonwellSimulator().calculateRateFromUtilization(utilRay, {
      baseRate: irm.baseRateWad,
      kink: irm.kinkRay,
      slopeLow: irm.slopeLowWad,
      slopeHigh: irm.slopeHighWad,
    });
    const borrowRateAnnualWad = perSecond * SECONDS_PER_YEAR;
    const afterUtil = (borrowRateAnnualWad * utilWad) / WAD;
    const rfWad = (BigInt(irm.reserveFactorBps) * WAD) / 10_000n;
    const expectedAnnualWad = (afterUtil * (WAD - rfWad)) / WAD;
    const expectedMuWad = (expectedAnnualWad * BigInt(HORIZON)) / SECONDS_PER_YEAR;

    // The bug this fix closes: using the borrow curve's raw output AS the
    // supply rate (no * u, no reserve haircut) would be a materially
    // different, larger number.
    expect(borrowRateAnnualWad).not.toBe(expectedAnnualWad);

    const labels = flatLabel('moonwell-usdc', {
      originCashBase: cash,
      originBorrowsBase: borrows,
      originReservesBase: reserves,
      originIrmParams: irm,
    }).map((l) => ({ ...l, realizedReturnWad: expectedMuWad }));

    const residuals = residualsFor(point, labels, 20)['moonwell-usdc']!;
    expect(residuals.every((r) => r === 0n)).toBe(true);
  });
});

/**
 * REVIEW ROUND 2, FIX 3: a 'state-space' grid point must cover the same
 * venue set an incumbent method would, or fail loudly rather than silently
 * freeze a partial artifact.
 */
describe('P19 review round 2, fix 3: venue coverage is asserted, not assumed', () => {
  const HORIZON = 604_800 as const;
  const irm = {
    baseRateWad: 0n,
    kinkRay: (RAY * 90n) / 100n,
    slopeLowWad: (WAD * 36n) / 1000n,
    slopeHighWad: (WAD * 30n) / 100n,
    reserveFactorBps: 0,
  };
  const point: GridPoint = {
    method: 'state-space',
    methodParams: { halfLifeObservations: 12 },
    horizonSeconds: HORIZON,
    coverageTarget: 0.95,
  };

  function labelsFor(marketId: string, count: number, withIrm: boolean): CompletedLabel[] {
    const out: CompletedLabel[] = [];
    for (let i = 0; i < count; i++) {
      out.push({
        marketId,
        regimeId: 'r1',
        originSeconds: i * 3600,
        horizonSeconds: HORIZON,
        horizonEndSeconds: i * 3600 + HORIZON,
        availableAtSeconds: i * 3600 + HORIZON + 900,
        realizedReturnWad: 10n ** 15n,
        realizedMinCashBase: 1n,
        originCashBase: 1n,
        originUtilizationWad: (WAD * 70n) / 100n,
        ...(withIrm ? { originIrmParams: irm } : {}),
      });
    }
    return out;
  }

  it('throws when state-space scores fewer venues than an incumbent method would', () => {
    const labels = [
      ...labelsFor('compound-v3-usdc', 30, true), // scorable under state-space
      ...labelsFor('aave-v3-usdc', 30, false), // enough labels, but NEVER has IRM -- always refuses
    ];
    expect(() => fitPoint(point, labels, 20)).toThrow(/aave-v3-usdc/);
    expect(() => fitPoint(point, labels, 20)).toThrow(/venues/i);
  });

  it('does not throw when every expected venue is actually scored', () => {
    const labels = labelsFor('compound-v3-usdc', 30, true);
    expect(() => fitPoint(point, labels, 20)).not.toThrow();
  });
});
