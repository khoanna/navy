/**
 * Moonwell Interest Rate Simulator
 *
 * Implements post-deposit interest rate simulation for Moonwell protocol.
 * Moonwell is a Compound III fork with Apollo oracle bounds on interest rates.
 *
 * Rate Model (per docs.compound.finance/interest-rates/):
 *   baseRate = kinked linear rate from Compound model
 *   rate = clamp(baseRate, minRate, maxRate)
 *
 * Where minRate and maxRate are provided by the Apollo oracle.
 *
 * Key differences from Compound III:
 *   - Rate is bounded by [minRate, maxRate] from Apollo oracle
 *   - More conservative rate adjustments due to oracle bounds
 *   - Same kinked linear model as Compound
 *
 * @module protocols/simulation
 */

import { WAD, RAY, utilization as calcUtil } from '../math.js';
import { calculateRateFromUtilization } from './compound-simulator.js';
import {
  CompoundSimulatorConfig,
  DEFAULT_MOONWELL_CONFIG,
  ISimulator,
  MarketState,
  SimulatedRate,
  SimulatorConfig,
} from './types.js';

/**
 * Moonwell Interest Rate Simulator
 *
 * Simulates how the supply interest rate changes when new capital is deposited
 * into a Moonwell market. The simulator uses the kinked linear rate model
 * with Apollo oracle bounds to calculate post-deposit rates.
 *
 * @example
 * ```typescript
 * const simulator = new MoonwellSimulator();
 * const result = simulator.simulateRate(
 *   { marketId: 'moonwell-usdc', name: 'Moonwell USDC', cash: 50_000_000_000_000n, borrows: 30_000_000_000_000n, supplyRate: 50000000000000000n },
 *   10_000_000_000_000n,  // Deposit 10M USDC
 *   DEFAULT_MOONWELL_CONFIG
 * );
 * console.log(`Post-deposit rate: ${result.postDepositRate / WAD * 100}%`);
 * ```
 */
export class MoonwellSimulator implements ISimulator {
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
   * Calculate Moonwell supply rate from utilization (unbounded).
   *
   * Uses Compound's kinked linear rate model:
   *   if util <= kink: rate = baseRate + slopeLow * util
   *   if util > kink:  rate = baseRate + slopeLow * kink + slopeHigh * (util - kink)
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Moonwell configuration parameters
   * @returns Annualized supply rate (WAD)
   */
  calculateRateFromUtilization(
    util: bigint,
    config: CompoundSimulatorConfig
  ): bigint {
    return calculateRateFromUtilization(util, config);
  }

  /**
   * Clamp a rate value to the [minRate, maxRate] bounds.
   *
   * @param rate - The rate to clamp (WAD)
   * @param minRate - Minimum allowed rate (WAD)
   * @param maxRate - Maximum allowed rate (WAD)
   * @returns Rate clamped to bounds (WAD)
   */
  clampRate(rate: bigint, minRate: bigint, maxRate: bigint): bigint {
    if (rate < minRate) return minRate;
    if (rate > maxRate) return maxRate;
    return rate;
  }

  /**
   * Calculate effective capacity based on max utilization.
   *
   * Moonwell has slightly lower effective capacity than Compound III
   * due to Apollo oracle constraints and more conservative bounds.
   *
   * @param cash - Current cash in the market
   * @param borrows - Current total borrows
   * @param maxUtilization - Maximum utilization threshold (RAY)
   * @returns Maximum deposit amount (USDC base units)
   */
  calculateEffectiveCapacity(
    cash: bigint,
    borrows: bigint,
    maxUtilization: bigint = (95n * RAY) / 100n // 95% for Moonwell (more conservative)
  ): bigint {
    if (maxUtilization === 0n) return 0n;
    if (borrows === 0n) return 0n;

    // At maxUtilization: borrows / (cash + deposit + borrows) = maxUtilization
    const maxCash = (borrows * RAY) / maxUtilization;
    const capacity = maxCash > cash ? maxCash - cash : 0n;

    return capacity > 0n ? capacity : 0n;
  }

  /**
   * Simulate post-deposit interest rate with Apollo oracle bounds.
   *
   * Calculates the new utilization and resulting supply rate after
   * a hypothetical deposit, then applies Apollo oracle rate bounds.
   *
   * @param state - Current market state
   * @param depositAmount - Amount to deposit (USDC base units)
   * @param config - Moonwell configuration parameters
   * @returns Simulated rate result with pre/post comparison
   */
  simulateRate(
    state: MarketState,
    depositAmount: bigint,
    config: SimulatorConfig
  ): SimulatedRate {
    const { marketId, cash, borrows, supplyRate } = state;
    const moonwellConfig = config as CompoundSimulatorConfig;

    // Calculate pre-deposit utilization
    const utilizationBefore = this.calculateUtilization(cash, borrows);
    const preDepositRate = supplyRate;

    // Calculate post-deposit state
    const newCash = cash + depositAmount;
    const utilizationAfter = this.calculateUtilization(newCash, borrows);

    // Calculate unbounded post-deposit rate using kinked linear model
    const unboundedRate = this.calculateRateFromUtilization(utilizationAfter, moonwellConfig);

    // Apply Apollo oracle bounds for Moonwell
    const minRate = (moonwellConfig as { minRate?: bigint }).minRate ?? (1n * WAD) / 100n;
    const maxRate = (moonwellConfig as { maxRate?: bigint }).maxRate ?? (20n * WAD) / 100n;
    const postDepositRate = this.clampRate(unboundedRate, minRate, maxRate);

    // Calculate effective capacity
    const effectiveCapacity = this.calculateEffectiveCapacity(
      cash,
      borrows,
      (95n * RAY) / 100n // 95% max utilization for Moonwell
    );

    // For Moonwell, optimal utilization is the same as max (95%)
    // Rate penalty is calculated based on the rate reduction when going above
    // the base utilization threshold (use 80% as reasonable optimal for penalty)
    const optimalUtilization = (80n * RAY) / 100n;

    // Calculate rate before deposit
    const rateBefore = this.calculateRateFromUtilization(utilizationBefore, moonwellConfig);

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
   * @param config - Moonwell configuration
   * @returns Rate impact as a percentage (WAD)
   */
  calculateRateImpact(
    state: MarketState,
    depositAmount: bigint,
    config: SimulatorConfig = DEFAULT_MOONWELL_CONFIG
  ): bigint {
    if (state.supplyRate === 0n) return 0n;

    const result = this.simulateRate(state, depositAmount, config);
    const impact = state.supplyRate - result.postDepositRate;

    return (impact * WAD) / state.supplyRate;
  }

  /**
   * Calculate the exchange rate for Moonwell mTokens.
   *
   * Moonwell uses a similar exchange rate model to Compound:
   *   exchangeRate = (cash + borrows - reserves) / totalSupply
   *
   * @param totalSupply - Total mToken supply
   * @param totalBorrows - Total borrows outstanding
   * @param cash - Current cash in market
   * @param reserves - Current reserves
   * @returns Exchange rate (WAD)
   */
  exchangeRate(
    totalSupply: bigint,
    totalBorrows: bigint,
    cash: bigint,
    reserves: bigint
  ): bigint {
    if (totalSupply === 0n) return WAD; // Initial rate is 1:1

    const cashPlusBorrowsMinusReserves = cash + totalBorrows - reserves;
    return (cashPlusBorrowsMinusReserves * WAD) / totalSupply;
  }

  /**
   * Simulate rate under stress conditions.
   *
   * Calculates what the rate would be if utilization increased
   * to a stress level (e.g., due to large withdrawals).
   *
   * @param _state - Current market state (unused, reserved for future use)
   * @param stressUtilization - Target utilization under stress (RAY)
   * @param config - Moonwell configuration
   * @returns Stress rate (WAD)
   */
  simulateStressRate(
    _state: MarketState,
    stressUtilization: bigint,
    config: CompoundSimulatorConfig = DEFAULT_MOONWELL_CONFIG
  ): bigint {
    if (stressUtilization === 0n) return config.baseRate;

    // Calculate rate at stress utilization using kinked linear model
    const unboundedRate = this.calculateRateFromUtilization(stressUtilization, config);

    // Apply bounds
    const minRate = (config as { minRate?: bigint }).minRate ?? (1n * WAD) / 100n;
    const maxRate = (config as { maxRate?: bigint }).maxRate ?? (20n * WAD) / 100n;

    return this.clampRate(unboundedRate, minRate, maxRate);
  }
}
