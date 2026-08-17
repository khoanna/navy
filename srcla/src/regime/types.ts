/**
 * Regime tracking type definitions for SRCLA
 *
 * Defines market regime states, transitions, and cold start requirements
 * per SRCLA design Section 6.2 (Admission and configuration regimes).
 */

/**
 * Market regime states reflecting market conditions and risk levels.
 *
 * - STEADY: Normal market conditions, standard operating parameters
 * - VOLATILE: Elevated uncertainty, wider spreads and rate fluctuations
 * - STRESSED: Significant market stress, elevated risk conditions
 * - RECOVERY: Post-stress recovery phase with improving conditions
 */
export enum RegimeState {
  STEADY = 'STEADY',
  VOLATILE = 'VOLATILE',
  STRESSED = 'STRESSED',
  RECOVERY = 'RECOVERY',
}

/**
 * Regime transition record for audit trail.
 * Records every regime state change with metadata for traceability.
 */
export interface RegimeTransition {
  /** Unique market identifier */
  marketId: string;
  /** Previous regime state */
  from: RegimeState;
  /** New regime state */
  to: RegimeState;
  /** Configuration digest at time of transition */
  configDigest: string;
  /** Block hash at transition time */
  blockHash: string;
  /** Timestamp of the transition */
  timestamp: Date;
  /** Human-readable reason for the transition */
  reason: string;
}

/**
 * Cold start status for newly admitted or reconfigured markets.
 * Enforces minimum observation period and reduced operational parameters.
 *
 * Per SRCLA design Section 6.2:
 * - Minimum 7-day observation period
 * - Reduced capacity limits (50% of normal)
 * - Increased reserve requirements (150% of normal)
 */
export interface ColdStartStatus {
  /** Whether the market is in cold start period */
  isColdStart: boolean;
  /** Number of days since regime activation */
  daysActive: number;
  /** Capacity multiplier during cold start (e.g., 0.5 = 50% of normal) */
  reducedCapacityFactor: number;
  /** Reserve multiplier during cold start (e.g., 1.5 = 150% of normal) */
  increasedReserveFactor: number;
}

/**
 * Regime thresholds for state transitions.
 * Calibrated based on historical volatility and market stress indicators.
 */
export interface RegimeThresholds {
  /** Maximum utilization ratio for STEADY state (RAY format) */
  steadyUtilizationMax: bigint;
  /** Maximum volatility (annualized) for STEADY state (WAD format) */
  steadyVolatilityMax: bigint;
  /** Maximum utilization ratio for VOLATILE state */
  volatileUtilizationMax: bigint;
  /** Maximum volatility for VOLATILE state */
  volatileVolatilityMax: bigint;
  /** Maximum utilization ratio for STRESSED state */
  stressedUtilizationMax: bigint;
  /** Maximum volatility for STRESSED state */
  stressedVolatilityMax: bigint;
}

/**
 * Market regime configuration and state.
 * Tracks regime history and cold start status per market.
 */
export interface RegimeConfig {
  /** Unique market identifier */
  marketId: string;
  /** Current regime state */
  currentState: RegimeState;
  /** Configuration digest for current regime */
  configDigest: string;
  /** When this regime was activated */
  activatedAt: Date;
  /** Minimum days of observation before market is eligible */
  minObservationDays: number;
  /** Minimum completed outcomes required before eligibility */
  minCompletedOutcomes: number;
}

/**
 * Regime observation metrics used for state classification.
 * Derived from market snapshot data.
 */
export interface RegimeMetrics {
  /** Market identifier */
  marketId: string;
  /** Current supply rate (WAD format, e.g., 50000000000000000n = 5%) */
  supplyRateE18: bigint;
  /** Current utilization ratio (RAY format) */
  utilizationE18: bigint;
  /** Estimated volatility of returns (annualized, WAD format) */
  volatilityE18: bigint;
  /** Config digest from snapshot */
  configDigest: string;
  /** Block hash from snapshot */
  blockHash: string;
  /** Timestamp of observation */
  timestamp: Date;
}

/**
 * Regime detector configuration for state transitions.
 */
export interface RegimeDetectorConfig {
  /** Regime thresholds for state classification */
  thresholds: RegimeThresholds;
  /** Minimum days before regime can change to STRESSED */
  minDaysBeforeStress: number;
  /** Hysteresis buffer for regime transitions (basis points) */
  hysteresisBps: number;
  /** Minimum observation period in days for new markets */
  coldStartDays: number;
  /** Capacity reduction factor during cold start */
  coldStartCapacityFactor: number;
  /** Reserve increase factor during cold start */
  coldStartReserveFactor: number;
}
