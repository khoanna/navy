/**
 * Forecast metrics: MAE, RMSE, MASE, coverage, sharpness
 */

export interface ForecastMetrics {
  mae: number;        // Mean Absolute Error
  rmse: number;       // Root Mean Square Error
  mase: number;       // Mean Absolute Scaled Error
  pinballLoss: number;
  coverage: number;   // Actual coverage rate (lower bound coverage)
  sharpness: number;  // Mean width of prediction interval
}

export interface ForecastPrediction {
  lowerReturn: bigint;  // Lower bound in E18
  meanReturn: bigint;   // Mean forecast in E18
}

/**
 * Calculate forecast metrics from predictions and realized returns
 */
export function calculateForecastMetrics(
  predictions: ForecastPrediction[],
  realized: bigint[],
): ForecastMetrics {
  if (predictions.length === 0 || realized.length === 0) {
    return { mae: 0, rmse: 0, mase: 0, pinballLoss: 0, coverage: 0, sharpness: 0 };
  }

  let totalAbsError = 0;
  let totalSquaredError = 0;
  let belowCount = 0;
  let totalSharpness = 0;

  for (let i = 0; i < Math.min(predictions.length, realized.length); i++) {
    const pred = predictions[i]!;
    const real = realized[i]!;

    const error = Number(pred.lowerReturn - real) / 1e18;
    totalAbsError += Math.abs(error);
    totalSquaredError += error * error;

    // Coverage: real should be >= lower bound
    if (real < pred.lowerReturn) {
      belowCount++;
    }

    // Sharpness: width of interval
    const width = Number(pred.meanReturn - pred.lowerReturn) / 1e18;
    totalSharpness += Math.abs(width);
  }

  const n = Math.min(predictions.length, realized.length);
  const mae = totalAbsError / n;
  const rmse = Math.sqrt(totalSquaredError / n);
  const coverage = belowCount / n;
  const sharpness = totalSharpness / n;

  // MASE = MAE / MAE of naive (random walk) forecast
  const naiveMae = calculateNaiveMae(realized);
  const mase = naiveMae > 0 ? mae / naiveMae : 0;

  return { mae, rmse, mase, pinballLoss: mae, coverage, sharpness };
}

function calculateNaiveMae(realized: bigint[]): number {
  if (realized.length < 2) return 1;
  let totalError = 0;
  for (let i = 1; i < realized.length; i++) {
    const curr = realized[i]!;
    const prev = realized[i - 1]!;
    const error = Number(curr - prev) / 1e18;
    totalError += Math.abs(error);
  }
  return totalError / (realized.length - 1);
}
