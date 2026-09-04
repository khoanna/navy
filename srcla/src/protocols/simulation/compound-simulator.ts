/**
 * Compound III Interest Rate Simulator
 *
 * Implements post-deposit interest rate simulation for Compound III protocol.
 * Compound III uses a kinked linear interest rate model per Comet governance.
 *
 * Rate Model (per docs.compound.finance/interest-rates/):
 *   if util <= kink: rate = baseRate + slopeLow * util
 *   if util > kink:  rate = baseRate + slopeLow * kink + slopeHigh * (util - kink)
 *
 * Where:
 *   - baseRate: Minimum rate at 0% utilization (e.g., 3%)
 *   - kink: Utilization point where slope changes (e.g., 80%)
 *   - slopeLow: Rate slope below kink
 *   - slopeHigh: Rate slope above kink
 *
 * @module protocols/simulation
 */

import { WAD, RAY, SECONDS_PER_YEAR, utilization as calcUtil } from '../math.js';
import {
  CompoundSimulatorConfig,
  DEFAULT_COMPOUND_CONFIG,
  ISimulator,
  MarketState,
  SimulatedRate,
  SimulatorConfig,
} from './types.js';

/**
 * Compound III Interest Rate Simulator
 *
 * Simulates how the supply interest rate changes when new capital is deposited
 * into a Compound III market. The simulator uses Compound's exponential rate
 * model to calculate post-deposit rates.
 *
 * @example
 * ```typescript
 * const simulator = new CompoundV3Simulator();
 * const result = simulator.simulateRate(
 *   { marketId: 'compound-usdc', name: 'Compound USDC', cash: 50_000_000_000_000n, borrows: 30_000_000_000_000n, supplyRate: 50000000000000000n },
 *   10_000_000_000_000n,  // Deposit 10M USDC
 *   DEFAULT_COMPOUND_CONFIG
 * );
 * console.log(`Post-deposit rate: ${result.postDepositRate / WAD * 100}%`);
 * ```
 */
export class CompoundV3Simulator implements ISimulator {
  /**
   * Calculate the current utilization ratio.
   *
   * @param cash - Current cash in the market (USDC base units)
   * @param borrows - Current total borrows (USDC base units)
   * @returns Utilization ratio in RAY (e.g., 8e17 = 80%)
   */
  calculateUtilization(cash: bigint, borrows: bigint): bigint {
    if (cash + borrows === 0n) return 0n;
    return calcUtil(cash, borrows);
  }

  /**
   * Calculate Compound III supply rate from utilization.
   *
   * Uses Compound's kinked linear rate model:
   *   if util <= kink: rate = baseRate + slopeLow * util
   *   if util > kink:  rate = baseRate + slopeLow * kink + slopeHigh * (util - kink)
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Compound III configuration parameters
   * @returns Supply rate per second (WAD)
   */
  calculateRateFromUtilization(
    util: bigint,
    config: CompoundSimulatorConfig
  ): bigint {
    return calculateRateFromUtilization(util, config);
  }

  /**
   * Calculate effective capacity based on max utilization.
   *
   * Compound III can technically reach 100% utilization, but we use a
   * conservative limit to ensure withdrawals are always possible.
   *
   * @param cash - Current cash in the market
   * @param borrows - Current total borrows
   * @param maxUtilization - Maximum utilization threshold (RAY)
   * @returns Maximum deposit amount (USDC base units)
   */
  calculateEffectiveCapacity(
    cash: bigint,
    borrows: bigint,
    maxUtilization: bigint = RAY
  ): bigint {
    return calculateEffectiveCapacity(cash, borrows, maxUtilization);
  }

  /**
   * Simulate post-deposit interest rate.
   *
   * Calculates the new utilization and resulting supply rate after
   * a hypothetical deposit of `depositAmount` USDC.
   *
   * @param state - Current market state
   * @param depositAmount - Amount to deposit (USDC base units)
   * @param config - Compound III configuration parameters
   * @returns Simulated rate result with pre/post comparison
   */
  simulateRate(
    state: MarketState,
    depositAmount: bigint,
    config: SimulatorConfig
  ): SimulatedRate {
    const { marketId, cash, borrows, supplyRate } = state;
    const compoundConfig = config as CompoundSimulatorConfig;

    // Calculate pre-deposit utilization and rate
    const utilizationBefore = this.calculateUtilization(cash, borrows);
    const preDepositRate = supplyRate;

    // Calculate post-deposit state
    const newCash = cash + depositAmount;
    const utilizationAfter = this.calculateUtilization(newCash, borrows);

    // Calculate post-deposit rate using the exponential model
    const postDepositRate = this.calculateRateFromUtilization(utilizationAfter, compoundConfig);

    // Calculate effective capacity (conservative 99% max utilization)
    const effectiveCapacity = this.calculateEffectiveCapacity(
      cash,
      borrows,
      (99n * RAY) / 100n
    );

    // Calculate rate before deposit
    const rateBefore = this.calculateRateFromUtilization(utilizationBefore, compoundConfig);

    // For Compound, "optimal" is effectively the high-utilization threshold
    // We use 80% as a reasonable optimal point for rate penalty calculation
    const optimalUtilization = (80n * RAY) / 100n;

    // Calculate capacity remaining after deposit (floor at 0)
    const capacityRemaining = effectiveCapacity > depositAmount
      ? effectiveCapacity - depositAmount
      : 0n;

    // Calculate rate penalty: applied when utilization exceeds optimal utilization
    // ratePenalty = rateBefore - rateAfter if above optimal, else 0
    const ratePenalty = utilizationAfter > optimalUtilization && rateBefore > postDepositRate
      ? rateBefore - postDepositRate
      : 0n;

    return {
      marketId,
      preDepositRate,
      postDepositRate,
      utilizationBefore,
      utilizationAfter,
      effectiveCapacity,
      capacityRemaining,
      ratePenalty,
    };
  }

  /**
   * Calculate the marginal rate impact of a deposit.
   *
   * @param state - Current market state
   * @param depositAmount - Amount to deposit
   * @param config - Compound III configuration
   * @returns Rate impact as a percentage (WAD)
   */
  calculateRateImpact(
    state: MarketState,
    depositAmount: bigint,
    config: SimulatorConfig = DEFAULT_COMPOUND_CONFIG
  ): bigint {
    if (state.supplyRate === 0n) return 0n;

    const result = this.simulateRate(state, depositAmount, config);
    const impact = state.supplyRate - result.postDepositRate;

    // Return as percentage of original rate
    return (impact * WAD) / state.supplyRate;
  }

  /**
   * Calculate the present value of cToken holdings.
   *
   * Compound III uses cToken-style accounting where:
   *   presentValue = cTokenBalance * (currentIndex / supplyIndex)
   *
   * @param cTokenBalance - Number of cTokens held
   * @param supplyIndex - Current supply index
   * @param initialIndex - Initial supply index when cTokens were acquired
   * @returns Present value in underlying asset (USDC base units)
   */
  presentValue(
    cTokenBalance: bigint,
    supplyIndex: bigint,
    initialIndex: bigint
  ): bigint {
    if (initialIndex === 0n) return 0n;
    return (cTokenBalance * supplyIndex) / initialIndex;
  }
}

// ============================================================================
// Standalone Rate Calculation Functions
// ============================================================================

/**
 * Calculate supply rate from utilization using kinked linear model.
 * Per Compound III Comet governance: docs.compound.finance/interest-rates/
 *
 * Formula (per second, scaled WAD):
 *   if util <= kink: rate = baseRate + slopeLow * util
 *   if util > kink:  rate = baseRate + slopeLow * kink + slopeHigh * (util - kink)
 *
 * All inputs in RAY scale (1e27). All outputs in WAD per second.
 *
 * @param util - Utilization ratio (RAY, e.g., 8e17 = 80%)
 * @param config - Compound simulator configuration with baseRate, kink, slopeLow, slopeHigh
 * @returns Supply rate per second (WAD scale)
 */
export function calculateRateFromUtilization(
  util: bigint,
  config: CompoundSimulatorConfig
): bigint {
  const { baseRate, kink, slopeLow, slopeHigh } = config;

  // Convert annual rates to per-second
  const basePerSec = baseRate / SECONDS_PER_YEAR;
  const slopeLowPerSec = slopeLow / SECONDS_PER_YEAR;
  const slopeHighPerSec = slopeHigh / SECONDS_PER_YEAR;

  if (util <= kink) {
    // rate = base + slopeLow * util
    return basePerSec + (slopeLowPerSec * util) / RAY;
  } else {
    // rate = base + slopeLow * kink + slopeHigh * (util - kink)
    const low = (slopeLowPerSec * kink) / RAY;
    const high = (slopeHighPerSec * (util - kink)) / RAY;
    return basePerSec + low + high;
  }
}

/**
 * Calculate effective capacity given current cash and borrows.
 * Returns the maximum additional deposit before hitting maxUtilization.
 *
 * @param cash - Current cash in the market (USDC base units)
 * @param borrows - Current total borrows (USDC base units)
 * @param maxUtilization - Maximum utilization threshold (RAY), defaults to full RAY (100%)
 * @returns Maximum additional deposit amount (USDC base units), 0 if at max utilization
 */
export function calculateEffectiveCapacity(
  cash: bigint,
  borrows: bigint,
  maxUtilization: bigint = RAY
): bigint {
  if (maxUtilization === 0n) return 0n;
  if (borrows === 0n) return 0n;
  // maxCash = borrows * RAY / maxUtilization - cash
  const maxCash = (borrows * RAY) / maxUtilization;
  return maxCash > cash ? maxCash - cash : 0n;
}
