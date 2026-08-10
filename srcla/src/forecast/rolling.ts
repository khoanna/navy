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
    const coverage = belowCount / predictions.length;
    const loss = mae + Math.max(0, (0.05 - coverage) * 1000);

    return { loss, coverage };
  }
}
