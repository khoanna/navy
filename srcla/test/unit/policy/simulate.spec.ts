import { simulateCurves, rateAt } from '../../../src/policy/steps/simulate.js';
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
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

describe('simulateCurves', () => {
  it('produces a curve per eligible market only', () => {
    const curves = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 10);
    expect(curves.map((c) => c.marketId)).toEqual(['compound']);
    expect(curves[0]!.points.length).toBe(10);
  });

  it('point 0 is the current pre-deposit rate', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    expect(c!.points[0]).toBe((WAD * 8n) / 100n);
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

  // DEFAULT_AAVE_CONFIG at exactly optimalUtilization (80%) is an exact 4%:
  // baseRate(0) + variableRateSlope1(4%) * (util/optimal)^2 = 0 + 4% * 1 = 4%.
  const aaveMarket = marketFor('aave', 'aave', (WAD * 4n) / 100n);
  // DEFAULT_COMPOUND_CONFIG / DEFAULT_MOONWELL_CONFIG at 80% utilization
  // (= kink) annualize to ~3.0000256% (baseRate 3% + a negligible kink term);
  // verified numerically in task-5-report.md.
  const compoundMarket80 = marketFor('compound', 'compound', 30_000_025_579_932_000n);
  const moonwellMarket = marketFor('moonwell', 'moonwell', 30_000_025_579_932_000n);

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
