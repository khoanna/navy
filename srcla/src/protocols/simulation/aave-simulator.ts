/**
 * Aave V3 Interest Rate Simulator
 *
 * Implements post-deposit interest rate simulation for Aave V3 protocol.
 * Aave V3 uses a piecewise interest rate model with an optimal usage ratio
 * that minimizes rate volatility for both suppliers and borrowers.
 *
 * TWO RATES, NEVER CONFLATE THEM. Aave's rate strategy computes a BORROW
 * rate; suppliers earn a SUPPLY rate derived from it. Every function below
 * says in its name and its docstring which one it returns, because the
 * ambiguity between them was the root of a live controller defect (see
 * below).
 *
 * BORROW rate (§6.3 - exact mirror of DefaultReserveInterestRateStrategy,
 * which is LINEAR in the excess usage ratio on both sides of optimal):
 *   Below optimal: borrow = baseRate + slope1 * (u / optimalUtilization)
 *   Above optimal: borrow = baseRate + slope1 + slope2 * (u - optimal) / (1 - optimal)
 *
 * SUPPLY rate (what a depositor earns, and what `SimulatedRate` carries):
 *   supply = borrow * u * (1 - reserveFactor)
 *
 * FIX 2026-09-10 (Aave rate-map defect). This module previously (i) SQUARED
 * both usage ratios, asserting a quadratic curve Aave does not have, and
 * (ii) returned the BORROW rate from a function whose docstring promised
 * "Annualized supply rate", which `simulateRate` then assigned verbatim to
 * `postDepositRate` and `policy/steps/simulate.ts` wrote straight into
 * `RateCurve.points`. Both were settled against chain, not argued:
 *
 *   Base mainnet Aave V3 Pool 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5,
 *   USDC reserve, rate strategy 0x86AB1C62A8bf868E1b3E1ab87d587Aba6fbCbDC5,
 *   at block 51,105,787 (optimal 0.9 RAY, base 0, slope1 4.7%, slope2 10%,
 *   reserveFactor 10%; virtual balance 20,359,084,142,184, variable debt
 *   163,435,422,956,531 -> u = 0.8892290936):
 *
 *     linear borrow                4.6437519333%   vs currentVariableBorrowRate 4.6437518613%
 *     squared borrow (the old code) 4.5881770250%   off by 0.0556 pp
 *     linear * u * (1 - rf)        3.7164233903%   vs currentLiquidityRate      3.7164226508%
 *
 *   Pinned as a golden vector in
 *   `test/unit/protocols/aave-simulator.spec.ts`. Measured across the 10,632
 *   Aave calibration-era origins in the srcla archive, using each origin's
 *   own chain-read parameters, the linear+conversion map scores 0.210 pp MAE
 *   against the stored `supplyRateE18` where the old squared, unconverted
 *   form scored 1.716 pp (mean stored rate 6.13 pp).
 *
 * Utilization Formula:
 *   utilization = borrows / (cash + borrows)
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
 * This is an exact mirror of DefaultReserveInterestRateStrategy from Aave V3,
 * plus the protocol's borrow -> supply conversion.
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
   * Calculate Aave V3's **BORROW** rate from utilization.
   *
   * RETURNS A BORROW RATE, NOT A SUPPLY RATE. Nothing that wants "the rate
   * the vault earns" may use this directly — use
   * `calculateRateFromUtilization` (or `simulateRate`), which applies the
   * protocol's borrow -> supply conversion on top.
   *
   * Exact formula per §6.3 (mirrors DefaultReserveInterestRateStrategy).
   * LINEAR in the usage ratio on both sides of optimal — Aave V3 does NOT
   * square either ratio; see the module comment for the chain measurement:
   *   Below optimal: borrow = baseRate + slope1 * (util / optimalUtilization)
   *   Above optimal: borrow = baseRate + slope1 + slope2 * (util - optimal) / (1 - optimal)
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Aave V3 configuration parameters
   * @returns Annualized BORROW rate (WAD)
   */
  calculateBorrowRateFromUtilization(util: bigint, config: AaveSimulatorConfig): bigint {
    const { baseRate, variableRateSlope1, variableRateSlope2, optimalUtilization, maxUtilization } = config;

    // If at or above max utilization, the borrow rate is capped at its
    // value at 100% usage (baseRate + slope1 + slope2).
    if (util >= maxUtilization) {
      return baseRate + variableRateSlope1 + variableRateSlope2;
    }

    if (util <= optimalUtilization) {
      // Below optimal: borrow = baseRate + slope1 * (util / optimalUtilization)
      if (optimalUtilization === 0n) return baseRate;
      return baseRate + (variableRateSlope1 * util) / optimalUtilization;
    }

    // Above optimal: borrow = baseRate + slope1 + slope2 * excessRatio
    const excessUtil = util - optimalUtilization;
    const excessCapacity = RAY - optimalUtilization;

    if (excessCapacity === 0n) {
      // Edge case: optimal is 100%
      return baseRate + variableRateSlope1 + variableRateSlope2;
    }

    const excessRatio = (excessUtil * RAY) / excessCapacity;
    return baseRate + variableRateSlope1 + (variableRateSlope2 * excessRatio) / RAY;
  }

  /**
   * Convert an Aave V3 **BORROW** rate into the **SUPPLY** rate suppliers
   * actually earn at that utilization.
   *
   *   supply = borrow * u * (1 - reserveFactor)
   *
   * Both terms matter and neither is optional: borrow interest is paid only
   * on the borrowed fraction `u` of the pool but shared across the whole
   * pool, and the protocol keeps `reserveFactor` of it. Omitting them (the
   * pre-2026-09-10 behaviour) overstates the rate by `1 / (u * (1 - rf))` —
   * at Base USDC's live state that is a factor of 1.25 even before the
   * curve-shape error.
   *
   * @param borrowRate - Annualized BORROW rate (WAD)
   * @param util - Utilization ratio (RAY)
   * @param reserveFactorBps - Protocol reserve cut, bps
   * @returns Annualized SUPPLY rate (WAD)
   */
  borrowToSupplyRate(borrowRate: bigint, util: bigint, reserveFactorBps: number): bigint {
    const afterUtil = (borrowRate * util) / RAY;
    return (afterUtil * BigInt(10_000 - reserveFactorBps)) / 10_000n;
  }

  /**
   * Calculate Aave V3's **SUPPLY** rate from utilization.
   *
   * This is the quantity `SimulatedRate.preDepositRate`/`postDepositRate`
   * are documented to carry, the quantity `MarketSnapshot.supplyRateE18`
   * stores, and the quantity `policy/steps/simulate.ts` writes into
   * `RateCurve.points`. It is the borrow curve
   * (`calculateBorrowRateFromUtilization`) run through
   * `borrowToSupplyRate`.
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Aave V3 configuration parameters
   * @returns Annualized SUPPLY rate (WAD)
   */
  calculateRateFromUtilization(util: bigint, config: AaveSimulatorConfig): bigint {
    const borrowRate = this.calculateBorrowRateFromUtilization(util, config);
    return this.borrowToSupplyRate(borrowRate, util, config.reserveFactorBps);
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
   * Calculates the new utilization and resulting SUPPLY rate after
   * a hypothetical deposit of `depositAmount` USDC. `postDepositRate` is a
   * supply rate (borrow curve * u * (1 - reserveFactor)), never a borrow
   * rate.
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
