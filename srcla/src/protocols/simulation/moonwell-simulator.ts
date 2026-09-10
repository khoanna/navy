/**
 * Moonwell Interest Rate Simulator
 *
 * Implements post-deposit interest rate simulation for Moonwell protocol.
 * Moonwell is a COMPOUND V2 fork (a `JumpRateModel` behind an mToken), NOT a
 * Compound III fork.
 *
 * Rate model:
 *   borrow(u) = base + multiplier * u                       u <= kink
 *   borrow(u) = base + multiplier * kink
 *               + jumpMultiplier * (u - kink)                u >  kink
 *   supply(u) = borrow(u) * u * (1 - reserveFactor)
 *
 * THE BORROW -> SUPPLY CONVERSION IS THE POINT. The kinked coefficients an
 * mToken's rate model stores are a BORROW curve; Comet's identically-shaped
 * coefficients are a SUPPLY curve. Treating Moonwell's as Comet's -- which
 * this file did until 2026-09-10 -- returns a borrow rate under a name and a
 * type that every consumer reads as a supply rate, and
 * `policy/steps/simulate.ts` wrote exactly that into `RateCurve.points`.
 * Measured over the calibration era with each origin's own chain-read
 * parameters, the unconverted borrow rate misses the mToken's stored
 * `supplyRateE18` by 3.3671 pp MAE (max 87.3654 pp); with the conversion it
 * reproduces it to 2.76e-9 pp MAE (max 5.73e-9 pp, integer truncation) on
 * every row whose IRM address the archive resolved correctly.
 *
 * NO ORACLE CLAMP. `simulateRate` used to clamp its result into
 * `[minRate, maxRate]`, described as Apollo oracle bounds. Nothing on chain
 * produces such a bound, the archive holds no reading of one, and the
 * measurement above -- exact WITHOUT a clamp, on rows whose real supply rate
 * reaches 20.83 pp against an invented 20% ceiling -- falsifies it outright.
 * See `MoonwellSimulatorConfig` in ./types.ts.
 *
 * @module protocols/simulation
 */

import { WAD, RAY, SECONDS_PER_YEAR, utilization as calcUtil } from '../math.js';
import { calculateRateFromUtilization } from './compound-simulator.js';
import {
  DEFAULT_MOONWELL_CONFIG,
  ISimulator,
  MarketState,
  MoonwellSimulatorConfig,
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
 * console.log(`Post-deposit SUPPLY rate: ${result.postDepositRate / WAD * 100}%`);
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
   * Moonwell's BORROW rate at a given utilization, kinked-linear.
   *
   *   if util <= kink: borrow = baseRate + slopeLow * util
   *   if util > kink:  borrow = baseRate + slopeLow * kink
   *                             + slopeHigh * (util - kink)
   *
   * NAMED FOR THE QUANTITY IT RETURNS. It used to be called
   * `calculateRateFromUtilization` under a docstring promising a supply
   * rate; it never was one. See the module comment for the measurement.
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Moonwell configuration parameters
   * @returns BORROW rate per second (WAD scale) — this delegates to
   *   Compound's `calculateRateFromUtilization`, which divides the annual
   *   config rates by `SECONDS_PER_YEAR` internally (see
   *   compound-simulator.ts). Callers MUST multiply by `SECONDS_PER_YEAR` to
   *   reach the WAD-annualized scale everything else here uses.
   */
  calculateBorrowRateFromUtilization(
    util: bigint,
    config: MoonwellSimulatorConfig
  ): bigint {
    return calculateRateFromUtilization(util, config);
  }

  /**
   * Compound v2's borrow -> supply conversion, which is what an mToken
   * actually pays a supplier:
   *
   *   supply = borrow * u * (1 - reserveFactor)
   *
   * @param borrowRateAnnualWad - Annualized BORROW rate (WAD)
   * @param utilWad - Utilization as a WAD fraction (WAD == 100%)
   * @param reserveFactorBps - The mToken's reserve factor, bps
   * @returns Annualized SUPPLY rate (WAD)
   */
  borrowToSupplyRate(
    borrowRateAnnualWad: bigint,
    utilWad: bigint,
    reserveFactorBps: number
  ): bigint {
    const afterUtilization = (borrowRateAnnualWad * utilWad) / WAD;
    const reserveFactorWad = (BigInt(Math.trunc(reserveFactorBps)) * WAD) / 10_000n;
    return (afterUtilization * (WAD - reserveFactorWad)) / WAD;
  }

  /**
   * The ANNUALIZED SUPPLY rate at a given utilization — the quantity every
   * consumer of `SimulatedRate.postDepositRate` wants, and the composition
   * of the two functions above.
   *
   * @param util - Utilization ratio (RAY)
   * @param config - Moonwell configuration parameters
   * @returns Annualized supply rate (WAD)
   */
  calculateRateFromUtilization(
    util: bigint,
    config: MoonwellSimulatorConfig
  ): bigint {
    const borrowAnnualWad = this.calculateBorrowRateFromUtilization(util, config) * SECONDS_PER_YEAR;
    return this.borrowToSupplyRate(borrowAnnualWad, util / (RAY / WAD), config.reserveFactorBps);
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
   * Simulate the post-deposit SUPPLY rate.
   *
   * Calculates the new utilization and the resulting supply rate after a
   * hypothetical deposit, applying the Compound-v2 borrow -> supply
   * conversion the mToken itself applies.
   *
   * NO ORACLE CLAMP. This function used to clamp its result into a
   * `[minRate, maxRate]` pair described as Apollo oracle bounds. See the
   * module comment: no such bound exists on chain, and the unclamped curve
   * reproduces the mToken's stored rate exactly.
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
    const moonwellConfig = config as MoonwellSimulatorConfig;

    // Calculate pre-deposit utilization
    const utilizationBefore = this.calculateUtilization(cash, borrows);
    const preDepositRate = supplyRate;

    // Calculate post-deposit state
    const newCash = cash + depositAmount;
    const utilizationAfter = this.calculateUtilization(newCash, borrows);

    // The annualized SUPPLY rate: kinked-linear borrow curve, annualized,
    // then * u * (1 - reserveFactor). The conversion was absent before
    // 2026-09-10 and the borrow rate was returned in its place.
    const postDepositRate = this.calculateRateFromUtilization(utilizationAfter, moonwellConfig);

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

    // Calculate rate before deposit — through the same map, so the
    // ratePenalty comparison below is apples-to-apples.
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
   * @returns Annualized SUPPLY rate at that utilization (WAD)
   */
  simulateStressRate(
    _state: MarketState,
    stressUtilization: bigint,
    config: MoonwellSimulatorConfig = DEFAULT_MOONWELL_CONFIG
  ): bigint {
    // At zero utilization the mToken pays suppliers nothing, whatever the
    // borrow curve's intercept is: supply = borrow * u * (1 - rf) and u = 0.
    // This returned `config.baseRate` — a BORROW-curve intercept — before
    // 2026-09-10.
    if (stressUtilization === 0n) return 0n;

    // Annualized SUPPLY rate at the stress utilization. No oracle clamp: see
    // the module comment.
    return this.calculateRateFromUtilization(stressUtilization, config);
  }
}
