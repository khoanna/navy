import {
  FORECAST_HORIZONS,
  COVERAGE_TARGETS,
  HORIZON_GRID,
  getHorizonConfig,
} from '../../../src/forecast/horizon-grid.js';

describe('FORECAST_HORIZONS', () => {
  it('should have correct SHORT horizon (1 day)', () => {
    expect(FORECAST_HORIZONS.SHORT).toBe(86400);
  });

  it('should have correct MEDIUM horizon (7 days)', () => {
    expect(FORECAST_HORIZONS.MEDIUM).toBe(604800);
  });

  it('should have correct LONG horizon (14 days)', () => {
    expect(FORECAST_HORIZONS.LONG).toBe(1209600);
  });
});

describe('COVERAGE_TARGETS', () => {
  it('should have correct LOW target (90%)', () => {
    expect(COVERAGE_TARGETS.LOW).toBe(0.90);
  });

  it('should have correct MEDIUM target (95%)', () => {
    expect(COVERAGE_TARGETS.MEDIUM).toBe(0.95);
  });

  it('should have correct HIGH target (99%)', () => {
    expect(COVERAGE_TARGETS.HIGH).toBe(0.99);
  });
});

describe('HORIZON_GRID', () => {
  it('should have 9 configurations (3 horizons × 3 coverage targets)', () => {
    expect(HORIZON_GRID.length).toBe(9);
  });

  it('should have correct horizon values', () => {
    const horizons = new Set(HORIZON_GRID.map(h => h.horizonSeconds));
    expect(horizons.has(FORECAST_HORIZONS.SHORT)).toBe(true);
    expect(horizons.has(FORECAST_HORIZONS.MEDIUM)).toBe(true);
    expect(horizons.has(FORECAST_HORIZONS.LONG)).toBe(true);
  });

  it('should have all coverage targets', () => {
    const targets = new Set(HORIZON_GRID.map(h => h.coverageTarget));
    expect(targets.has(COVERAGE_TARGETS.LOW)).toBe(true);
    expect(targets.has(COVERAGE_TARGETS.MEDIUM)).toBe(true);
    expect(targets.has(COVERAGE_TARGETS.HIGH)).toBe(true);
  });

  it('should require longer windows for longer horizons', () => {
    const shortWindow = HORIZON_GRID.find(h => h.horizonSeconds === FORECAST_HORIZONS.SHORT)?.windowDays ?? 0;
    const longWindow = HORIZON_GRID.find(h => h.horizonSeconds === FORECAST_HORIZONS.LONG)?.windowDays ?? 0;
    expect(longWindow).toBeGreaterThan(shortWindow);
  });

  it('should have valid windowDays for all configs', () => {
    for (const config of HORIZON_GRID) {
      expect(config.windowDays).toBeGreaterThan(0);
      expect(Number.isInteger(config.windowDays)).toBe(true);
    }
  });

  it('should have coverage targets in valid range', () => {
    for (const config of HORIZON_GRID) {
      expect(config.coverageTarget).toBeGreaterThanOrEqual(0.90);
      expect(config.coverageTarget).toBeLessThanOrEqual(0.99);
    }
  });

  it('should have exactly 3 configs per horizon', () => {
    const byHorizon = HORIZON_GRID.reduce((acc, config) => {
      acc[config.horizonSeconds] = (acc[config.horizonSeconds] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    expect(byHorizon[FORECAST_HORIZONS.SHORT]).toBe(3);
    expect(byHorizon[FORECAST_HORIZONS.MEDIUM]).toBe(3);
    expect(byHorizon[FORECAST_HORIZONS.LONG]).toBe(3);
  });
});

describe('getHorizonConfig', () => {
  it('should find config for valid horizon and coverage', () => {
    const config = getHorizonConfig(FORECAST_HORIZONS.SHORT, COVERAGE_TARGETS.LOW);
    expect(config).toBeDefined();
    expect(config?.horizonSeconds).toBe(FORECAST_HORIZONS.SHORT);
    expect(config?.coverageTarget).toBe(COVERAGE_TARGETS.LOW);
  });

  it('should return undefined for invalid horizon', () => {
    const config = getHorizonConfig(999999, COVERAGE_TARGETS.LOW);
    expect(config).toBeUndefined();
  });

  it('should return undefined for invalid coverage target', () => {
    const config = getHorizonConfig(FORECAST_HORIZONS.MEDIUM, 0.50);
    expect(config).toBeUndefined();
  });

  it('should find all 9 unique configurations', () => {
    const found = new Set<string>();
    for (const horizon of Object.values(FORECAST_HORIZONS)) {
      for (const coverage of Object.values(COVERAGE_TARGETS)) {
        const config = getHorizonConfig(horizon, coverage);
        expect(config).toBeDefined();
        const key = `${config?.horizonSeconds}-${config?.coverageTarget}`;
        found.add(key);
      }
    }
    expect(found.size).toBe(9);
  });
});
