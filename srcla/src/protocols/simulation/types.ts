/**
 * Simulation Module Types
 *
 * Type definitions for the SRCLA post-deposit simulation system.
 * These types model how lending protocol interest rates change when
 * new capital is deposited, enabling SRCLA to make informed allocation
 * decisions based on projected yields rather than current APY.
 *
 * @module protocols/simulation
 */

import { WAD, RAY } from '../math.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for Aave V3 interest rate simulation.
 *
 * Aave V3 uses a piecewise interest rate model with an optimal utilization
 * point. Below optimal utilization, rates increase quadratically from baseRate.
 * Above optimal, rates grow at a steeper slope.
 *
 * Rate formula (per §6.3 - exact DefaultReserveInterestRateStrategy):
 *   - If u <= optimalUtilization: rate = baseRate + slope1 * (u/optimal)^2
 *   - If u > optimalUtilization: rate = baseRate + slope1 + slope2 * excessRatio^2
 *
 * @example
 * ```typescript
 * const config: AaveSimulatorConfig = {
 *   baseRate: 0n,                          // 0% base rate
 *   variableRateSlope1: 4n * WAD / 100n,   // 4% slope below optimal
 *   variableRateSlope2: 60n * WAD / 100n,  // 60% slope above optimal
 *   optimalUtilization: 8n * RAY / 10n,   // 80% optimal utilization
 *   maxUtilization: 95n * RAY / 100n,      // 95% max to avoid insolvency
 * };
 * ```
 */
export interface AaveSimulatorConfig {
  /** Base interest rate at 0% utilization (WAD, e.g., 0 = 0%) */
  baseRate: bigint;
  /** First slope for rate increase below optimal utilization (WAD) */
  variableRateSlope1: bigint;
  /** Second slope for rate increase above optimal utilization (WAD) */
  variableRateSlope2: bigint;
  /** Optimal utilization point (RAY, e.g., 8e17 = 80%) */
  optimalUtilization: bigint;
  /** Maximum safe utilization (RAY, e.g., 95e16 = 95%) */
  maxUtilization: bigint;
}

/**
 * Configuration for Compound III interest rate simulation.
 *
 * Compound III uses a kinked linear interest rate model based on utilization.
 * The rate has a "kink" point where the slope changes, per Compound Comet governance.
 *
 * Rate formula (per docs.compound.finance/interest-rates/):
 *   - if util <= kink: rate = baseRate + slopeLow * util
 *   - if util > kink:  rate = baseRate + slopeLow * kink + slopeHigh * (util - kink)
 *
 * @example
 * ```typescript
 * const config: CompoundSimulatorConfig = {
 *   baseRate: 3n * WAD / 100n,          // 3% APY minimum
 *   kink: 8n * RAY / 10n,               // 80% kink point
 *   slopeLow: 625n * WAD / 10_000n,       // 6.25% WAD -> 8% APY at 80% kink
 *   slopeHigh: WAD,                         // 100% WAD -> ~28% APY at 100% util
 * };
 * ```
 */
export interface CompoundSimulatorConfig {
  /** Annualized base rate at 0% utilization (WAD, e.g., 3e16 = 3%) */
  baseRate: bigint;
  /** Utilization kink point (RAY, e.g., 8e17 = 80%) */
  kink: bigint;
  /** Annualized slope below kink (WAD / RAY) */
  slopeLow: bigint;
  /** Annualized slope above kink (WAD / RAY) */
  slopeHigh: bigint;
}

/**
 * Configuration for Moonwell interest rate simulation.
 *
 * Moonwell is a Compound III fork with Apollo oracle bounds. The rate is
 * similar to Compound III but bounded by [minRate, maxRate] from the oracle.
 *
 * @example
 * ```typescript
 * const config: MoonwellSimulatorConfig = {
 *   baseRate: 3n * WAD / 100n,              // 3% APY minimum
 *   kink: 8n * RAY / 10n,                   // 80% kink point
 *   slopeLow: 625n * WAD / 10_000n,        // 6.25% WAD -> 8% APY at 80% kink
 *   slopeHigh: WAD,                          // 100% WAD -> ~28% APY at 100% util
 *   minRate: 1n * WAD / 100n,              // 1% APY floor from oracle
 *   maxRate: 20n * WAD / 100n,              // 20% APY ceiling from oracle
 * };
 * ```
 */
export interface MoonwellSimulatorConfig extends CompoundSimulatorConfig {
  /** Minimum rate bound from Apollo oracle (WAD) */
  minRate: bigint;
  /** Maximum rate bound from Apollo oracle (WAD) */
  maxRate: bigint;
}

// ============================================================================
// Market State Types
// ============================================================================

/**
 * Current state of a lending market used in simulation.
 *
 * Represents the on-chain state of a protocol at a point in time,
 * used as input for post-deposit rate simulation.
 */
export interface MarketState {
  /** Unique identifier for the market (e.g., adapter address) */
  marketId: string;
  /** Human-readable name */
  name: string;
  /** Current cash (liquidity) in the market (USDC base units) */
  cash: bigint;
  /** Current total borrows outstanding (USDC base units) */
  borrows: bigint;
  /** Current reserves (for markets that track them) */
  reserves?: bigint;
  /** Current annualized supply rate (WAD) */
  supplyRate: bigint;
  /** Block number this state was captured at */
  blockNumber?: number;
  /** Timestamp of this state */
  timestamp?: number;
}

// ============================================================================
// Simulation Result Types
// ============================================================================

/**
 * Result of post-deposit interest rate simulation.
 *
 * Contains pre- and post-deposit rates and utilizations, enabling
 * SRCLA to calculate the marginal yield impact of a deposit.
 */
export interface SimulatedRate {
  /** Market identifier */
  marketId: string;
  /** Annualized supply rate before deposit (WAD) */
  preDepositRate: bigint;
  /** Annualized supply rate after deposit (WAD) */
  postDepositRate: bigint;
  /** Utilization before deposit (RAY) */
  utilizationBefore: bigint;
  /** Utilization after deposit (RAY) */
  utilizationAfter: bigint;
  /** Maximum deposit amount without exceeding maxUtilization (USDC base units) */
  effectiveCapacity: bigint;
  /** Available capacity after this deposit (USDC base units, floor at 0) */
  capacityRemaining: bigint;
  /** Rate reduction from capacity constraints (WAD, positive value, 0 if below optimal) */
  ratePenalty: bigint;
}

/**
 * Extended simulation result with additional metadata.
 */
export interface DetailedSimulatedRate extends SimulatedRate {
  /** Human-readable market name */
  marketName: string;
  /** Amount of the simulated deposit (USDC base units) */
  simulatedDeposit: bigint;
  /** Rate reduction due to deposit (WAD, positive value) */
  rateImpact: bigint;
  /** Percentage rate reduction (WAD, e.g., 5e15 = 0.5%) */
  rateImpactPercent: bigint;
  /** Whether the deposit would exceed maxUtilization */
  wouldExceedCapacity: boolean;
}

// ============================================================================
// Simulator Interface
// ============================================================================

/**
 * Base simulator interface for all lending protocols.
 *
 * Each protocol implements this interface to provide protocol-specific
 * interest rate simulation based on their mathematical models.
 */
export interface ISimulator {
  /**
   * Simulate the post-deposit interest rate.
   *
   * @param state - Current market state
   * @param depositAmount - Amount to deposit (USDC base units)
   * @param config - Protocol-specific configuration
   * @returns Simulated rate with pre/post comparison
   */
  simulateRate(
    state: MarketState,
    depositAmount: bigint,
    config: SimulatorConfig
  ): SimulatedRate;

  /**
   * Calculate the current utilization ratio.
   *
   * @param cash - Current cash in market
   * @param borrows - Current borrows outstanding
   * @returns Utilization ratio (RAY)
   */
  calculateUtilization(cash: bigint, borrows: bigint): bigint;
}

/**
 * Union type of all simulator configurations.
 */
export type SimulatorConfig =
  | AaveSimulatorConfig
  | CompoundSimulatorConfig
  | MoonwellSimulatorConfig;

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default Aave V3 simulation configuration.
 * Based on typical Base Aave V3 deployment parameters (DefaultReserveInterestRateStrategy).
 */
export const DEFAULT_AAVE_CONFIG: AaveSimulatorConfig = {
  baseRate: 0n,                           // 0% base rate
  variableRateSlope1: 4n * WAD / 100n,    // 4% slope below optimal
  variableRateSlope2: 60n * WAD / 100n,   // 60% slope above optimal
  optimalUtilization: 8n * RAY / 10n,     // 80% optimal
  maxUtilization: 95n * RAY / 100n,       // 95% max
};

/**
 * Default Compound III simulation configuration.
 * Based on Compound III Comet USDC market parameters.
 */
// PLACEHOLDER pending live on-chain IRM parameters (paper §6.3-6.5 requires
// mirroring the LIVE registered interest-rate strategy — see
// MarketObservation.irmParams, which simulateCurves prefers when present).
//
// Derivation: calculateRateFromUtilization computes
// rate = baseRate + slopeLow*util (util<=kink RAY-fraction), so slopeLow is
// "annualized WAD rate contributed at 100% utilization". A value that is too
// small relative to baseRate makes the curve flat across the whole
// utilization range regardless of deposit size — e.g. 32n*WAD/1e9 (3.2e-8
// WAD = 0.0000032%) made it flat to 7 decimal places, which is not a
// capacity effect, just noise. To rise from the 3% base to ~8% APY at the
// 80% kink: slopeLow = (8%-3%)/0.8 = 6.25%.
// Above kink: rate = 8% (at kink) + slopeHigh*(util-kink)/(1-kink-normalized).
// Target ~28% APY at 100% utilization (a steep post-kink cliff, typical of
// kinked-rate protocols defending against liquidity exhaustion near full
// utilization): slopeHigh = (28%-8%)/(1-0.8) = 20%/0.2 = 100%.
const PLACEHOLDER_SLOPE_LOW = (625n * WAD) / 10_000n; // 6.25% WAD -> 8% APY at 80% kink
const PLACEHOLDER_SLOPE_HIGH = WAD; // 100% WAD -> ~28% APY at 100% utilization

export const DEFAULT_COMPOUND_CONFIG: CompoundSimulatorConfig = {
  baseRate: 3n * WAD / 100n,              // 3% APY
  kink: 8n * RAY / 10n,                    // 80% kink
  slopeLow: PLACEHOLDER_SLOPE_LOW,
  slopeHigh: PLACEHOLDER_SLOPE_HIGH,
};

/**
 * Default Moonwell simulation configuration.
 * Based on Moonwell Apollo deployment parameters.
 */
export const DEFAULT_MOONWELL_CONFIG: MoonwellSimulatorConfig = {
  baseRate: 3n * WAD / 100n,              // 3% APY
  kink: 8n * RAY / 10n,                   // 80% kink
  slopeLow: PLACEHOLDER_SLOPE_LOW,
  slopeHigh: PLACEHOLDER_SLOPE_HIGH,
  minRate: 1n * WAD / 100n,              // 1% floor from oracle
  maxRate: 20n * WAD / 100n,             // 20% ceiling from oracle (caps the
                                          // kinked curve above ~92% util given
                                          // the slopes above — intentional)
};
