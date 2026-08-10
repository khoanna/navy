import { ForecastResult, HorizonSeconds } from './types.js';
import { WAD } from '../protocols/math.js';

export interface EWResidualConfig {
  decay: number;
  residualQuantile: number;
}

export class EWResidualForecast {
  private config: EWResidualConfig;

  constructor(config: EWResidualConfig) {
    this.config = config;
  }

  forecast(
    history: bigint[],
    horizonSeconds: number
  ): ForecastResult {
    if (history.length < 14) {
      return {
        marketId: 'ew-residual',
        horizon: horizonSeconds as HorizonSeconds,
        meanReturn: WAD,
        lowerReturn: WAD,
        coverage: 0,
        method: 'ew-residual',
        config: this.config as unknown as Record<string, unknown>,
      };
    }

    let ewSum = 0;
    let ewWeight = 0;
    const dec = this.config.decay;

    for (let i = 0; i < history.length; i++) {
      const weight = Math.pow(dec, history.length - i - 1);
      const value = history[i] ?? WAD;
      ewSum += Number(value) * weight;
      ewWeight += weight;
    }

    const ewMean = BigInt(Math.floor(ewSum / ewWeight));

    const residuals: bigint[] = [];
    for (let i = 1; i < history.length; i++) {
      const current = history[i] ?? WAD;
      const previous = history[i - 1] ?? WAD;
      residuals.push(current - previous);
    }

    const sorted = [...residuals].sort((a, b) => (a < b ? -1 : 1));
    const quantileIndex = Math.floor(sorted.length * this.config.residualQuantile);
    const lowerResidual = sorted[quantileIndex] ?? 0n;

    const lowerReturn = ewMean + lowerResidual;

    const horizonRatio = BigInt(horizonSeconds) / 86400n;
    const scaledMean = WAD + ((ewMean - WAD) * horizonRatio);
    const scaledLower = WAD + ((lowerReturn - WAD) * horizonRatio);

    return {
      marketId: 'ew-residual',
      horizon: horizonSeconds as HorizonSeconds,
      meanReturn: scaledMean,
      lowerReturn: scaledLower,
      coverage: 1 - this.config.residualQuantile,
      method: 'ew-residual',
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

    return {
      loss: errors / predictions.length,
      coverage: belowCount / predictions.length,
    };
  }
}
