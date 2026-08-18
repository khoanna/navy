/**
 * Cold-Start Rules for Market Eligibility
 *
 * Per SRCLA Design §7: Markets require a minimum observation history before
 * receiving full allocation weight. During the cold-start period, markets
 * receive reduced capacity and higher reserve requirements.
 *
 * - Minimum 30 observations before a market is eligible
 * - 7-day cold-start period after first observation
 * - Cold-start markets get 50% capacity factor and 1.5x reserve adjustment
 */

import type { MarketSnapshot } from '../domain/snapshots.js';

/**
 * Cold-start eligibility configuration
 */
export interface ColdStartConfig {
  /** Minimum number of observations before market is eligible */
  minObservations: number;
  /** Cold-start period in days after first observation */
  coldStartDays: number;
  /** Capacity factor applied during cold-start (0.5 = 50%) */
  coldStartCapacityFactor: number;
  /** Reserve multiplier applied during cold-start */
  coldStartReserveFactor: number;
}

/** Default cold-start configuration per SRCLA §7 */
export const DEFAULT_COLD_START_CONFIG: ColdStartConfig = {
  minObservations: 30,
  coldStartDays: 7,
  coldStartCapacityFactor: 0.5,
  coldStartReserveFactor: 1.5,
};

/**
 * Reason why a market is not at full capacity
 */
export type ColdStartReason =
  | 'INSUFFICIENT_OBSERVATIONS'
  | 'COLD_START_PERIOD'
  | 'FULL_CAPACITY';

/**
 * Cold-start eligibility status for a market
 */
export interface ColdStartStatus {
  /** Whether the market passes cold-start rules */
  eligible: boolean;
  /** Reason code for the current status */
  reason: ColdStartReason;
  /** Human-readable description */
  details: string;
  /** Capacity factor to apply (0 = excluded, 0.5 = cold-start, 1.0 = full) */
  weightCap: number;
  /** Reserve multiplier to apply (1.0 = normal, 1.5 = cold-start) */
  reserveAdjustment: number;
}

/**
 * Market observation data for cold-start evaluation
 */
export interface MarketObservations {
  /** Number of observations collected */
  observationCount: number;
  /** Date of first observation */
  firstObservationDate: Date;
}

/**
 * Check cold-start eligibility for a market.
 *
 * A market is:
 * - NOT ELIGIBLE if it has fewer than minObservations
 * - LIMITED if it has sufficient observations but is still within the cold-start period
 * - FULLY ELIGIBLE if past the cold-start period
 */
export function checkColdStartEligibility(
  marketId: string,
  observationCount: number,
  firstObservationDate: Date,
  currentDate: Date,
  config: ColdStartConfig = DEFAULT_COLD_START_CONFIG
): ColdStartStatus {
  const daysSinceFirstObs = daysBetween(firstObservationDate, currentDate);

  if (observationCount < config.minObservations) {
    return {
      eligible: false,
      reason: 'INSUFFICIENT_OBSERVATIONS',
      details: `Market '${marketId}' needs ${config.minObservations} observations, has ${observationCount}`,
      weightCap: 0,
      reserveAdjustment: 1.0,
    };
  }

  if (daysSinceFirstObs < config.coldStartDays) {
    const daysRemaining = config.coldStartDays - daysSinceFirstObs;
    return {
      eligible: true,
      reason: 'COLD_START_PERIOD',
      details: `Market '${marketId}' in cold-start: ${daysRemaining} day(s) remaining`,
      weightCap: config.coldStartCapacityFactor,
      reserveAdjustment: config.coldStartReserveFactor,
    };
  }

  return {
    eligible: true,
    reason: 'FULL_CAPACITY',
    details: `Market '${marketId}' fully eligible`,
    weightCap: 1.0,
    reserveAdjustment: 1.0,
  };
}

/**
 * Check cold-start eligibility from a MarketSnapshot and observation data.
 *
 * This overload allows passing the market ID from the snapshot directly.
 */
export function checkColdStartFromSnapshot(
  snapshot: MarketSnapshot,
  observations: MarketObservations,
  currentDate: Date,
  config: ColdStartConfig = DEFAULT_COLD_START_CONFIG
): ColdStartStatus {
  return checkColdStartEligibility(
    snapshot.marketId,
    observations.observationCount,
    observations.firstObservationDate,
    currentDate,
    config
  );
}

/**
 * Compute the effective allocation cap for a market based on cold-start status.
 *
 * @param marketId - Market identifier
 * @param observationCount - Number of observations
 * @param firstObservationDate - Date of first observation
 * @param currentDate - Current evaluation date
 * @param totalAssets - Total vault assets
 * @param marketCapBps - Market-specific cap in basis points (default 10000 = 100%)
 * @param config - Cold-start configuration
 * @returns Effective allocation cap in base units
 */
export function computeColdStartAllocationCap(
  marketId: string,
  observationCount: number,
  firstObservationDate: Date,
  currentDate: Date,
  totalAssets: bigint,
  marketCapBps: number = 10000,
  config: ColdStartConfig = DEFAULT_COLD_START_CONFIG
): bigint {
  const status = checkColdStartEligibility(
    marketId,
    observationCount,
    firstObservationDate,
    currentDate,
    config
  );

  // No allocation for ineligible markets
  if (status.weightCap === 0) {
    return 0n;
  }

  // Apply weight cap to the market's proportional cap
  const baseCap = (totalAssets * BigInt(marketCapBps)) / 10000n;
  const weightFactor = BigInt(Math.floor(status.weightCap * 10000));
  const effectiveCap = (baseCap * weightFactor) / 10000n;

  return effectiveCap;
}

/**
 * Calculate days between two dates (integer days, floor).
 */
export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
}
