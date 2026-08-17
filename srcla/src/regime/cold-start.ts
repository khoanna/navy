/**
 * Cold Start Enforcer - Manages market cold start periods
 *
 * Implements cold start requirements per SRCLA design Section 6.2:
 * - Minimum 7-day observation period before market is eligible
 * - Reduced capacity limits (50% of normal)
 * - Increased reserve requirements (150% of normal)
 *
 * Cold start is required when:
 * - A new market is first admitted
 * - A material configuration change occurs (proxy, rate model, rewards, oracle)
 */

import { ColdStartStatus } from './types.js';

/**
 * Cold start configuration parameters
 */
export interface ColdStartConfig {
  /** Minimum days of observation before market is eligible */
  minObservationDays: number;
  /** Capacity reduction factor during cold start (e.g., 50 = 50%) */
  capacityReductionFactor: number;
  /** Reserve increase factor during cold start (e.g., 150 = 150%) */
  reserveIncreaseFactor: number;
  /** Minimum completed outcomes required during observation */
  minCompletedOutcomes: number;
  /** Whether to allow any deployment during cold start */
  allowReducedDeployment: boolean;
}

/**
 * Default cold start configuration
 */
export const DEFAULT_COLD_START_CONFIG: ColdStartConfig = {
  minObservationDays: 7,
  capacityReductionFactor: 50, // 50% of normal capacity
  reserveIncreaseFactor: 150, // 150% of normal reserves
  minCompletedOutcomes: 10,
  allowReducedDeployment: true,
};

/**
 * Cold start record for a market
 */
export interface ColdStartRecord {
  /** Market identifier */
  marketId: string;
  /** When cold start began */
  startedAt: Date;
  /** Original configuration digest */
  configDigest: string;
  /** Whether cold start has been completed */
  completed: boolean;
  /** When cold start completed (if completed) */
  completedAt: Date | null;
  /** Number of completed observations recorded */
  completedOutcomes: number;
}

/**
 * Cold Start Enforcer for managing market admission periods
 *
 * Enforces cold start requirements before markets can receive
 * full allocation or be considered for active trading.
 */
export class ColdStartEnforcer {
  private config: ColdStartConfig;
  private coldStartRecords: Map<string, ColdStartRecord> = new Map();

  constructor(config: Partial<ColdStartConfig> = {}) {
    this.config = { ...DEFAULT_COLD_START_CONFIG, ...config };
  }

  /**
   * Start cold start period for a market
   */
  startColdStart(
    marketId: string,
    configDigest: string,
    timestamp?: Date
  ): void {
    const now = timestamp ?? new Date();

    this.coldStartRecords.set(marketId, {
      marketId,
      startedAt: now,
      configDigest,
      completed: false,
      completedAt: null,
      completedOutcomes: 0,
    });
  }

  /**
   * Record a completed outcome during cold start
   * (e.g., a finished horizon period with realized return)
   */
  recordOutcome(marketId: string, outcomeTimestamp?: Date): void {
    const record = this.coldStartRecords.get(marketId);
    if (!record || record.completed) {
      return;
    }

    record.completedOutcomes++;

    // Check if cold start can be completed
    if (this.shouldCompleteColdStart(record)) {
      record.completed = true;
      record.completedAt = outcomeTimestamp ?? new Date();
    }
  }

  /**
   * Check if cold start should complete
   */
  private shouldCompleteColdStart(record: ColdStartRecord): boolean {
    const now = new Date();
    const msSinceStart = now.getTime() - record.startedAt.getTime();
    const daysSinceStart = msSinceStart / (24 * 60 * 60 * 1000);

    // Must meet both time and outcome requirements
    const timeRequirementMet = daysSinceStart >= this.config.minObservationDays;
    const outcomesRequirementMet =
      record.completedOutcomes >= this.config.minCompletedOutcomes;

    return timeRequirementMet && outcomesRequirementMet;
  }

  /**
   * Get cold start status for a market
   */
  getColdStartStatus(marketId: string): ColdStartStatus {
    const record = this.coldStartRecords.get(marketId);

    if (!record) {
      return {
        isColdStart: true,
        daysActive: 0,
        reducedCapacityFactor: this.config.capacityReductionFactor,
        increasedReserveFactor: this.config.reserveIncreaseFactor,
      };
    }

    if (record.completed) {
      return {
        isColdStart: false,
        daysActive: this.config.minObservationDays,
        reducedCapacityFactor: 100,
        increasedReserveFactor: 100,
      };
    }

    const now = new Date();
    const msSinceStart = now.getTime() - record.startedAt.getTime();
    const daysActive = Math.floor(msSinceStart / (24 * 60 * 60 * 1000));

    return {
      isColdStart: true,
      daysActive,
      reducedCapacityFactor: this.config.capacityReductionFactor,
      increasedReserveFactor: this.config.reserveIncreaseFactor,
    };
  }

  /**
   * Get cold start record for a market
   */
  getColdStartRecord(marketId: string): ColdStartRecord | null {
    return this.coldStartRecords.get(marketId) ?? null;
  }

  /**
   * Check if a market is eligible for reduced deployment during cold start
   */
  isEligibleForReducedDeployment(marketId: string): boolean {
    if (!this.config.allowReducedDeployment) {
      return false;
    }

    const status = this.getColdStartStatus(marketId);
    if (!status.isColdStart) {
      return true; // Not in cold start, full eligibility
    }

    // During cold start, require at least some minimum activity
    const record = this.coldStartRecords.get(marketId);
    if (!record) {
      return false;
    }

    // Must have recorded at least 3 completed outcomes
    return record.completedOutcomes >= 3;
  }

  /**
   * Get effective capacity considering cold start
   */
  getEffectiveCapacity(
    marketId: string,
    normalCapacity: bigint
  ): bigint {
    const status = this.getColdStartStatus(marketId);

    if (!status.isColdStart) {
      return normalCapacity;
    }

    // Apply reduced capacity during cold start
    return (normalCapacity * BigInt(status.reducedCapacityFactor)) / 100n;
  }

  /**
   * Get effective reserve requirement considering cold start
   */
  getEffectiveReserve(
    marketId: string,
    normalReserve: bigint
  ): bigint {
    const status = this.getColdStartStatus(marketId);

    if (!status.isColdStart) {
      return normalReserve;
    }

    // Apply increased reserve during cold start
    return (normalReserve * BigInt(status.increasedReserveFactor)) / 100n;
  }

  /**
   * Get days remaining in cold start
   */
  getDaysRemaining(marketId: string): number {
    const status = this.getColdStartStatus(marketId);
    if (!status.isColdStart) {
      return 0;
    }
    return Math.max(0, this.config.minObservationDays - status.daysActive);
  }

  /**
   * Check if a market is fully eligible (cold start completed)
   */
  isFullyEligible(marketId: string): boolean {
    const status = this.getColdStartStatus(marketId);
    return !status.isColdStart;
  }

  /**
   * Force complete cold start (admin function)
   * Used for emergency activation or testing
   */
  forceCompleteColdStart(marketId: string): boolean {
    const record = this.coldStartRecords.get(marketId);
    if (!record) {
      return false;
    }

    record.completed = true;
    record.completedAt = new Date();
    return true;
  }

  /**
   * Get all markets in cold start
   */
  getMarketsInColdStart(): string[] {
    const markets: string[] = [];
    for (const [marketId] of this.coldStartRecords) {
      const status = this.getColdStartStatus(marketId);
      if (status.isColdStart) {
        markets.push(marketId);
      }
    }
    return markets;
  }

  /**
   * Get all markets with completed cold start
   */
  getMarketsCompletedColdStart(): string[] {
    const markets: string[] = [];
    for (const [marketId] of this.coldStartRecords) {
      const status = this.getColdStartStatus(marketId);
      if (!status.isColdStart) {
        markets.push(marketId);
      }
    }
    return markets;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalMarkets: number;
    inColdStart: number;
    completed: number;
    eligibleForReduced: number;
    fullyEligible: number;
    avgDaysRemaining: number;
  } {
    let inColdStart = 0;
    let completed = 0;
    let eligibleForReduced = 0;
    let fullyEligible = 0;
    let totalDaysRemaining = 0;

    for (const [marketId] of this.coldStartRecords) {
      const status = this.getColdStartStatus(marketId);

      if (status.isColdStart) {
        inColdStart++;
        totalDaysRemaining += this.getDaysRemaining(marketId);

        if (this.isEligibleForReducedDeployment(marketId)) {
          eligibleForReduced++;
        }
      } else {
        completed++;
        fullyEligible++;
      }
    }

    return {
      totalMarkets: this.coldStartRecords.size,
      inColdStart,
      completed,
      eligibleForReduced,
      fullyEligible,
      avgDaysRemaining:
        inColdStart > 0 ? Math.floor(totalDaysRemaining / inColdStart) : 0,
    };
  }
}
