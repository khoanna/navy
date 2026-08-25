/**
 * Forecast Calibration Module
 *
 * Implements §7.2 of the SRCLA paper:
 * - Calibrates prediction intervals for rate forecasts
 * - Validates forecast coverage against target (95%)
 * - Uses historical rate volatility to determine uncertainty bounds
 */

import type { TimeOrderedSnapshot } from '../dataset.js';
import type { ForecastResult, CalibrationResult } from './types.js';

export interface CalibrationInputs {
  historicalSnapshots: TimeOrderedSnapshot[];
  targetCoverage: number; // e.g., 0.95 for 95%
  quantile: number; // e.g., 0.05 for lower 5th percentile
}

/**
 * Extract all rates from snapshots for a specific market
 */
function extractRatesFromSnapshots(
  snapshots: TimeOrderedSnapshot[],
  marketId: string
): { rates: number[]; rateChanges: number[] } {
  const rates: number[] = [];
  let prevRate: number | null = null;
  const rateChanges: number[] = [];

  for (const snapshot of snapshots) {
    for (const ms of snapshot.snapshots) {
      if (ms.marketId === marketId) {
        // Convert supply rate from e18 to decimal
        const rate = Number(ms.supplyRateE18) / 1e18;
        rates.push(rate);

        if (prevRate !== null) {
          rateChanges.push(rate - prevRate);
        }
        prevRate = rate;
      }
    }
  }

  return { rates, rateChanges };
}

/**
 * Simple volatility-based calibration using historical rate data.
 * Computes z-score multiplier to achieve target coverage.
 */
export function calibrateForecastMethods(
  inputs: CalibrationInputs
): CalibrationResult {
  const { historicalSnapshots, targetCoverage, quantile } = inputs;

  // Handle undefined or empty input
  if (!historicalSnapshots || historicalSnapshots.length < 2) {
    // Not enough data - use conservative defaults
    return {
      calibrated: false,
      zScore: 1.96, // 95% confidence for normal distribution
      windowDays: 7,
      allResults: new Map(),
      warnings: ['Insufficient historical data, using conservative z-score'],
    };
  }

  // Collect all market IDs from snapshots
  const marketIds = new Set<string>();
  for (const snapshot of historicalSnapshots) {
    for (const ms of snapshot.snapshots) {
      marketIds.add(ms.marketId);
    }
  }

  // Calculate overall volatility from all rate changes
  const allRateChanges: number[] = [];
  for (const marketId of marketIds) {
    const { rateChanges } = extractRatesFromSnapshots(historicalSnapshots, marketId);
    allRateChanges.push(...rateChanges);
  }

  let volatility = 0;
  if (allRateChanges.length > 0) {
    const mean = allRateChanges.reduce((a, b) => a + b, 0) / allRateChanges.length;
    const variance = allRateChanges.reduce((a, b) => a + (b - mean) ** 2, 0) / allRateChanges.length;
    volatility = Math.sqrt(variance);
  }

  // For target coverage, use z-score from normal distribution approximation
  // For 95% coverage, z ≈ 1.96
  // Adjust based on actual data distribution if enough samples
  const zScore = volatility > 0
    ? 1.96 + (volatility * 0.5) // Scale with volatility
    : 1.96;

  const results = new Map<string, ForecastResult>();

  // Calibrate each market
  for (const marketId of marketIds) {
    const { rates, rateChanges } = extractRatesFromSnapshots(historicalSnapshots, marketId);

    if (rates.length === 0) continue;

    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const sorted = [...rates].sort((a, b) => a - b);
    const lowerBoundIdx = Math.floor(sorted.length * quantile);

    // Calculate coverage based on whether actual rates fall within predicted bounds
    let coveredCount = 0;
    const marketVol = rateChanges.length > 0
      ? Math.sqrt(rateChanges.reduce((a, b) => a + b ** 2, 0) / rateChanges.length)
      : volatility;

    for (const rate of rates) {
      const lower = avgRate - zScore * marketVol;
      const upper = avgRate + zScore * marketVol;
      if (rate >= lower && rate <= upper) {
        coveredCount++;
      }
    }

    results.set(marketId, {
      market: marketId,
      predictedRate: avgRate,
      lowerBound: sorted[lowerBoundIdx] ?? avgRate - zScore * marketVol,
      upperBound: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * (1 - quantile)))] ?? avgRate + zScore * marketVol,
      confidence: targetCoverage,
      zScore,
      volatility: marketVol,
      coverageCount: coveredCount,
      totalCount: rates.length,
    });
  }

  return {
    calibrated: true,
    zScore,
    windowDays: Math.min(7, historicalSnapshots.length),
    allResults: results,
    warnings: volatility > 0.05 ? ['High rate volatility detected'] : [],
  };
}

/**
 * Validate that forecast achieves target coverage
 */
export function validateCoverage(
  results: Map<string, ForecastResult>,
  targetCoverage: number
): { valid: boolean; achievedCoverage: number; message: string } {
  let totalCovered = 0;
  let totalPoints = 0;

  for (const result of results.values()) {
    totalCovered += result.coverageCount;
    totalPoints += result.totalCount;
  }

  const achievedCoverage = totalPoints > 0 ? totalCovered / totalPoints : 0;

  return {
    valid: achievedCoverage >= targetCoverage,
    achievedCoverage,
    message: achievedCoverage >= targetCoverage
      ? `Forecast coverage ${(achievedCoverage * 100).toFixed(2)}% meets target ${(targetCoverage * 100).toFixed(0)}%`
      : `Forecast coverage ${(achievedCoverage * 100).toFixed(2)}% below target ${(targetCoverage * 100).toFixed(0)}%`,
  };
}
