/**
 * Aave V3 Interest Rate Simulator
 *
 * Implements post-deposit interest rate simulation for Aave V3 protocol.
 * Aave V3 uses a piecewise interest rate model with an optimal utilization
 * point that minimizes rate volatility for both suppliers and borrowers.
 *
 * Rate Model (per §6.3):
 *   - Below optimal: rate = variableRateSlope * (u/optimalUtilization)^2
 *   - Above optimal: rate = optimalRate + variableRateSlope * (1 + (u - optimal)/(1 - optimal))^2
 *
 * Utilization Formula:
 *   utilization = borrows / (cash + borrows - depositAmount)
 *
 * @module protocols/simulation
 */

import { WAD, RAY, utilization as calcUtil } from '../math.js';
import {
  AaveSimulatorConfig,
  DEFAULT_AAVE_CONFIG,
  ISimulator,
  MarketState,
  SimulatedRate,
  SimulatorConfig,
} from './types.js';

/**
 * Aave V3 Interest Rate Simulator
 *
 * Simulates how the supply interest rate changes when new capital is deposited
 * into an Aave V3 market. The simulator uses the protocol's mathematical model
 * to calculate post-deposit rates based on the new utilization ratio.
 *
 * @example
 * ```typescript
 * const simulator = new AaveV3Simulator();
 * const result = simulator.simulateRate(
 *   { marketId: 'aave-usdc', name: 'Aave USDC', cash: 50_000_000_000_000n, borrows: 30_000_000_000_000n, supplyRate: 50000000000000000n },
 *   10_000_000_000_000n,  // Deposit 10M USDC
 *   DEFAULT_AAVE_CONFIG
 * );
 * console.log(`Post-deposit rate: ${result.postDepositRate / WAD * 100}%`);
 * ```
 */
export class AaveV3Simulator implements ISimulator {
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
   * Calculate Aave V3 supply rate from utilization.
   *
   * Uses Aave's piecewise rate model:
   *   - Below optimal: rate = optimalRate * (utilization/optimalUtilization)^2
   *   - Above optimal: rate = optimalRate + variableRateSlope * excessRatio^2
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Aave V3 configuration parameters
   * @returns Annualized supply rate (WAD)
   */
  calculateRateFromUtilization(util: bigint, config: AaveSimulatorConfig): bigint {
    const { optimalRate, variableRateSlope, optimalUtilization, maxUtilization } = config;

    // If at or above max utilization, rate is undefined/capped
    if (util >= maxUtilization) {
      // Return a high rate as a safety measure
      return optimalRate + variableRateSlope;
    }

    // Piecewise rate calculation
    if (util <= optimalUtilization) {
      // Below optimal: quadratic increase from 0 to optimalRate
      // rate = optimalRate * (util / optimalUtilization)^2
      if (optimalUtilization === 0n) return 0n;
      const utilSquared = (util * util) / optimalUtilization;
      return (optimalRate * utilSquared) / optimalUtilization;
    } else {
      // Above optimal: linear increase with variableRateSlope
      // rate = optimalRate + variableRateSlope * ((util - optimal) / (1 - optimal))^2
      const excessUtil = util - optimalUtilization;
      const excessCapacity = RAY - optimalUtilization;

      if (excessCapacity === 0n) {
        // Edge case: optimal is 100%
        return optimalRate + variableRateSlope;
      }

      // Calculate excess ratio squared
      const excessRatio = (excessUtil * RAY) / excessCapacity;
      const excessRatioSquared = (excessRatio * excessRatio) / RAY;

      return optimalRate + (variableRateSlope * excessRatioSquared) / RAY;
    }
  }

  /**
   * Calculate effective capacity based on max utilization.
   *
   * The effective capacity is the maximum amount that can be deposited
   * without exceeding the maxUtilization threshold.
   *
   * @param cash - Current cash in the market
   * @param borrows - Current total borrows
   * @param maxUtilization - Maximum utilization threshold (RAY)
   * @returns Maximum deposit amount (USDC base units)
   */
  calculateEffectiveCapacity(
    cash: bigint,
    borrows: bigint,
    maxUtilization: bigint
  ): bigint {
    if (maxUtilization === 0n) return 0n;

    // maxUtilization = borrows / (cash - deposit + borrows)
    // Solving for deposit:
    // deposit = cash - borrows * (1 - maxUtilization) / maxUtilization
    const denominator = (maxUtilization * (RAY - maxUtilization));
    if (denominator === 0n) return cash; // Edge case

    const maxCashAtUtil = (borrows * (RAY - maxUtilization)) / maxUtilization;
    const capacity = cash - maxCashAtUtil;

    return capacity > 0n ? capacity : 0n;
  }

  /**
   * Simulate post-deposit interest rate.
   *
   * Calculates the new utilization and resulting supply rate after
   * a hypothetical deposit of `depositAmount` USDC.
   *
   * @param state - Current market state
   * @param depositAmount - Amount to deposit (USDC base units)
   * @param config - Aave V3 configuration parameters
   * @returns Simulated rate result with pre/post comparison
   */
  simulateRate(
    state: MarketState,
    depositAmount: bigint,
    config: SimulatorConfig
  ): SimulatedRate {
    const { marketId, cash, borrows, supplyRate } = state;
    const aaveConfig = config as AaveSimulatorConfig;

    // Calculate pre-deposit utilization and rate
    const utilizationBefore = this.calculateUtilization(cash, borrows);
    const preDepositRate = supplyRate;

    // Calculate post-deposit state
    // New cash = cash + depositAmount
    const newCash = cash + depositAmount;
    const utilizationAfter = this.calculateUtilization(newCash, borrows);

    // Calculate post-deposit rate using the rate model
    const postDepositRate = this.calculateRateFromUtilization(utilizationAfter, aaveConfig);

    // Calculate effective capacity
    const effectiveCapacity = this.calculateEffectiveCapacity(
      cash,
      borrows,
      aaveConfig.maxUtilization
    );

    // Calculate rate before deposit
    const rateBefore = this.calculateRateFromUtilization(utilizationBefore, aaveConfig);

    // Calculate capacity remaining after deposit (floor at 0)
    const capacityRemaining = effectiveCapacity > depositAmount
      ? effectiveCapacity - depositAmount
      : 0n;

    // Calculate rate penalty: applied when utilization exceeds optimal utilization
    // ratePenalty = rateBefore - rateAfter if above optimal, else 0
    const ratePenalty = utilizationAfter > aaveConfig.optimalUtilization && rateBefore > postDepositRate
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
   * @param config - Aave V3 configuration
   * @returns Rate impact as a percentage (WAD)
   */
  calculateRateImpact(
    state: MarketState,
    depositAmount: bigint,
    config: SimulatorConfig = DEFAULT_AAVE_CONFIG
  ): bigint {
    if (state.supplyRate === 0n) return 0n;

    const result = this.simulateRate(state, depositAmount, config);
    const impact = state.supplyRate - result.postDepositRate;

    // Return as percentage of original rate
    return (impact * WAD) / state.supplyRate;
  }
}
