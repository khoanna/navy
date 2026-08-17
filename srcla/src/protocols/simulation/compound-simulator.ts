/**
 * Compound III Interest Rate Simulator
 *
 * Implements post-deposit interest rate simulation for Compound III protocol.
 * Compound III uses an exponential interest rate model that smoothly
 * transitions from a base rate to a peak rate based on utilization.
 *
 * Rate Model (per §6.4):
 *   rate = baseRate + (peakRate - baseRate) * exp(-k * (1 - utilization))
 *
 * Where:
 *   - baseRate: Minimum rate at 0% utilization (e.g., 3%)
 *   - peakRate: Maximum rate at 100% utilization (e.g., 15%)
 *   - k: Curve steepness parameter (typically 5)
 *   - exp(): Natural exponential function
 *
 * The exponential model provides a smoother rate transition compared to
 * Aave's piecewise model, making it more predictable but potentially
 * less optimal at extreme utilizations.
 *
 * @module protocols/simulation
 */

import { WAD, RAY, utilization as calcUtil } from '../math.js';
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
   * Uses Compound's exponential rate model:
   *   rate = baseRate + (peakRate - baseRate) * exp(-k * (1 - utilization))
   *
   * The rate smoothly increases as utilization approaches 100%, providing
   * a more predictable rate curve than piecewise models.
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Compound III configuration parameters
   * @returns Annualized supply rate (WAD)
   */
  calculateRateFromUtilization(
    util: bigint,
    config: CompoundSimulatorConfig
  ): bigint {
    const { baseRate, peakRate, k } = config;

    if (util === 0n) {
      // At 0% utilization, rate = baseRate
      return baseRate;
    }

    if (util >= RAY) {
      // At 100% utilization, rate = peakRate
      return peakRate;
    }

    // Calculate exp(-k * (1 - utilization))
    // (1 - utilization) in RAY = RAY - util
    const oneMinusUtil = RAY - util;

    // For exp(-k * (1 - util)), we use exp() with negative rate
    // exp(-k * (1 - util)) = exp(-k * oneMinusUtil / RAY)
    // But exp() expects rate in WAD and time in seconds
    // We need: exp(-k * (1 - util) / RAY) where -k * (1 - util) / RAY is "rate"
    //
    // Alternative: use the exp function with a synthetic "time" of 1 year
    // But that would compound incorrectly. Instead, use Taylor series directly.

    // For small x, exp(-x) ≈ 1 - x + x^2/2 - x^3/6 + ...
    // where x = k * (1 - util) / RAY
    //
    // We compute: expFactor = exp(-k * (1 - util) / RAY) using Taylor series
    // Then: rate = baseRate + (peakRate - baseRate) * expFactor / RAY

    const rateParam = (BigInt(k) * oneMinusUtil) / RAY;
    const expFactor = this.expNegative(rateParam);

    // rate = baseRate + (peakRate - baseRate) * expFactor / RAY
    const rateRange = peakRate - baseRate;
    const rateContribution = (rateRange * expFactor) / RAY;

    return baseRate + rateContribution;
  }

  /**
   * Calculate exp(-x) for bigint x in RAY scale.
   *
   * Uses Taylor series: exp(-x) = 1 - x + x^2/2! - x^3/3! + ...
   * where x is in RAY scale.
   *
   * @param x - Value to compute exp(-x) for (in RAY scale)
   * @returns exp(-x) in RAY scale
   */
  private expNegative(x: bigint): bigint {
    // For negative "rate", we compute e^(-x)
    // We iterate until terms become negligible

    // Taylor series: sum from n=0 to infinity of (-x)^n / n!
    let result = RAY; // n=0 term: RAY * 1
    let term = RAY;   // Will be RAY * (-x) / 1 for n=1

    // Convert x to WAD scale for the first division
    const xWad = (x * WAD) / RAY;

    for (let n = 1; n < 20; n++) {
      // term_n = -term_(n-1) * x / n
      // term is in RAY scale
      term = (term * xWad) / (WAD * BigInt(n));
      // Alternate sign
      if (n % 2 === 1) {
        result = result - term;
      } else {
        result = result + term;
      }
    }

    // Ensure result is positive (exp is always positive)
    if (result < 0n) result = 0n;
    return result;
  }

  /**
   * Calculate effective capacity based on max utilization (100% for Compound).
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
    maxUtilization: bigint = RAY - 1n // Leave 1 RAY for rounding
  ): bigint {
    if (maxUtilization === 0n) return 0n;

    // At maxUtilization: borrows / (cash + deposit + borrows) = maxUtilization
    // Solving for deposit:
    // deposit = borrows * (1 - maxUtilization) / maxUtilization - cash

    const numerator = borrows * (RAY - maxUtilization);
    const maxCash = (numerator / maxUtilization);

    // We can add up to: maxCash - currentCash (before reaching maxUtilization)
    const capacity = maxCash > cash ? maxCash - cash : 0n;

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

    return {
      marketId,
      preDepositRate,
      postDepositRate,
      utilizationBefore,
      utilizationAfter,
      effectiveCapacity,
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
