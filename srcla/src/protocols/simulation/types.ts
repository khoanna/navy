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
 * Compound III uses an exponential interest rate model based on utilization.
 * The rate smoothly transitions from baseRate to peakRate as utilization
 * approaches 100%.
 *
 * Rate formula:
 *   rate = baseRate + (peakRate - baseRate) * exp(-k * (1 - utilization))
 *
 * Where:
 *   - baseRate: Minimum rate at 0% utilization
 *   - peakRate: Maximum rate at 100% utilization
 *   - k: Curve steepness parameter (higher = steeper transition)
 *
 * @example
 * ```typescript
 * const config: CompoundSimulatorConfig = {
 *   baseRate: 3n * WAD / 100n,   // 3% APY minimum
 *   peakRate: 15n * WAD / 100n,  // 15% APY at 100% utilization
 *   k: 5,                         // Curve steepness
 * };
 * ```
 */
export interface CompoundSimulatorConfig {
  /** Minimum supply rate at 0% utilization (WAD, e.g., 3e16 = 3%) */
  baseRate: bigint;
  /** Maximum supply rate at 100% utilization (WAD, e.g., 15e16 = 15%) */
  peakRate: bigint;
  /** Curve steepness parameter (higher = steeper transition) */
  k: number;
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
 *   baseRate: 3n * WAD / 100n,   // 3% APY minimum
 *   peakRate: 15n * WAD / 100n,  // 15% APY maximum
 *   k: 5,                         // Curve steepness
 *   minRate: 1n * WAD / 100n,    // 1% APY floor from oracle
 *   maxRate: 20n * WAD / 100n,   // 20% APY ceiling from oracle
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

  /**
   * Verify simulation against on-chain data.
   *
   * Optional method for validating simulator accuracy against
   * real protocol state. Returns true if simulation is accurate.
   */
  verifyFixtures?(): Promise<boolean>;
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
 * Based on Compound III mainnet/USDC market parameters.
 */
export const DEFAULT_COMPOUND_CONFIG: CompoundSimulatorConfig = {
  baseRate: 3n * WAD / 100n,   // 3% minimum
  peakRate: 15n * WAD / 100n,  // 15% at 100% utilization
  k: 5,                         // Curve steepness
};

/**
 * Default Moonwell simulation configuration.
 * Based on Moonwell Apollo deployment parameters.
 */
export const DEFAULT_MOONWELL_CONFIG: MoonwellSimulatorConfig = {
  baseRate: 3n * WAD / 100n,   // 3% minimum
  peakRate: 15n * WAD / 100n,  // 15% maximum
  k: 5,                         // Curve steepness
  minRate: 1n * WAD / 100n,    // 1% floor from oracle
  maxRate: 20n * WAD / 100n,   // 20% ceiling from oracle
};
