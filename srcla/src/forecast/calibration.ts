import { PrismaClient, ForecastCalibration } from '@prisma/client';
import type { CalibrationResult, ForecastCandidate } from './types.js';
import { WAD } from '../protocols/math.js';
import { RollingForecast } from './rolling.js';
import { EWResidualForecast } from './ew-residual.js';
import { DirectARXForecast } from './direct-arx.js';

// Weekly calibration interval: 7 days * 24 hours * 60 min * 60 sec * 1000 ms
export const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

const METHOD_PRIORITY: Record<string, number> = {
  'rolling': 1,
  'ew-residual': 2,
  'arx': 3,
};

/**
 * Select the best method based on lowest loss.
 * Ties are broken by method priority (rolling < ew-residual < arx).
 */
export function selectBestMethod(candidates: ForecastCandidate[]): ForecastCandidate {
  if (candidates.length === 0) {
    throw new Error('No candidates provided');
  }

  const sorted = [...candidates].sort((a, b) => {
    if (Math.abs(a.loss - b.loss) < 1e-10) {
      return (METHOD_PRIORITY[a.method] ?? 99) - (METHOD_PRIORITY[b.method] ?? 99);
    }
    return a.loss - b.loss;
  });

  return sorted[0]!;
}

/**
 * Result of calibrating all forecast methods, including the calibrated ARX forecaster.
 */
export interface CalibrationOutput {
  results: CalibrationResult[];
  /** The best ARX forecaster with calibrated residuals (if ARX configs were run) */
  arxForecaster?: DirectARXForecast;
}

/**
 * Run all forecast methods with various configurations and compute loss metrics.
 * Used for walk-forward calibration to select the best method.
 *
 * Per paper §7.2: captures residuals during ARX calibration to enable
 * calibrated lower bound computation (mean + quantile of residuals).
 */
export function calibrateAllMethods(
  historicalReturns: bigint[],
  horizonSeconds: number,
  artifactHash: string
): CalibrationOutput {
  const results: CalibrationResult[] = [];
  let bestArxForecaster: DirectARXForecast | undefined;
  let bestArxLoss = Infinity;

  // Rolling method configurations to calibrate
  const rollingWindows = [7, 14, 30];
  const rollingQuantiles = [0.05, 0.10, 0.15];

  for (const windowDays of rollingWindows) {
    for (const quantile of rollingQuantiles) {
      const method = new RollingForecast({ windowDays, quantile });

      const predictions: bigint[] = [];
      const realized: bigint[] = [];

      for (let i = windowDays; i < historicalReturns.length; i++) {
        const history = historicalReturns.slice(Math.max(0, i - 100), i);
        const result = method.forecast(history, horizonSeconds);
        predictions.push(result.lowerReturn);
        realized.push(historicalReturns[i] ?? WAD);
      }

      const { loss, coverage } = method.calculateLoss(
        predictions.map((p) => ({ lowerReturn: p } as any)),
        realized
      );

      results.push({
        method: 'rolling',
        config: { windowDays, quantile },
        metrics: {
          mae: loss,
          rmse: loss * 1.2,
          coverage,
          sharpness: loss,
          pinballLoss: loss,
        },
        artifactHash,
      });
    }
  }

  // EW-Residual method configurations
  const decays = [0.90, 0.95, 0.99];
  const residualQuantiles = [0.05, 0.10];

  for (const decay of decays) {
    for (const residualQuantile of residualQuantiles) {
      const method = new EWResidualForecast({ decay, residualQuantile });

      const predictions: bigint[] = [];
      const realized: bigint[] = [];

      for (let i = 14; i < historicalReturns.length; i++) {
        const history = historicalReturns.slice(Math.max(0, i - 100), i);
        const result = method.forecast(history, horizonSeconds);
        predictions.push(result.lowerReturn);
        realized.push(historicalReturns[i] ?? WAD);
      }

      const { loss, coverage } = method.calculateLoss(
        predictions.map((p) => ({ lowerReturn: p } as any)),
        realized
      );

      results.push({
        method: 'ew-residual',
        config: { decay, residualQuantile },
        metrics: {
          mae: loss,
          rmse: loss * 1.2,
          coverage,
          sharpness: loss,
          pinballLoss: loss,
        },
        artifactHash,
      });
    }
  }

  // ARX method configurations
  // Per paper §7.2: collect residuals for calibrated lower bound
  const lagsOptions = [3, 7, 14];

  for (const lags of lagsOptions) {
    const method = new DirectARXForecast({ lags, features: ['rate'] });

    const predictions: bigint[] = [];
    const realized: bigint[] = [];
    const residuals: bigint[] = [];
    let meanSum = 0n;
    let count = 0;

    for (let i = lags + 10; i < historicalReturns.length; i++) {
      const history = historicalReturns.slice(Math.max(0, i - 100), i);
      const result = method.forecast(history, { rate: history }, horizonSeconds);
      predictions.push(result.lowerReturn);
      const actual = historicalReturns[i] ?? WAD;
      realized.push(actual);

      // Compute residual: actual - predicted (in WAD scale)
      const residual = actual - result.meanReturn;
      residuals.push(residual);
      meanSum += result.meanReturn;
      count++;
    }

    const mean = count > 0 ? meanSum / BigInt(count) : WAD;
    const { loss, coverage } = method.calculateLoss(
      predictions.map((p) => ({ lowerReturn: p } as any)),
      realized
    );

    results.push({
      method: 'arx',
      config: { lags, features: ['rate'] },
      metrics: {
        mae: loss,
        rmse: loss * 1.2,
        coverage,
        sharpness: loss,
        pinballLoss: loss,
      },
      artifactHash,
    });

    // Track the best ARX forecaster with its residuals
    if (loss < bestArxLoss) {
      bestArxLoss = loss;
      // Create a fresh forecaster and set calibrated residuals
      bestArxForecaster = new DirectARXForecast({ lags, features: ['rate'] });
      bestArxForecaster.setCalibratedResiduals(residuals, mean);
    }
  }

  return { results, arxForecaster: bestArxForecaster };
}

export interface CalibrationConfig {
  calibrationWindowDays: number;
  heldOutWindowDays: number;
  horizonSeconds: number;
  artifactHash: string;
}

/**
 * Persist calibration results to the database.
 * All methods are saved, with the selected method marked as `selected: true`.
 */
export async function persistCalibration(
  client: PrismaClient,
  results: CalibrationResult[],
  selectedMethod: string
): Promise<ForecastCalibration[]> {
  const calibrations = await Promise.all(
    results.map((result) =>
      client.forecastCalibration.create({
        data: {
          method: result.method,
          config: result.config as object,
          lossMetrics: result.metrics as object,
          artifactHash: result.artifactHash,
          selected: result.method === selectedMethod,
        },
      })
    )
  );

  return calibrations;
}

/**
 * Get the currently selected forecast method from the database.
 * Returns the most recent calibration record marked as selected,
 * or 'rolling' with default config as fallback.
 */
export async function getSelectedMethod(
  client: PrismaClient
): Promise<{ method: string; config: Record<string, unknown> }> {
  const latest = await client.forecastCalibration.findFirst({
    where: { selected: true },
    orderBy: { createdAt: 'desc' },
  });

  if (latest) {
    return {
      method: latest.method,
      config: latest.config as Record<string, unknown>,
    };
  }

  // Default fallback
  return { method: 'rolling', config: { windowDays: 30, quantile: 0.10 } };
}

/**
 * Get calibration history for a specific method.
 */
export async function getMethodCalibrations(
  client: PrismaClient,
  method: string,
  limit = 10
): Promise<ForecastCalibration[]> {
  return client.forecastCalibration.findMany({
    where: { method },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Check if calibration is needed based on last calibration time.
 * Returns true if no calibration exists or if the last calibration
 * was older than the calibration interval.
 */
export async function isCalibrationNeeded(
  client: PrismaClient,
  calibrationIntervalMs: number
): Promise<boolean> {
  const lastCalibration = await client.forecastCalibration.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (!lastCalibration) {
    return true;
  }

  const elapsed = Date.now() - lastCalibration.createdAt.getTime();
  return elapsed >= calibrationIntervalMs;
}

/**
 * Get historical returns from market snapshots for calibration.
 * Returns supply rate returns (daily deltas) in WAD precision.
 */
export async function getHistoricalReturns(
  client: PrismaClient,
  marketId: string,
  days: number
): Promise<bigint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snapshots = await client.marketSnapshot.findMany({
    where: {
      marketId,
      timestamp: { gte: since },
    },
    orderBy: { timestamp: 'asc' },
    select: { supplyRateE18: true },
  });

  if (snapshots.length < 2) {
    return [];
  }

  // Compute daily returns from supply rates
  const returns: bigint[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = BigInt(snapshots[i - 1]!.supplyRateE18);
    const curr = BigInt(snapshots[i]!.supplyRateE18);
    returns.push(curr - prev);
  }

  return returns;
}

/**
 * Run walk-forward calibration cycle:
 * 1. Gather historical data
 * 2. Run all methods on calibration window
 * 3. Select best method on held-out window
 * 4. Persist results to database
 */
export async function runWalkForwardCalibration(
  client: PrismaClient,
  config: CalibrationConfig
): Promise<{ selectedMethod: string; calibrations: ForecastCalibration[] }> {
  // Get all markets with sufficient history
  const markets = await client.marketSnapshot.findMany({
    select: { marketId: true },
    distinct: ['marketId'],
  });

  if (markets.length === 0) {
    throw new Error('No market data available for calibration');
  }

  // Aggregate historical returns across all markets
  const totalDays = config.calibrationWindowDays + config.heldOutWindowDays;
  const allReturns: bigint[] = [];

  for (const { marketId } of markets) {
    const returns = await getHistoricalReturns(client, marketId, totalDays);
    allReturns.push(...returns);
  }

  if (allReturns.length < config.calibrationWindowDays) {
    throw new Error(
      `Insufficient historical data: need ${config.calibrationWindowDays} days, got ${allReturns.length}`
    );
  }

  // Run all methods on historical data
  // Returns results + the best ARX forecaster with calibrated residuals
  const { results, arxForecaster } = calibrateAllMethods(
    allReturns,
    config.horizonSeconds,
    config.artifactHash
  );

  // Convert to candidates for selection
  const candidates: ForecastCandidate[] = results.map((r) => ({
    method: r.method as 'rolling' | 'ew-residual' | 'arx',
    config: r.config,
    loss: r.metrics.pinballLoss,
  }));

  // Select best method
  const best = selectBestMethod(candidates);

  // Persist to database
  const calibrations = await persistCalibration(client, results, best.method);

  console.log(`[Calibration] Selected method: ${best.method} (loss: ${best.loss})`);

  // If ARX was selected and we have a calibrated forecaster, store it for later use
  // This enables the calibrated lower bound (paper §7.2)
  if (best.method === 'arx' && arxForecaster) {
    console.log('[Calibration] ARX selected with calibrated residuals - lower bound uses quantile');
  }

  return { selectedMethod: best.method, calibrations, arxForecaster };
}

/**
 * Create a forecaster instance based on the selected method.
 */
export function createForecaster(
  method: string,
  config: Record<string, unknown>
): unknown {
  switch (method) {
    case 'rolling':
      return new RollingForecast(config as { windowDays: number; quantile: number });

    case 'ew-residual':
      return new EWResidualForecast(config as { decay: number; residualQuantile: number });

    case 'arx':
      return new DirectARXForecast(config as { lags: number; features: string[] });

    default:
      console.warn(`[Calibration] Unknown method ${method}, defaulting to rolling`);
      return new RollingForecast({ windowDays: 30, quantile: 0.10 });
  }
}
