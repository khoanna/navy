/**
 * Aave V3 rate-map golden vectors.
 *
 * WHY THIS FILE EXISTS. `AaveV3Simulator` used to (a) SQUARE the usage ratio,
 * asserting a quadratic curve Aave does not have, and (b) return the BORROW
 * rate from a function documented as returning a supply rate — which
 * `policy/steps/simulate.ts` then wrote verbatim into `RateCurve.points`, the
 * curve `decide()` actually consumes. Neither defect was detectable from the
 * old tests, because every one of them checked the formula against itself
 * (structural properties, monotonicity, field presence) rather than against
 * the protocol.
 *
 * So the numbers below are READ FROM CHAIN, not derived from the code under
 * test. They are Base mainnet Aave V3's own reported state and rates at a
 * pinned block, and the assertions require the simulator to reproduce them.
 * A future regression to a squared curve, or a dropped borrow -> supply
 * conversion, fails here against a measurement rather than against an
 * opinion — and the last two cases in the first block prove exactly that by
 * showing both wrong forms MISS these vectors by orders of magnitude more
 * than the tolerance.
 *
 * PROVENANCE — every value below was read with `cast call` against an Anvil
 * fork of Base mainnet at block 51,105,787:
 *
 *   Pool          0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
 *   USDC reserve  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   rate strategy 0x86AB1C62A8bf868E1b3E1ab87d587Aba6fbCbDC5
 *
 *   getReserveData(USDC).currentVariableBorrowRate = 46437518612998628881504350 (RAY)
 *   getReserveData(USDC).currentLiquidityRate      = 37164226507869988869487886 (RAY)
 *   getReserveData(USDC).configuration bits 64..79 = 1000 (reserve factor, bps)
 *   getVirtualUnderlyingBalance(USDC)              = 20359084142184
 *   variableDebtToken.totalSupply()                = 163435422956531
 *   strategy.getBaseVariableBorrowRate(USDC)       = 0
 *   strategy.getVariableRateSlope1(USDC)           = 47000000000000000000000000 (RAY = 4.7%)
 *   strategy.getVariableRateSlope2(USDC)           = 100000000000000000000000000 (RAY = 10%)
 *   strategy.getOptimalUsageRatio(USDC)            = 900000000000000000000000000 (RAY = 90%)
 *
 * TOLERANCE. The simulator is NOT expected to match the chain bit-for-bit:
 * `currentLiquidityRate`/`currentVariableBorrowRate` are STORED values,
 * written the last time `updateInterestRates` ran, while the virtual balance
 * and the debt token's total supply have accrued since. The observed
 * disagreement is 1.5e-8 relative on the borrow rate and 2.0e-7 on the
 * supply rate, so 1 part per million is a tolerance the chain drift fits
 * inside and both wrong formulas (1.2% and 25% off respectively) do not.
 * The exact computed integers are ALSO pinned, so a formula change is caught
 * bit-for-bit even where it would stay inside the tolerance.
 */
import { describe, it, expect } from '@jest/globals';
import { AaveV3Simulator } from '../../../src/protocols/simulation/aave-simulator.js';
import type { AaveSimulatorConfig, MarketState } from '../../../src/protocols/simulation/types.js';
import { RAY, WAD } from '../../../src/protocols/math.js';

const sim = new AaveV3Simulator();

/** RAY-scale annualized rate -> the WAD scale this codebase works in. */
const rayRateToWad = (ray: bigint): bigint => ray / 10n ** 9n;

// ---- chain-read state at block 51,105,787 -------------------------------
const VIRTUAL_BALANCE = 20_359_084_142_184n;
const VARIABLE_DEBT = 163_435_422_956_531n;
const ONCHAIN_BORROW_RATE_RAY = 46_437_518_612_998_628_881_504_350n;
const ONCHAIN_LIQUIDITY_RATE_RAY = 37_164_226_507_869_988_869_487_886n;

/** The live registered strategy, exactly as chain reports it. */
const BASE_USDC_CONFIG: AaveSimulatorConfig = {
  baseRate: 0n,
  variableRateSlope1: rayRateToWad(47_000_000_000_000_000_000_000_000n), // 4.7%
  variableRateSlope2: rayRateToWad(100_000_000_000_000_000_000_000_000n), // 10%
  optimalUtilization: 900_000_000_000_000_000_000_000_000n, // 90% RAY
  maxUtilization: RAY, // 100% — Aave's curve is defined all the way up
  reserveFactorBps: 1000, // 10%
};

/** |a - b| / b, in parts per billion, as an integer so bigint precision holds. */
function relPpb(a: bigint, b: bigint): bigint {
  const d = a > b ? a - b : b - a;
  return (d * 1_000_000_000n) / b;
}
const ONE_PPM_IN_PPB = 1000n;

describe('AaveV3Simulator — golden vectors read from Base mainnet', () => {
  const util = sim.calculateUtilization(VIRTUAL_BALANCE, VARIABLE_DEBT);

  it('reproduces the reserve utilization the two chain-read balances imply', () => {
    // 163,435,422,956,531 / (20,359,084,142,184 + 163,435,422,956,531)
    expect(util).toBe(889_229_093_602_621_921_802_141_654n); // 0.8892290936 RAY
    // Just BELOW the 90% optimal usage ratio, so this vector exercises the
    // shallow (slope1) leg of the piecewise curve.
    expect(util).toBeLessThan(BASE_USDC_CONFIG.optimalUtilization);
  });

  it('BORROW rate matches currentVariableBorrowRate', () => {
    const borrow = sim.calculateBorrowRateFromUtilization(util, BASE_USDC_CONFIG);
    // Bit-for-bit pin of the linear formula at this state: 4.6437519333%.
    expect(borrow).toBe(46_437_519_332_581_367n);
    // ...and it IS the chain's own number, to well inside a part per million.
    expect(relPpb(borrow, rayRateToWad(ONCHAIN_BORROW_RATE_RAY))).toBeLessThan(ONE_PPM_IN_PPB);
  });

  it('SUPPLY rate matches currentLiquidityRate', () => {
    const supply = sim.calculateRateFromUtilization(util, BASE_USDC_CONFIG);
    // Bit-for-bit pin: 3.7164233903% = borrow * u * (1 - 10%).
    expect(supply).toBe(37_164_233_902_739_004n);
    expect(relPpb(supply, rayRateToWad(ONCHAIN_LIQUIDITY_RATE_RAY))).toBeLessThan(ONE_PPM_IN_PPB);
  });

  it('the SQUARED usage-ratio form (the pre-2026-09-10 curve) does NOT match chain', () => {
    // Reproduces the old code exactly on this vector's branch (u <= optimal):
    // base + slope1 * (u / optimal)^2 rather than base + slope1 * (u / optimal).
    const { baseRate, variableRateSlope1, optimalUtilization } = BASE_USDC_CONFIG;
    const utilRatio = (util * RAY) / optimalUtilization;
    const squaredBorrow = baseRate + (variableRateSlope1 * ((utilRatio * utilRatio) / RAY)) / RAY;

    expect(squaredBorrow).toBe(45_881_770_250_295_068n); // 4.5881770250%
    // 0.0556 pp low — 1.2% relative, four orders of magnitude outside tolerance.
    expect(relPpb(squaredBorrow, rayRateToWad(ONCHAIN_BORROW_RATE_RAY))).toBeGreaterThan(ONE_PPM_IN_PPB);
  });

  it('the BORROW rate is NOT the supply rate — the conversion is not optional', () => {
    const borrow = sim.calculateBorrowRateFromUtilization(util, BASE_USDC_CONFIG);
    // Assigning the borrow rate to `postDepositRate` (the pre-2026-09-10
    // behaviour) overstates what a supplier earns by 1 / (u * (1 - rf)).
    expect(relPpb(borrow, rayRateToWad(ONCHAIN_LIQUIDITY_RATE_RAY))).toBeGreaterThan(ONE_PPM_IN_PPB);
    expect(borrow).toBeGreaterThan(rayRateToWad(ONCHAIN_LIQUIDITY_RATE_RAY));
  });

  it('simulateRate at zero deposit carries the SUPPLY rate in postDepositRate', () => {
    const state: MarketState = {
      marketId: 'aave-v3-usdc',
      name: 'aave',
      cash: VIRTUAL_BALANCE,
      borrows: VARIABLE_DEBT,
      supplyRate: rayRateToWad(ONCHAIN_LIQUIDITY_RATE_RAY),
    };
    const r = sim.simulateRate(state, 0n, BASE_USDC_CONFIG);
    expect(r.postDepositRate).toBe(37_164_233_902_739_004n);
    expect(relPpb(r.postDepositRate, rayRateToWad(ONCHAIN_LIQUIDITY_RATE_RAY))).toBeLessThan(ONE_PPM_IN_PPB);
  });
});

/**
 * Shape assertions. The golden vectors above pin ONE point on the curve;
 * these pin that the curve between the points is the LINEAR one Aave
 * implements. A quadratic curve reproduces the endpoints (0, optimal, 100%)
 * exactly and diverges only in between, so an endpoint check alone cannot
 * tell the two apart — the midpoint check can.
 */
describe('AaveV3Simulator — the borrow curve is linear, not quadratic', () => {
  const cfg = BASE_USDC_CONFIG;

  it('below optimal: the rate at half of optimal usage is half the rate at optimal', () => {
    const atOptimal = sim.calculateBorrowRateFromUtilization(cfg.optimalUtilization, cfg);
    const atHalf = sim.calculateBorrowRateFromUtilization(cfg.optimalUtilization / 2n, cfg);
    // baseRate is 0 here, so linear => exactly half. (A squared curve would
    // give a QUARTER, which is what the old code produced.)
    expect(atHalf * 2n).toBe(atOptimal);
    expect(atOptimal).toBe(cfg.variableRateSlope1); // 4.7% at the kink
  });

  it('above optimal: the rate halfway to 100% usage is slope1 + half of slope2', () => {
    const midway = cfg.optimalUtilization + (RAY - cfg.optimalUtilization) / 2n; // 95% usage
    const rate = sim.calculateBorrowRateFromUtilization(midway, cfg);
    // linear: 4.7% + 10%/2 = 9.7%. squared would give 4.7% + 10%/4 = 7.2%.
    expect(rate).toBe(cfg.variableRateSlope1 + cfg.variableRateSlope2 / 2n);
    expect(rate).toBe((97n * WAD) / 1000n);
  });

  it('borrowToSupplyRate applies BOTH the utilization and the reserve-factor terms', () => {
    const borrow = (10n * WAD) / 100n; // 10%
    const u = (8n * RAY) / 10n; // 80%
    // 10% * 0.8 * (1 - 0.10) = 7.2%
    expect(sim.borrowToSupplyRate(borrow, u, 1000)).toBe((72n * WAD) / 1000n);
    // With no reserve cut the utilization term still applies: 10% * 0.8 = 8%.
    expect(sim.borrowToSupplyRate(borrow, u, 0)).toBe((8n * WAD) / 100n);
  });
});
