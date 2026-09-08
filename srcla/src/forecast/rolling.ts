import { ForecastResult, HorizonSeconds } from './types.js';
import { WAD } from '../protocols/math.js';

export interface RollingConfig {
  windowDays: number;
  quantile: number;
}

export class RollingForecast {
  private config: RollingConfig;

  constructor(config: RollingConfig) {
    this.config = config;
  }

  forecast(
    history: bigint[],
    horizonSeconds: number
  ): ForecastResult {
    if (history.length < this.config.windowDays) {
      return {
        marketId: 'rolling',
        horizon: horizonSeconds as HorizonSeconds,
        meanReturn: WAD,
        lowerReturn: WAD,
        coverage: 0,
        method: 'rolling',
        config: this.config as unknown as Record<string, unknown>,
      };
    }

    const window = history.slice(-this.config.windowDays);
    const sum = window.reduce((a, b) => a + b, 0n);
    const meanReturn = sum / BigInt(window.length);

    const sorted = [...window].sort((a, b) => (a < b ? -1 : 1));
    const quantileIndex = Math.floor(sorted.length * this.config.quantile);
    const lowerReturn = sorted[quantileIndex] ?? WAD;

    const horizonRatio = BigInt(horizonSeconds) / 86400n;
    const scaledMean = WAD + ((meanReturn - WAD) * horizonRatio);
    const scaledLower = WAD + ((lowerReturn - WAD) * horizonRatio);

    return {
      marketId: 'rolling',
      horizon: horizonSeconds as HorizonSeconds,
      meanReturn: scaledMean,
      lowerReturn: scaledLower,
      coverage: 1 - this.config.quantile,
      method: 'rolling',
      config: this.config as unknown as Record<string, unknown>,
    };
  }

  calculateLoss(
    predictions: ForecastResult[],
    realized: bigint[]
  ): { loss: number; coverage: number } {
    let errors = 0;
    let belowCount = 0;

    for (let i = 0; i < predictions.length; i++) {
      const predicted = predictions[i]?.lowerReturn ?? WAD;
      const actual = realized[i] ?? WAD;

      if (actual < predicted) belowCount++;
      errors += Math.abs(Number(predicted - actual) / 1e18);
    }

    const mae = errors / predictions.length;
    // `belowCount` counts breaches; empirical coverage is the complement, on
    // the same convention as the `coverage` field emitted at forecast time
    // (`1 - quantile`, i.e. P[actual >= lowerReturn]).
    const coverage = (predictions.length - belowCount) / predictions.length;
    // Penalise UNDER-coverage against the nominal level this forecaster was
    // configured for. The previous form subtracted coverage from a hardcoded
    // 0.05, so it penalised a bound for holding and charged nothing for one
    // breached half the time.
    const nominalCoverage = 1 - this.config.quantile;
    const loss = mae + Math.max(0, nominalCoverage - coverage) * 1000;

    return { loss, coverage };
  }
}
