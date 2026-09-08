import {
  LOSS_WEIGHTS,
  REGISTERED_COVERAGES,
  REGISTERED_HORIZONS,
  achievedCoverage,
  fitPoint,
  meanForecast,
  registeredGrid,
  selectPoint,
  solveQuantileForCoverage,
  sweep,
  type GridPoint,
} from '../../../src/forecast/grid-sweep.js';
import type { CompletedLabel } from '../../../src/policy/types.js';


describe('registeredGrid (closes F1)', () => {
  const grid = registeredGrid();

  it('crosses 3 methods x 3 horizons x 3 coverage targets, per the amended §7.2 grid', () => {
    expect(new Set(grid.map((p) => p.method)).size).toBe(3);
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

  it('sweeps method parameters as well, so the grid is 81 points not 9', () => {
    expect(grid.length).toBe(3 * 3 * 3 * 3);
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
