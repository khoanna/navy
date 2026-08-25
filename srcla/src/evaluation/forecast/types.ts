/**
 * Forecast Types
 */

/**
 * Individual market forecast result
 */
export interface ForecastResult {
  market: string;
  predictedRate: number; // Expected rate (mean)
  lowerBound: number; // Lower prediction bound
  upperBound: number; // Upper prediction bound
  confidence: number; // Confidence level (e.g., 0.95)
  zScore: number; // Z-score used for bounds
  volatility: number; // Historical volatility
  coverageCount: number; // Number of points within bounds
  totalCount: number; // Total data points
}

/**
 * Calibration result for all markets
 */
export interface CalibrationResult {
  calibrated: boolean;
  zScore: number;
  windowDays: number;
  allResults: Map<string, ForecastResult>;
  warnings: string[];
}
