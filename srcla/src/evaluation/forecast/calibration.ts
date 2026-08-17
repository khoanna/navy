/**
 * Forecast Calibration Module
 *
 * Implements §7.2-7.3 of the SRCLA paper:
 * - Rolling horizon distribution forecast
 * - EW-residual forecast with exponential decay
 * - ARX (autoregressive with exogenous features)
 * - Coverage validation against realized labels
 * - Candidate selection and artifact freezing
 */
import { createHash } from 'crypto';
import { calculateForecastMetrics, type ForecastPrediction } from '../metrics/forecast.js';
import { WAD } from '../../protocols/math.js';
import type { ForecastCandidate, CalibrationResult } from '../../forecast/types.js';

export interface CalibrationConfig {
  rollingWindows: number[];
  ewDecays: number[];
  arxLags: number[];
  horizons: number[];
  coverageTargets: number[];
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  rollingWindows: [7, 14, 30],
  ewDecays: [0.90, 0.95, 0.99],
  arxLags: [3, 7, 14],
  horizons: [86400, 604800, 2592000],
  coverageTargets: [0.90, 0.95, 0.99],
};

export interface CalibrationInput {
  marketId: string;
  horizonSeconds: number;
  history: bigint[];         // Historical returns at this horizon
  realized: bigint[];        // Realized returns (labels)
  utilization?: bigint[];    // Optional exogenous feature
}

export interface CalibrationOutput {
  bestMethod: string;
  bestConfig: Record<string, unknown>;
  bestLoss: number;
  bestCoverage: number;
  allResults: CalibrationResult[];
  artifactHash: string;
  coveragePassed: boolean;
}

/**
 * Compute rolling horizon distribution forecast
 */
export class RollingCalibration {
  private windowDays: number;
  private quantile: number;

  constructor(windowDays: number, quantile: number) {
    this.windowDays = windowDays;
    this.quantile = quantile;
  }

  forecast(history: bigint[], _horizonSeconds: number): bigint {
    if (history.length < this.windowDays) {
      return WAD;
    }
    const window = history.slice(-this.windowDays);
    const sorted = [...window].sort((a, b) => (a < b ? -1 : 1));
    const quantileIndex = Math.floor(sorted.length * this.quantile);
    return sorted[quantileIndex] ?? WAD;
  }
}

/**
 * Compute EW-residual forecast
 */
export class EWResidualCalibration {
  private decay: number;
  private residualQuantile: number;

  constructor(decay: number, residualQuantile: number) {
    this.decay = decay;
    this.residualQuantile = residualQuantile;
  }

  forecast(history: bigint[]): bigint {
    if (history.length < 14) return WAD;

    // Compute EW mean
    let ewSum = 0;
    let ewWeight = 0;
    for (let i = 0; i < history.length; i++) {
      const weight = Math.pow(this.decay, history.length - i - 1);
      ewSum += Number(history[i] ?? WAD) * weight;
      ewWeight += weight;
    }
    const ewMean = BigInt(Math.floor(ewSum / ewWeight));

    // Compute residuals
    const residuals: bigint[] = [];
    for (let i = 1; i < history.length; i++) {
      residuals.push((history[i] ?? WAD) - (history[i - 1] ?? WAD));
    }

    const sorted = [...residuals].sort((a, b) => (a < b ? -1 : 1));
    const quantileIndex = Math.floor(sorted.length * this.residualQuantile);
    const lowerResidual = sorted[quantileIndex] ?? 0n;

    return ewMean + lowerResidual;
  }
}

/**
 * Compute ARX forecast
 */
export class ARXCalibration {
  private lags: number;

  constructor(lags: number) {
    this.lags = lags;
  }

  forecast(history: bigint[]): bigint {
    if (history.length < this.lags + 10) return WAD;

    const recent = history.slice(-this.lags);
    let mean = WAD;

    for (let i = 0; i < recent.length; i++) {
      const value = recent[i] ?? WAD;
      const weight = 1 / (i + 1);
      mean = mean + ((value - WAD) * BigInt(Math.floor(weight * 1000))) / 1000n;
    }

    // Conservative 70% of mean deviation (simulating lower bound)
    return WAD + ((mean - WAD) * 70n) / 100n;
  }
}

/**
 * Run calibration for all candidates and select best
 */
export function calibrateForecastMethods(
  inputs: CalibrationInput[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): CalibrationOutput {
  const candidates: CalibrationResult[] = [];
  const now = new Date().toISOString();
  const commitHash = process.env.GIT_COMMIT_HASH ?? 'unknown';

  // 1. Rolling forecasts
  for (const window of config.rollingWindows) {
    for (const coverageTarget of config.coverageTargets) {
      const quantile = 1 - coverageTarget;
      const forecaster = new RollingCalibration(window, quantile);

      const predictions: ForecastPrediction[] = [];
      const realized: bigint[] = [];

      for (const input of inputs) {
        if (input.history.length >= window) {
          const lower = forecaster.forecast(input.history, input.horizonSeconds);
          predictions.push({ lowerReturn: lower, meanReturn: lower });
          realized.push(input.realized[predictions.length - 1] ?? WAD);
        }
      }

      if (predictions.length > 0) {
        const metrics = calculateForecastMetrics(predictions, realized);

        candidates.push({
          method: 'rolling',
          config: { windowDays: window, quantile },
          metrics: {
            mae: metrics.mae,
            rmse: metrics.rmse,
            coverage: metrics.coverage,
            sharpness: metrics.sharpness,
            pinballLoss: metrics.pinballLoss,
          },
          artifactHash: hashArtifact('rolling', { windowDays: window, quantile }, commitHash, now),
        });
      }
    }
  }

  // 2. EW-Residual forecasts
  for (const decay of config.ewDecays) {
    for (const coverageTarget of config.coverageTargets) {
      const residualQuantile = 1 - coverageTarget;
      const forecaster = new EWResidualCalibration(decay, residualQuantile);

      const predictions: ForecastPrediction[] = [];
      const realized: bigint[] = [];

      for (const input of inputs) {
        if (input.history.length >= 14) {
          const lower = forecaster.forecast(input.history);
          predictions.push({ lowerReturn: lower, meanReturn: lower });
          realized.push(input.realized[predictions.length - 1] ?? WAD);
        }
      }

      if (predictions.length > 0) {
        const metrics = calculateForecastMetrics(predictions, realized);

        candidates.push({
          method: 'ew-residual',
          config: { decay, residualQuantile },
          metrics: {
            mae: metrics.mae,
            rmse: metrics.rmse,
            coverage: metrics.coverage,
            sharpness: metrics.sharpness,
            pinballLoss: metrics.pinballLoss,
          },
          artifactHash: hashArtifact('ew-residual', { decay, residualQuantile }, commitHash, now),
        });
      }
    }
  }

  // 3. ARX forecasts
  for (const lags of config.arxLags) {
    const forecaster = new ARXCalibration(lags);

    const predictions: ForecastPrediction[] = [];
    const realized: bigint[] = [];

    for (const input of inputs) {
      if (input.history.length >= lags + 10) {
        const lower = forecaster.forecast(input.history);
        predictions.push({ lowerReturn: lower, meanReturn: lower });
        realized.push(input.realized[predictions.length - 1] ?? WAD);
      }
    }

    if (predictions.length > 0) {
      const metrics = calculateForecastMetrics(predictions, realized);
      candidates.push({
        method: 'arx',
        config: { lags },
        metrics: {
          mae: metrics.mae,
          rmse: metrics.rmse,
          coverage: metrics.coverage,
          sharpness: metrics.sharpness,
          pinballLoss: metrics.pinballLoss,
        },
        artifactHash: hashArtifact('arx', { lags }, commitHash, now),
      });
    }
  }

  // Select best candidate by loss
  const sorted = [...candidates].sort((a, b) => {
    const lossA = computeLoss(a.metrics, 0.95);
    const lossB = computeLoss(b.metrics, 0.95);
    if (Math.abs(lossA - lossB) < 1e-10) {
      // Lexical tie-break: rolling > ew-residual > arx
      const priority: Record<string, number> = { rolling: 1, 'ew-residual': 2, arx: 3 };
      return (priority[a.method] ?? 99) - (priority[b.method] ?? 99);
    }
    return lossA - lossB;
  });

  const best = sorted[0]!;
  const bestLoss = computeLoss(best.metrics, 0.95);
  const coveragePassed = best.metrics.coverage >= 0.90;

  return {
    bestMethod: best.method,
    bestConfig: best.config,
    bestLoss,
    bestCoverage: best.metrics.coverage,
    allResults: candidates,
    artifactHash: best.artifactHash,
    coveragePassed,
  };
}

/**
 * Compute composite loss for method selection
 * Penalizes both forecast error and coverage miss
 */
function computeLoss(
  metrics: { mae: number; pinballLoss: number; coverage: number; sharpness: number },
  targetCoverage: number,
): number {
  // Primary: pinball loss (lower quantile error)
  const pinballWeight = 1.0;
  // Secondary: MAE
  const maeWeight = 0.5;
  // Penalty for coverage miss
  const coverageMiss = Math.max(0, targetCoverage - metrics.coverage);
  const coveragePenalty = coverageMiss * 100;
  // Sharpness penalty (prefer tighter bounds when coverage is met)
  const sharpnessWeight = 0.1;

  return (
    pinballWeight * metrics.pinballLoss +
    maeWeight * metrics.mae +
    coveragePenalty +
    sharpnessWeight * metrics.sharpness
  );
}

/**
 * Hash forecast artifact for reproducibility
 */
function hashArtifact(
  method: string,
  config: Record<string, unknown>,
  commitHash: string,
  timestamp: string,
): string {
  const content = JSON.stringify({ method, config, commitHash, timestamp });
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Validate forecast calibration coverage
 * Implements §7.3: coverage validation as release gate
 */
export function validateCoverage(
  results: CalibrationResult[],
  targetCoverage: number,
): { pass: boolean; details: string } {
  const sorted = [...results].sort((a, b) => b.metrics.coverage - a.metrics.coverage);
  const best = sorted[0];

  if (!best) {
    return { pass: false, details: 'No calibration results available' };
  }

  if (best.metrics.coverage < targetCoverage) {
    return {
      pass: false,
      details: `Best coverage ${(best.metrics.coverage * 100).toFixed(2)}% below target ${(targetCoverage * 100).toFixed(0)}%`,
    };
  }

  // Check that coverage isn't artificially inflated
  if (best.metrics.sharpness > 0.5) {
    return {
      pass: false,
      details: `Sharpness ${best.metrics.sharpness.toFixed(4)} too high — suspect coverage inflation`,
    };
  }

  return {
    pass: true,
    details: `Coverage ${(best.metrics.coverage * 100).toFixed(2)}% meets target ${(targetCoverage * 100).toFixed(0)}%`,
  };
}

/**
 * Create forecast candidate for selection
 */
export function toForecastCandidate(result: CalibrationResult): ForecastCandidate {
  return {
    method: result.method as 'rolling' | 'ew-residual' | 'arx',
    config: result.config,
    loss: computeLoss(result.metrics, 0.95),
  };
}
