import { simulateCurves, rateAt, __resetPlaceholderConfigWarnings } from '../../../src/policy/steps/simulate.js';
import { jest } from '@jest/globals';
import type { DecisionInput, MarketObservation } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const QUANTUM = 1_000_000_000n; // 1,000 USDC

function compoundMarket(): MarketObservation {
  return {
    marketId: 'compound', adapter: '0xc', protocol: 'compound',
    cash: 800_000_000_000n, borrows: 3_200_000_000_000n, reserves: 0n,
    supplyRateWad: (WAD * 8n) / 100n, utilizationWad: (WAD * 80n) / 100n,
    positionBase: 0n, maxDeployableBase: 100_000_000_000n, maxWithdrawableBase: 800_000_000_000n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
  };
}

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10n ** 13n, idleBase: 10n ** 12n, sharesOutstanding: 10n ** 13n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 50, paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

describe('simulateCurves', () => {
  it('produces a curve per eligible market only', () => {
    const curves = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 10);
    expect(curves.map((c) => c.marketId)).toEqual(['compound']);
    expect(curves[0]!.points.length).toBe(10);
  });

  it('point 0 (a market at zero position) closely approximates the observed pre-deposit rate', () => {
    // Point 0 is x=0, the vault's ABSOLUTE target allocation (see
    // RateCurve.points' doc comment) -- for a market at positionBase=0 that
    // coincides with "no change" from the observed state, but it is now
    // SIMULATED via DefaultConfigs and the per-second-annualisation round
    // trip (whole-branch review, HIGH 4 fix), not copied verbatim from the
    // observation, so it only approximates m.supplyRateWad to that model's
    // rounding, not bit-for-bit.
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    const expected = (WAD * 8n) / 100n;
    const diff = c!.points[0]! > expected ? c!.points[0]! - expected : expected - c!.points[0]!;
    expect(diff).toBeLessThan(expected / 1_000_000n); // within 1 part in a million
  });

  // Whole-branch review, HIGH 4: the curve's x is documented (RateCurve.points)
  // as the vault's ABSOLUTE target allocation, not an incremental deposit on
  // top of the vault's current position. This test fails under the OLD,
  // incremental-x construction and every fixture above passed only because
  // positionBase was 0n throughout this file (absolute and incremental
  // coincide at zero position).
  it('a market with an existing position produces the same rate at its absolute current allocation as an equivalent zero-position market at x=0', () => {
    // Two markets describe the SAME final on-chain state (same observed
    // cash/borrows) but attribute the cash differently: `withPosition` says
    // the vault already holds `position` of it; `noPosition` says the vault
    // holds none (someone else does). Because x is absolute, the rate the
    // vault would see holding exactly `position` in `withPosition` must
    // equal the rate it would see holding exactly 0 in `noPosition` — under
    // the old incremental interpretation, `withPosition`'s curve added
    // `position` ON TOP of cash that already included it, landing on a
    // materially higher (and so differently-rated) simulated cash figure
    // than `noPosition`'s point at x=0.
    const cash = 800_000_000_000n;
    const borrows = 3_200_000_000_000n;
    const position = 200_000_000_000n;

    const noPosition = compoundMarket();
    noPosition.cash = cash;
    noPosition.borrows = borrows;
    noPosition.positionBase = 0n;

    const withPosition = compoundMarket();
    withPosition.cash = cash;
    withPosition.borrows = borrows;
    withPosition.positionBase = position;

    const quantum = position; // x = position lands exactly on grid point k=1
    const [noPosCurve] = simulateCurves(input([noPosition]), ['compound'], quantum, 3);
    const [withPosCurve] = simulateCurves(input([withPosition]), ['compound'], quantum, 3);

    expect(rateAt(withPosCurve!, position)).toBe(rateAt(noPosCurve!, 0n));
  });

  it('rate is non-increasing as allocation grows (capacity effect)', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 20);
    for (let i = 1; i < c!.points.length; i++) {
      expect(c!.points[i]! <= c!.points[i - 1]!).toBe(true);
    }
  });

  it('rateAt returns the exact sample at a quantum boundary', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    expect(rateAt(c!, QUANTUM * 2n)).toBe(c!.points[2]);
  });

  it('rateAt interpolates between samples', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    const mid = rateAt(c!, QUANTUM * 2n + QUANTUM / 2n);
    const lo = c!.points[2]!;
    const hi = c!.points[3]!;
    expect(mid <= lo).toBe(true);
    expect(mid >= hi).toBe(true);
  });

  it('clamps beyond the last sample rather than extrapolating', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    expect(rateAt(c!, QUANTUM * 999n)).toBe(c!.points[4]);
  });

  it('is deterministic across repeated calls', () => {
    const a = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 8);
    const b = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 8);
    expect(a[0]!.points).toEqual(b[0]!.points);
  });
});

/**
 * Unit-mismatch guard (all three protocols).
 *
 * points[0] comes straight from the observation (annualized WAD); points[1]
 * comes from the protocol simulator at one quantum of deposit. Each fixture's
 * `supplyRateWad` below is set to what that protocol's own default-config
 * model computes at this fixture's 80% utilization and zero deposit — i.e.
 * the "observed current rate" and "the model's own opinion of the current
 * rate" agree by construction. A one-quantum deposit into an 800,000 USDC
 * market can only move the rate a hair, so points[0] and points[1] must sit
 * within a tight relative tolerance of each other. A scale bug (per-second
 * vs annualized, or an un-annualized value slamming into an oracle bound)
 * blows this apart by many orders of magnitude — this is exactly the class
 * of bug found in Task 5 review (Compound's un-annualized rate, then
 * Moonwell's oracle clamp comparing per-second against annualized bounds).
 */
describe('simulateCurves — curve continuity across protocols (unit-mismatch guard)', () => {
  const cash = 800_000_000_000n;
  const borrows = 3_200_000_000_000n;

  function marketFor(
    protocol: MarketObservation['protocol'],
    marketId: string,
    supplyRateWad: bigint
  ): MarketObservation {
    return {
      marketId, adapter: '0x' + marketId, protocol,
      cash, borrows, reserves: 0n,
      supplyRateWad, utilizationWad: (WAD * 80n) / 100n,
      positionBase: 0n, maxDeployableBase: 100_000_000_000n, maxWithdrawableBase: 800_000_000_000n,
      configDigest: '0xd', regimeId: 'r1', paused: false,
      capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    };
  }

  // DEFAULT_AAVE_CONFIG at exactly optimalUtilization (80%) gives a BORROW
  // rate of exactly 4% -- baseRate(0) + variableRateSlope1(4%) * (util/optimal)
  // = 4% -- and a SUPPLY rate of 4% * 0.8 * (1 - 10% reserveFactor) = 2.88%.
  // The 2026-09-10 Aave fix is what makes those two different numbers: the
  // simulator used to return the borrow rate here (and to square the ratio,
  // which happens to be a no-op at exactly optimal). This fixture's declared
  // `supplyRateWad` is the SUPPLY rate, because that is what the field means.
  const aaveMarket = marketFor('aave', 'aave', (WAD * 288n) / 10_000n);
  // DEFAULT_COMPOUND_CONFIG / DEFAULT_MOONWELL_CONFIG at 80% utilization
  // (= kink): baseRate(3%) + slopeLow(6.25%) * 0.8 = 3% + 5% = 8%. Value
  // below is the simulator's own zero-deposit output at this fixture's
  // utilization (79999999964582400 ~= 8% less a few units of per-second/
  // annualization truncation, computed by calling the real simulator with
  // this fixture and reading back postDepositRate at x=0).
  const compoundMarket80 = marketFor('compound', 'compound', 79_999_999_964_582_400n);
  const moonwellMarket = marketFor('moonwell', 'moonwell', 79_999_999_964_582_400n);

  it.each([
    ['aave', aaveMarket],
    ['compound', compoundMarket80],
    ['moonwell', moonwellMarket],
  ] as const)('%s: points[1] stays within 1%% of points[0] for a one-quantum deposit', (_name, market) => {
    const [c] = simulateCurves(input([market]), [market.marketId], QUANTUM, 2);
    const p0 = c!.points[0]!;
    const p1 = c!.points[1]!;
    expect(p0 - p1 <= p0 / 100n).toBe(true);
  });
});

const RAY = 10n ** 27n;

/**
 * Materiality guard.
 *
 * The continuity test above only proves points[0] and points[1] don't have
 * a *unit* cliff between them — it passes just as well against a flat curve
 * as against a correctly-sloped one, which is exactly how a degenerate slope
 * (e.g. `32n * WAD / 1_000_000_000n` ~= 3.2e-8 WAD, ~7 orders of magnitude
 * too small relative to a several-percent baseRate) can go undetected: it
 * makes the curve flat to several decimal places across the whole
 * utilization range with no error, no NaN, nothing a shape check catches.
 * This test asserts an actual CAPACITY EFFECT instead: a deposit large
 * relative to free cash must move the rate by a material amount.
 *
 * Uses explicit, test-local IRM parameters via `MarketObservation.irmParams`
 * — deliberately NOT `DefaultConfigs` — so this test pins the shape of the
 * kinked-linear MODEL itself, independent of whatever numbers happen to be
 * shipped as defaults. Parameters describe a realistic curve: ~0% at 0%
 * utilization, rising to ~5% at an 80% kink (slopeLow = 5% / 0.8 = 6.25%),
 * with a steep post-kink slope of 150% (chosen simply to be "clearly steep";
 * at 90% utilization — 10 points past kink — it contributes 15%).
 */
describe('simulateCurves — materiality guard (deposit must move the rate materially)', () => {
  it('a deposit large relative to free cash lowers the rate by >= 10% relative', () => {
    // 90% utilization (above the 80% kink, in the steep slopeHigh region):
    // cash=200,000 USDC, borrows=1,800,000 USDC -> util = 1.8M/2.0M = 90%.
    const cash = 200_000_000_000n;
    const borrows = 1_800_000_000_000n;
    const irmParams = {
      baseRateWad: 0n,
      kinkRay: (8n * RAY) / 10n, // 80%
      slopeLowWad: (625n * WAD) / 10_000n, // 6.25% -> 5% at the 80% kink
      slopeHighWad: (150n * WAD) / 100n, // 150% -> steep above kink
    };
    // Model's own rate at 90% util, zero deposit (exact, no truncation --
    // this is the observation's declared value, not a simulator output):
    // baseRate(0) + slopeLow*kink(6.25%*0.8=5%) + slopeHigh*(0.9-0.8)(150%*0.1=15%)
    // = 5% + 15% = 20%.
    const supplyRateWad = (20n * WAD) / 100n;
    const market: MarketObservation = {
      marketId: 'high-util', adapter: '0xh', protocol: 'compound',
      cash, borrows, reserves: 0n,
      supplyRateWad, utilizationWad: (WAD * 90n) / 100n,
      positionBase: 0n, maxDeployableBase: 100_000_000_000n, maxWithdrawableBase: cash,
      configDigest: '0xd', regimeId: 'r1', paused: false,
      capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
      irmParams,
    };

    // Deposit 300,000 USDC -- 1.5x free cash -- dropping utilization to
    // 1.8M/2.3M ~= 78.26%, back below the kink into the shallow region.
    const QUANTUM = 300_000_000_000n;
    const [c] = simulateCurves(input([market]), ['high-util'], QUANTUM, 2);
    const p0 = c!.points[0]!;
    const p1 = c!.points[1]!;

    expect(p1).toBeLessThan(p0);
    const relativeDeclineBps = ((p0 - p1) * 10_000n) / p0;
    // relativeDeclineBps computes to 7554 (~75.5%) with these parameters --
    // comfortably clears the 10% (1000 bps) bar asserted below.
    expect(relativeDeclineBps >= 1000n).toBe(true);
  });
});

/**
 * Override-seam guard.
 *
 * Proves `simulateCurves` actually reads `m.irmParams` rather than ignoring
 * it: the exact same market (cash/borrows/deposit) produces materially
 * different curves under two different irmParams.
 */
describe('simulateCurves — irmParams override is actually used', () => {
  function marketWithIrm(irmParams: NonNullable<MarketObservation['irmParams']>): MarketObservation {
    return {
      marketId: 'override', adapter: '0xo', protocol: 'compound',
      cash: 800_000_000_000n, borrows: 3_200_000_000_000n, reserves: 0n,
      supplyRateWad: (WAD * 8n) / 100n, utilizationWad: (WAD * 80n) / 100n,
      positionBase: 0n, maxDeployableBase: 100_000_000_000n, maxWithdrawableBase: 800_000_000_000n,
      configDigest: '0xd', regimeId: 'r1', paused: false,
      capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
      irmParams,
    };
  }

  it('two different irmParams on the same market yield materially different curves', () => {
    const steep = {
      baseRateWad: (3n * WAD) / 100n, kinkRay: (8n * RAY) / 10n,
      slopeLowWad: (625n * WAD) / 10_000n, slopeHighWad: WAD,
    };
    const flat = {
      baseRateWad: (3n * WAD) / 100n, kinkRay: (8n * RAY) / 10n,
      slopeLowWad: 0n, slopeHighWad: 0n,
    };
    const QUANTUM = 1_000_000_000n;
    const [steepCurve] = simulateCurves(input([marketWithIrm(steep)]), ['override'], QUANTUM, 2);
    const [flatCurve] = simulateCurves(input([marketWithIrm(flat)]), ['override'], QUANTUM, 2);

    // steep -> ~79987503091867200 (~8%), flat -> ~29999999986718400 (~3%,
    // exactly baseRate with zero slope) -- computed by calling simulateCurves
    // with each irmParams and reading back points[1].
    expect(steepCurve!.points[1]).not.toBe(flatCurve!.points[1]);
    expect(steepCurve!.points[1]!).toBeGreaterThan(flatCurve!.points[1]! * 2n);
  });
});

const KINKED_IRM_PARAMS = {
  baseRateWad: (3n * WAD) / 100n,
  kinkRay: (8n * RAY) / 10n,
  slopeLowWad: (625n * WAD) / 10_000n,
  slopeHighWad: WAD,
};

function aaveMarketWith(irmParams?: MarketObservation['irmParams']): MarketObservation {
  const base = {
    marketId: 'aave-market', adapter: '0xa', protocol: 'aave' as const,
    cash: 800_000_000_000n, borrows: 3_200_000_000_000n, reserves: 0n,
    supplyRateWad: (WAD * 4n) / 100n, utilizationWad: (WAD * 80n) / 100n,
    positionBase: 0n, maxDeployableBase: 100_000_000_000n, maxWithdrawableBase: 800_000_000_000n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
  };
  return irmParams ? { ...base, irmParams } : base;
}

/**
 * Aave + irmParams guard.
 *
 * irmParams' shape (baseRate/kink/slopeLow/slopeHigh) fits the kinked-linear
 * Compound/Moonwell model, not Aave's structurally different piecewise-
 * quadratic model. Silently dropping an override that does not apply is the
 * same failure mode this task hit twice already (a wrong or ignored number
 * producing plausible-looking output with no error) -- so an Aave market
 * that supplies irmParams must fail loudly instead.
 */
describe('simulateCurves — Aave rejects irmParams instead of silently ignoring it', () => {
  it('throws, naming the market id, when an Aave market supplies irmParams', () => {
    const market = aaveMarketWith(KINKED_IRM_PARAMS);
    expect(() => simulateCurves(input([market]), ['aave-market'], QUANTUM, 2)).toThrow(
      /aave-market/
    );
  });

  it('an Aave market with no irmParams still produces a normal curve', () => {
    const market = aaveMarketWith();
    const [c] = simulateCurves(input([market]), ['aave-market'], QUANTUM, 5);
    expect(c!.marketId).toBe('aave-market');
    expect(c!.points.length).toBe(5);
    // 2.88%, not 4%: DEFAULT_AAVE_CONFIG at this fixture's 80% utilization
    // (= its optimalUtilization) gives a BORROW rate of 4%, and the supply
    // rate suppliers earn is 4% * u(0.8) * (1 - reserveFactor(10%)) = 2.88%.
    // Before the 2026-09-10 Aave fix this asserted 4% -- the borrow rate
    // written straight into RateCurve.points as if it were a supply rate.
    expect(c!.points[0]).toBe((WAD * 288n) / 10_000n);
    for (let i = 1; i < c!.points.length; i++) {
      expect(c!.points[i]! <= c!.points[i - 1]!).toBe(true);
    }
  });
});

/**
 * Aave live-parameter seam (`aaveIrmParams`) — the 2026-09-10 fix (c).
 *
 * `resolveConfig` used to return `DefaultConfigs.aave` unconditionally, so
 * every live Aave reading the archive already carried was discarded and Base
 * USDC's curve was simulated from placeholders. These cases pin that the
 * seam exists, is actually read, and reproduces the protocol — and that the
 * placeholder fallback is now audible rather than silent.
 */
describe('simulateCurves — Aave uses the live on-chain rate strategy', () => {
  // Base mainnet Aave V3 USDC at fork block 51,105,787. Same chain-read
  // vector as test/unit/protocols/aave-simulator.spec.ts, which carries the
  // full provenance; `currentLiquidityRate` there was 3.7164226508%.
  const LIVE_BASE_USDC = {
    baseRateWad: 0n,
    variableRateSlope1Wad: (47n * WAD) / 1000n, // 4.7%
    variableRateSlope2Wad: (10n * WAD) / 100n, // 10%
    optimalUtilizationRay: (9n * RAY) / 10n, // 90%
    maxUtilizationRay: RAY, // 100%
    reserveFactorBps: 1000, // 10%
  };
  const VIRTUAL_BALANCE = 20_359_084_142_184n;
  const VARIABLE_DEBT = 163_435_422_956_531n;

  function liveAaveMarket(
    aaveIrmParams?: MarketObservation['aaveIrmParams']
  ): MarketObservation {
    const base: MarketObservation = {
      marketId: 'aave-v3-usdc', adapter: '0xa', protocol: 'aave',
      cash: VIRTUAL_BALANCE, borrows: VARIABLE_DEBT, reserves: 0n,
      supplyRateWad: 37_164_226_507_869_988n, utilizationWad: (WAD * 8892n) / 10_000n,
      positionBase: 0n, maxDeployableBase: 10n ** 15n, maxWithdrawableBase: VIRTUAL_BALANCE,
      configDigest: '0xd', regimeId: 'r1', paused: false,
      capBps: 10_000, absoluteCapBase: 10n ** 15n, maxLossBps: 50, dependencyGroupIds: [],
    };
    return aaveIrmParams ? { ...base, aaveIrmParams } : base;
  }

  beforeEach(() => __resetPlaceholderConfigWarnings());

  it('points[0] reproduces the chain-reported currentLiquidityRate', () => {
    const [c] = simulateCurves(
      input([liveAaveMarket(LIVE_BASE_USDC)]), ['aave-v3-usdc'], 1_000_000_000_000n, 3
    );
    // The simulator's own value at this state; the chain's stored
    // currentLiquidityRate is 37164226507869988, 2.0e-7 relative away
    // (the stored rate is written at the last updateInterestRates, while the
    // balances have accrued since).
    expect(c!.points[0]).toBe(37_164_233_902_739_004n);
    const chain = 37_164_226_507_869_988n;
    const diff = c!.points[0]! - chain;
    expect((diff * 1_000_000n) / chain).toBe(0n); // within 1 part per million
  });

  it('discarding the live parameters overstates this market 6.6x, even with the curve fixed', () => {
    // The ISOLATED harm of fix (c). Both curves below run the corrected
    // linear+conversion formula; the only difference is whether the live
    // reading reaches it. Without it, DEFAULT_AAVE_CONFIG's placeholders
    // (slope1 4% / slope2 60% / optimal 80% / max 95%) put u = 0.8892 above
    // an 80% optimal that the real market has at 90%, and onto a 60% slope
    // the real market has at 10% -- 24.62% against a true 3.72%.
    //
    // NOT the composite 4.29x quoted in the fix report: that figure is the
    // SHIPPED pre-fix path, where the squared curve and the missing
    // conversion partly cancelled this overstatement (15.94% rather than
    // 24.62%). Pinned here so a silent regression to the placeholders is
    // visible on its own terms.
    const [live] = simulateCurves(
      input([liveAaveMarket(LIVE_BASE_USDC)]), ['aave-v3-usdc'], 1_000_000_000_000n, 2
    );
    const [placeholder] = simulateCurves(
      input([liveAaveMarket()]), ['aave-v3-usdc'], 1_000_000_000_000n, 2
    );
    expect(placeholder!.points[0]).toBe(246_244_033_643_250_492n); // 24.62%
    const ratioBps = (placeholder!.points[0]! * 10_000n) / live!.points[0]!;
    expect(ratioBps).toBe(66_258n); // 6.6258x
  });

  it('two different aaveIrmParams on the same market yield materially different curves', () => {
    const steep = { ...LIVE_BASE_USDC, variableRateSlope1Wad: (20n * WAD) / 100n };
    const [flatC] = simulateCurves(
      input([liveAaveMarket(LIVE_BASE_USDC)]), ['aave-v3-usdc'], 1_000_000_000_000n, 2
    );
    const [steepC] = simulateCurves(
      input([liveAaveMarket(steep)]), ['aave-v3-usdc'], 1_000_000_000_000n, 2
    );
    // slope1 20% vs 4.7% -> the whole curve scales by 20/4.7 ~= 4.26x.
    expect(steepC!.points[0]! > flatC!.points[0]! * 4n).toBe(true);
  });

  it('falling back to the placeholder configuration WARNS, naming the market', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      simulateCurves(input([liveAaveMarket()]), ['aave-v3-usdc'], 1_000_000_000_000n, 2);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]![0]);
      expect(msg).toContain('aave-v3-usdc');
      expect(msg).toContain('PLACEHOLDER RATE MODEL');
      // Deduplicated: a replay runs this once per origin, ~10k times.
      simulateCurves(input([liveAaveMarket()]), ['aave-v3-usdc'], 1_000_000_000_000n, 2);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT warn when the live parameters are present', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      simulateCurves(
        input([liveAaveMarket(LIVE_BASE_USDC)]), ['aave-v3-usdc'], 1_000_000_000_000n, 2
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
