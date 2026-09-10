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
 * Aave V3's `DefaultReserveInterestRateStrategy` is a piecewise-LINEAR
 * BORROW curve in the (excess) usage ratio, with an optimal usage point
 * where the slope changes. It is NOT quadratic — see
 * `aave-simulator.ts#calculateBorrowRateFromUtilization` for the chain
 * measurement that settled this.
 *
 * BORROW rate (§6.3, mirrors DefaultReserveInterestRateStrategy):
 *   - If u <= optimalUtilization: borrow = baseRate + slope1 * (u / optimal)
 *   - If u >  optimalUtilization: borrow = baseRate + slope1
 *                                        + slope2 * (u - optimal) / (1 - optimal)
 *
 * SUPPLY rate (what the vault actually earns, and the only rate any consumer
 * of `SimulatedRate.postDepositRate` wants):
 *   supply = borrow * u * (1 - reserveFactor)
 *
 * @example
 * ```typescript
 * // Live Base mainnet USDC parameters (Aave V3 Pool
 * // 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5, rate strategy
 * // 0x86AB1C62A8bf868E1b3E1ab87d587Aba6fbCbDC5), read at block 51,105,787:
 * const config: AaveSimulatorConfig = {
 *   baseRate: 0n,                            // 0% base rate
 *   variableRateSlope1: 47n * WAD / 1000n,   // 4.7% slope below optimal
 *   variableRateSlope2: 10n * WAD / 100n,    // 10% slope above optimal
 *   optimalUtilization: 9n * RAY / 10n,      // 90% optimal usage ratio
 *   maxUtilization: RAY,                     // 100%
 *   reserveFactorBps: 1000,                  // 10% of borrow interest to the treasury
 * };
 * ```
 */
export interface AaveSimulatorConfig {
  /** Base BORROW rate at 0% utilization (WAD, e.g., 0 = 0%) */
  baseRate: bigint;
  /** First BORROW slope, below optimal utilization (WAD) */
  variableRateSlope1: bigint;
  /** Second BORROW slope, above optimal utilization (WAD) */
  variableRateSlope2: bigint;
  /** Optimal usage ratio (RAY, e.g., 9e26 = 90%) */
  optimalUtilization: bigint;
  /** Maximum safe utilization (RAY, e.g., 1e27 = 100%) */
  maxUtilization: bigint;
  /**
   * Reserve factor, bps — the share of BORROW interest the protocol keeps
   * instead of paying to suppliers. REQUIRED, not optional: it is a
   * multiplicative term in the borrow -> supply conversion, and an absent
   * value silently reading as 0 would overstate the supply rate by exactly
   * this factor. Base USDC is 1000 (10%).
   */
  reserveFactorBps: number;
}

/**
 * Configuration for Compound III interest rate simulation.
 *
 * Comet's kinked-linear curve IS THE SUPPLY CURVE, already net of reserves —
 * `supplyPerSecondInterestRateBase/SlopeLow/SlopeHigh` and `supplyKink()` are
 * distinct on-chain getters from the borrow-side ones, and
 * `Comet.getSupplyRate(utilization)` applies no reserve-factor term at all.
 * That is why this config has no `reserveFactorBps` and why the archive
 * stores `reserveFactorBps = NULL` for Compound BY DESIGN
 * (`evaluation/dataset.ts#resolveReserveFactorBps` resolves that NULL to 0
 * for this venue only). Adding a reserve cut here would double-charge it.
 *
 * Rate formula (per docs.compound.finance/interest-rates/):
 *   - if util <= kink: rate = baseRate + slopeLow * util
 *   - if util > kink:  rate = baseRate + slopeLow * kink + slopeHigh * (util - kink)
 *
 * MEASURED 2026-09-10. Fed each calibration origin's OWN chain-read
 * parameters and the archive's own `utilizationE18`, this map reproduces
 * Comet's stored `supplyRateE18` EXACTLY — MAE 0, max absolute error 0,
 * across all 10,632 calibration rows. Fed `DEFAULT_COMPOUND_CONFIG` instead
 * it is off by 7.5689 pp MAE / 14.7411 pp max against a mean stored rate of
 * 4.9411 pp. The parameters are the whole difference; the formula was
 * already right.
 *
 * @example
 * ```typescript
 * // Base mainnet Comet USDC at block 16,659,726, read from chain and
 * // annualized (its getters are per-second):
 * const config: CompoundSimulatorConfig = {
 *   baseRate: 0n,                              // 0% base
 *   kink: 85n * RAY / 100n,                    // 85%, not the placeholder's 80%
 *   slopeLow: 48_032_876_705_364_000n,         // ~4.80%, not the placeholder's 6.25%
 *   slopeHigh: 1_601_095_890_410_222_400n,     // ~160.1%
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
 * Moonwell is a COMPOUND V2 fork, not a Compound III fork, and the
 * distinction is the whole of this type. Its `JumpRateModel` stores a
 * BORROW curve (`baseRatePerTimestamp` / `multiplierPerTimestamp` /
 * `jumpMultiplierPerTimestamp` / `kink`), and the mToken derives the supply
 * rate from it the Compound-v2 way:
 *
 *   supply(u) = borrow(u) * u * (1 - reserveFactor)
 *
 * so the same four coefficients that ARE a supply curve on Comet are a
 * borrow curve here. `reserveFactorBps` is therefore a REQUIRED member of
 * the rate model, not decoration - the same reason `AaveSimulatorConfig`
 * requires it (see that type). It comes from the mToken's own
 * `reserveFactorMantissa()`; Base mUSDC has run at 1000 bps and 1500 bps
 * inside the calibration window.
 *
 * NO ORACLE BOUNDS. This type used to carry `minRate`/`maxRate`, described
 * as "Apollo oracle bounds", and `MoonwellSimulator#simulateRate` clamped
 * every result to them. Nothing on chain produces such a bound and the
 * archive has never held a per-origin reading of one, because there is
 * nothing to read: measured over the calibration era, this curve WITHOUT any
 * clamp reproduces the mToken's stored `supplyRateE18` to 2.76e-9 pp MAE
 * (max 5.73e-9 pp - integer truncation) on every one of the 7,370 rows whose
 * IRM address the archive resolved correctly, including rows whose real
 * supply rate is 20.83 pp, which the invented 20% ceiling would have
 * clipped. The bounds were a fabrication; a fabricated clamp is exactly the
 * class of silent substitution this subsystem keeps being bitten by, so they
 * are gone rather than retained "harmlessly".
 *
 * @example
 * ```typescript
 * // Base mainnet mUSDC at block 16,659,726 (IRM 0x54dC...2445), read from
 * // chain and annualized (its getters are per-timestamp):
 * const config: MoonwellSimulatorConfig = {
 *   baseRate: 0n,
 *   kink: 9n * RAY / 10n,                    // 90%
 *   slopeLow: 61_041_780_821_613_600n,       // ~6.10% borrow multiplier
 *   slopeHigh: 9_006_164_383_533_832_800n,   // ~900.6% jump multiplier
 *   reserveFactorBps: 1500,                  // 15%
 * };
 * ```
 */
export interface MoonwellSimulatorConfig {
  /** Annualized BORROW rate at 0% utilization (WAD). */
  baseRate: bigint;
  /** Utilization kink point (RAY, e.g. 9e26 = 90%). */
  kink: bigint;
  /** Annualized BORROW slope below the kink (the `multiplier`), WAD. */
  slopeLow: bigint;
  /** Annualized BORROW slope above the kink (the `jumpMultiplier`), WAD. */
  slopeHigh: bigint;
  /**
   * The mToken's reserve factor, bps - the share of BORROW interest the
   * protocol keeps instead of paying to suppliers. REQUIRED, not optional:
   * it is a multiplicative term in the borrow -> supply conversion, and an
   * absent value silently reading as 0 would overstate the supply rate by
   * exactly this factor.
   */
  reserveFactorBps: number;
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
/**
 * PLACEHOLDER Aave V3 configuration — a LAST RESORT, not the live model.
 *
 * These five numbers do NOT match Base mainnet USDC, and the divergence is
 * large: live is (base 0, slope1 4.7%, slope2 10%, optimal 90%, max 100%,
 * reserveFactor 10%) against the (0, 4%, 60%, 80%, 95%) below. The real
 * per-origin parameters are carried by `MarketObservation.aaveIrmParams` and
 * are what `policy/steps/simulate.ts#resolveConfig` uses whenever they are
 * present; falling back here emits a one-shot warning per market rather than
 * substituting silently.
 *
 * Retained only so hand-built fixtures and synthetic datasets — which carry
 * no chain reading at all — still produce a curve of the right SHAPE.
 */
export const DEFAULT_AAVE_CONFIG: AaveSimulatorConfig = {
  baseRate: 0n,                           // 0% base rate
  variableRateSlope1: 4n * WAD / 100n,    // 4% slope below optimal
  variableRateSlope2: 60n * WAD / 100n,   // 60% slope above optimal
  optimalUtilization: 8n * RAY / 10n,     // 80% optimal
  maxUtilization: 95n * RAY / 100n,       // 95% max
  // Base USDC's real reserve factor, the one field here that IS the live
  // value — the borrow -> supply conversion has no meaningful "shape-only"
  // placeholder, and 0 would assert "suppliers keep all borrow interest",
  // which is true of no Aave market.
  reserveFactorBps: 1000,                 // 10%
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
 * PLACEHOLDER Moonwell configuration - a LAST RESORT, not the live model.
 *
 * `baseRate`/`kink`/`slopeLow`/`slopeHigh` below are the same invented
 * numbers as `DEFAULT_COMPOUND_CONFIG`'s and they are not Moonwell's: Base
 * mUSDC's real kink has been 90%, not 80%, and its real multiplier ~6.10%
 * against this 6.25%, changing at every governance redeploy of the rate
 * model. Measured over the calibration era, simulating from this placeholder
 * (as the shipped code did, oracle clamp included) misses the stored supply
 * rate by 7.2538 pp MAE / 55.8252 pp max against a mean stored rate of
 * 4.8575 pp.
 *
 * The real per-origin parameters are carried by
 * `MarketObservation.irmParams` and are what
 * `policy/steps/simulate.ts#resolveConfig` uses whenever they are present;
 * falling back here emits a one-shot warning per market rather than
 * substituting silently.
 *
 * Retained only so hand-built fixtures and synthetic datasets - which carry
 * no chain reading at all - still produce a curve of the right SHAPE.
 */
export const DEFAULT_MOONWELL_CONFIG: MoonwellSimulatorConfig = {
  baseRate: 3n * WAD / 100n,              // 3% APY
  kink: 8n * RAY / 10n,                   // 80% kink
  slopeLow: PLACEHOLDER_SLOPE_LOW,
  slopeHigh: PLACEHOLDER_SLOPE_HIGH,
  // The one field here that IS a live reading: Base mUSDC's reserve factor,
  // 1500 bps at the end of the calibration window. There is no meaningful
  // "shape-only" placeholder for a multiplicative term, and 0 would assert
  // "suppliers keep all borrow interest", which is true of no Moonwell
  // market. Same reasoning as DEFAULT_AAVE_CONFIG.reserveFactorBps.
  reserveFactorBps: 1500,
};
