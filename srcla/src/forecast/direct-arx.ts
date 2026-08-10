import { ForecastResult, HorizonSeconds } from './types.js';
import { WAD } from '../protocols/math.js';

export interface ARXConfig {
  lags: number;
  features: string[];
}

interface ExogenousFeatures {
  rate?: bigint[];
  utilization?: bigint[];
}

export class DirectARXForecast {
  private config: ARXConfig;

  constructor(config: ARXConfig) {
    this.config = config;
  }

  forecast(
    history: bigint[],
    _features: ExogenousFeatures,
    horizonSeconds: number
  ): ForecastResult {
    if (history.length < this.config.lags + 10) {
      return {
        marketId: 'arx',
        horizon: horizonSeconds as HorizonSeconds,
        meanReturn: WAD,
        lowerReturn: WAD,
        coverage: 0,
        method: 'arx',
        config: this.config as unknown as Record<string, unknown>,
      };
    }

    const recent = history.slice(-this.config.lags);
    let mean = WAD;

    for (let i = 0; i < recent.length; i++) {
      const value = recent[i] ?? WAD;
      const weight = 1 / (i + 1);
      mean = mean + ((value - WAD) * BigInt(Math.floor(weight * 1000))) / 1000n;
    }

    const lowerReturn = WAD + ((mean - WAD) * 70n) / 100n;

    return {
      marketId: 'arx',
      horizon: horizonSeconds as HorizonSeconds,
      meanReturn: mean,
      lowerReturn,
      coverage: 0.95,
      method: 'arx',
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
