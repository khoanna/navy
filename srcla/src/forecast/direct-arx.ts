import { ForecastResult, HorizonSeconds } from './types.js';
import { WAD } from '../protocols/math.js';

export interface ARXConfig {
  lags: number;
  features: string[];
  /** Quantile level for lower bound (default 0.10 = 10th percentile) */
  quantile?: number;
}

interface ExogenousFeatures {
  rate?: bigint[];
  utilization?: bigint[];
}

/**
 * DirectARX Forecast with calibrated lower bound.
 *
 * Per paper §7.2: lower prediction bound = mean + quantile of walk-forward residuals.
 * The quantile is calibrated during walk-forward calibration and stored in residuals.
 */
export class DirectARXForecast {
  private config: ARXConfig;
  /** Calibrated residuals from walk-forward calibration */
  private calibratedResiduals: bigint[] = [];
  /** Mean forecast computed during calibration */
  private calibratedMean: bigint = WAD;

  constructor(config: ARXConfig) {
    this.config = { quantile: 0.10, ...config };
  }

  /**
   * Set calibrated residuals from walk-forward calibration.
   * Call this after runWalkForwardCalibration completes.
   */
  setCalibratedResiduals(residuals: bigint[], mean: bigint): void {
    this.calibratedResiduals = residuals;
    this.calibratedMean = mean;
  }

  /**
   * Compute lower bound from calibrated residuals.
   * Uses the α-quantile (default 10th percentile) of residuals.
   *
   * @param residuals - Array of residuals from walk-forward calibration
   * @returns The lower bound = calibrated mean + quantile residual
   */
  computeLowerBound(residuals: bigint[]): bigint {
    if (residuals.length < 10) return WAD;
    const sorted = [...residuals].sort((a, b) => (a < b ? -1 : 1));
    const quantileIndex = Math.floor(sorted.length * (this.config.quantile ?? 0.10));
    const quantileResidual = sorted[quantileIndex] ?? 0n;
    return this.calibratedMean + quantileResidual;
  }

  /**
   * Test helper that exposes computeLowerBound for testing.
   * Uses the provided residuals directly.
   */
  computeLowerBoundForTest(residuals: bigint[]): bigint {
    return this.computeLowerBound(residuals);
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

    // Compute weighted mean of recent observations
    for (let i = 0; i < recent.length; i++) {
      const value = recent[i] ?? WAD;
      const weight = 1 / (i + 1);
      mean = mean + ((value - WAD) * BigInt(Math.floor(weight * 1000))) / 1000n;
    }

    // Use calibrated lower bound if residuals available, else fallback
    const lowerReturn = this.calibratedResiduals.length >= 10
      ? this.computeLowerBound(this.calibratedResiduals)
      : WAD + ((mean - WAD) * 70n) / 100n; // Fallback: 70% of mean deviation

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
      // Complement of the breach count — see rolling.ts.
      coverage: (predictions.length - belowCount) / predictions.length,
    };
  }
}
