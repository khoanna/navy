// Fixture shape copied from test/unit/policy/optimize.spec.ts so both suites
// describe the same world. The vault is 10,000 USDC (10_000_000_000n base)
// entirely idle, and the quantum is 1,000 USDC.
import { optimize } from '../../../src/policy/steps/optimize.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { stressedCoverage } from '../../../src/policy/steps/coverage.js';
import type {
  DecisionInput, MarketObservation, PolicyArtifact, RateCurve,
} from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const Q = 1_000_000_000n;          // 1,000 USDC quantum
const NAV = 10_000_000_000n;       // 10,000 USDC vault

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id, adapter: `0x${id}`, protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10_000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

const curve = (id: string, rates: bigint[]): RateCurve =>
  ({ marketId: id, quantumBase: Q, points: rates, maxXBase: Q * BigInt(rates.length - 1) });

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: NAV, idleBase: NAV, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0,
      paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n,
           ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

const artifact = (): PolicyArtifact => ({
  ...loadBootstrapArtifact(),
  residualQuantileWadByMarket: { a: 0n, b: 0n },
  portfolioResidualQuantileWad: -1_000_000n,
});

const OPTS = { quantumBase: Q, reserveQuantile: 0.95, reserveHorizonSeconds: 604_800 };
const covOf = (target: Map<string, bigint>, markets: MarketObservation[]) => {
  const deployed = [...target.values()].reduce((s, v) => s + v, 0n);
  return stressedCoverage({
    holdings: target, idleBase: NAV - deployed,
    venueCashByMarket: new Map(markets.map((m) => [m.marketId, m.cash])),
    totalAssetsBase: NAV,
  }).worst;
};

describe('optimize — coverage floor', () => {
  it('does not select an allocation the §11.4 metric would score below the floor', () => {
    // Cash of 8,000 USDC (80% of the 10,000 USDC vault) is deliberately NOT
    // "small" -- at that utilisation (0) P5's structural liquidity cap
    // (liquidityCapBase, optimize.ts) equals venue cash exactly, so a cap of
    // 2,000 USDC would already stop deployment before the coverage floor
    // (which starts to bind only once idle < ~4,950) ever got a chance to
    // fire, making the floor's own effect untestable. 8,000 lets the cap
    // allow deployment past the point the floor rejects, so this exercises
    // the floor itself rather than a coincidentally-tighter cap.
    const ms = [market('a', { cash: 8_000_000_000n })];
    const out = optimize(input(ms), [curve('a', Array(11).fill(WAD / 20n))], artifact(), OPTS);
    expect(covOf(out.target, ms)).toBeGreaterThanOrEqual(0.99);
  });

  it('prefers the deep venue over the thin one at an equal rate', () => {
    // Identical curves; 'b' holds 100x the cash. Making the optimiser evaluate
    // what the gate grades is exactly what should break this tie.
    const ms = [
      market('a', { cash: 2_000_000_000n }),
      market('b', { cash: 200_000_000_000n }),
    ];
    const rates = Array(11).fill(WAD / 20n);
    const out = optimize(input(ms), [curve('a', rates), curve('b', rates)], artifact(), OPTS);
    expect(out.target.get('b') ?? 0n).toBeGreaterThan(out.target.get('a') ?? 0n);
  });

  it('is removed by the coverageFloor ablation, and by nothing else', () => {
    // Same 8,000 USDC cash as the first test, for the same reason: at 2,000
    // USDC cash the P5 liquidity cap (== cash at this utilisation) already
    // stops deployment at exactly 2,000 in both branches, so ablating the
    // floor would change nothing -- not because the ablation is inert, but
    // because a tighter constraint was binding first. At 8,000 the cap
    // permits deployment the floor alone must reject.
    const ms = [market('a', { cash: 8_000_000_000n })];
    const curves = [curve('a', Array(11).fill(WAD / 20n))];
    const withFloor = optimize(input(ms), curves, artifact(), OPTS);
    const without = optimize(input(ms), curves, artifact(), {
      ...OPTS, disable: { coverageFloor: true },
    });
    // The ablation must change the answer -- otherwise H-style ablation of
    // this component would be inert by construction.
    expect([...without.target.entries()]).not.toEqual([...withFloor.target.entries()]);
    expect(covOf(without.target, ms)).toBeLessThan(covOf(withFloor.target, ms));
  });
});
