export const FORECAST_HORIZONS = {
  SHORT: 1 * 24 * 60 * 60,   // 1 day in seconds
  MEDIUM: 7 * 24 * 60 * 60,  // 7 days in seconds
  LONG: 14 * 24 * 60 * 60,   // 14 days in seconds
} as const;

export const COVERAGE_TARGETS = {
  LOW: 0.90,    // 90%
  MEDIUM: 0.95, // 95%
  HIGH: 0.99,   // 99%
} as const;

export interface HorizonConfig {
  horizonSeconds: number;
  coverageTarget: number;
  windowDays: number;
}

export const HORIZON_GRID: HorizonConfig[] = [
  // Short horizon (1 day)
  { horizonSeconds: FORECAST_HORIZONS.SHORT, coverageTarget: COVERAGE_TARGETS.LOW, windowDays: 30 },
  { horizonSeconds: FORECAST_HORIZONS.SHORT, coverageTarget: COVERAGE_TARGETS.MEDIUM, windowDays: 30 },
  { horizonSeconds: FORECAST_HORIZONS.SHORT, coverageTarget: COVERAGE_TARGETS.HIGH, windowDays: 60 },

  // Medium horizon (7 days)
  { horizonSeconds: FORECAST_HORIZONS.MEDIUM, coverageTarget: COVERAGE_TARGETS.LOW, windowDays: 60 },
  { horizonSeconds: FORECAST_HORIZONS.MEDIUM, coverageTarget: COVERAGE_TARGETS.MEDIUM, windowDays: 90 },
  { horizonSeconds: FORECAST_HORIZONS.MEDIUM, coverageTarget: COVERAGE_TARGETS.HIGH, windowDays: 120 },

  // Long horizon (14 days)
  { horizonSeconds: FORECAST_HORIZONS.LONG, coverageTarget: COVERAGE_TARGETS.LOW, windowDays: 90 },
  { horizonSeconds: FORECAST_HORIZONS.LONG, coverageTarget: COVERAGE_TARGETS.MEDIUM, windowDays: 120 },
  { horizonSeconds: FORECAST_HORIZONS.LONG, coverageTarget: COVERAGE_TARGETS.HIGH, windowDays: 180 },
];

export function getHorizonConfig(
  horizonSeconds: number,
  coverageTarget: number
): HorizonConfig | undefined {
  return HORIZON_GRID.find(
    h => h.horizonSeconds === horizonSeconds && h.coverageTarget === coverageTarget
  );
}

export type ForecastHorizonKey = keyof typeof FORECAST_HORIZONS;
export type CoverageTargetKey = keyof typeof COVERAGE_TARGETS;
