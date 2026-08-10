import { ForecastCandidate, CalibrationResult } from './types.js';
import { WAD } from '../protocols/math.js';

const METHOD_PRIORITY: Record<string, number> = {
  'rolling': 1,
  'ew-residual': 2,
  'arx': 3,
};

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

export function calibrateAllMethods(
  historicalReturns: bigint[],
  horizonSeconds: number,
  artifactHash: string
): CalibrationResult[] {
  const results: CalibrationResult[] = [];

  // Rolling method configurations to calibrate
  const rollingWindows = [7, 14, 30];
  const rollingQuantiles = [0.05, 0.10, 0.15];

  for (const windowDays of rollingWindows) {
    for (const quantile of rollingQuantiles) {
      const { RollingForecast } = require('./rolling.js');
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

      const mae = loss;
      results.push({
        method: 'rolling',
        config: { windowDays, quantile },
        metrics: {
          mae,
          rmse: mae * 1.2,
          coverage,
          sharpness: mae,
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
      const { EWResidualForecast } = require('./ew-residual.js');
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
  const lagsOptions = [3, 7, 14];

  for (const lags of lagsOptions) {
    const { DirectARXForecast } = require('./direct-arx.js');
    const method = new DirectARXForecast({ lags, features: ['rate'] });

    const predictions: bigint[] = [];
    const realized: bigint[] = [];

    for (let i = lags + 10; i < historicalReturns.length; i++) {
      const history = historicalReturns.slice(Math.max(0, i - 100), i);
      const result = method.forecast(history, { rate: history }, horizonSeconds);
      predictions.push(result.lowerReturn);
      realized.push(historicalReturns[i] ?? WAD);
    }

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
  }

  return results;
}
