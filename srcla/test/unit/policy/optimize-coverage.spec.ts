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

describe('optimize — least-infeasible fallback', () => {
  // A quantum this large relative to NAV is deliberate, not incidental: the
  // registered floor's tightest level is 5,000bps (50% of TVL), so the very
  // FIRST quantum a greedy search would ever try must already push
  // cumulative deployment past ~half of NAV for the floor to be unclearable
  // from a standing start of zero. Idle alone (NAV - one small quantum)
  // clears that bar trivially at any quantum that is a small fraction of
  // NAV -- which is exactly why the existing tests above (Q = 1,000 against
  // a 10,000 NAV) show the floor binding only after PARTIAL deployment, not
  // from zero. Reaching a genuinely EMPTY target -- the case this fallback
  // exists for -- requires the first quantum itself to be large enough to
  // fail the floor, which forces at most one quantum to fit in the vault at
  // all (2 x 6,000 > 10,000), i.e. a single decisive allocation choice.
  const Q_BIG = 6_000_000_000n; // 6,000 USDC

  it('returns the HIGHEST-COVERAGE candidate when none clears the floor', () => {
    // Two venues, each independently reachable in the ONE quantum this
    // universe allows. 'a' pays a much better rate (10% vs 1%) but its cash
    // exactly matches the quantum, so deploying into it drains coverage to
    // 0.80. 'c' pays worse but holds a bit more cash (6,500 vs 6,000), so
    // depositing there leaves coverage at 0.90 -- worse than doing nothing,
    // but strictly better than 'a'. An objective-only greedy would pick 'a'
    // (higher rate); the fallback must not: it has to pick 'c', because its
    // job here is maximising coverage among what's hard-feasible, not
    // maximising the objective the floor already vetoed.
    const ms = [
      market('a', { cash: 6_000_000_000n }),
      market('c', { cash: 6_500_000_000n }),
    ];
    const curves = [
      curve('a', Array(11).fill(WAD / 10n)),  // 10% -- the better rate
      curve('c', Array(11).fill(WAD / 100n)), // 1%  -- the worse rate
    ];
    const opts = { ...OPTS, quantumBase: Q_BIG };

    // Verify the fixture is actually drier than the floor at every
    // allocation before trusting anything the fallback does with it: BOTH
    // single-quantum candidates must score below the 0.99 floor, or this
    // test would not be exercising the fallback at all.
    const onlyA = new Map([['a', Q_BIG], ['c', 0n]]);
    const onlyC = new Map([['a', 0n], ['c', Q_BIG]]);
    const covA = covOf(onlyA, ms);
    const covC = covOf(onlyC, ms);
    expect(covA).toBeLessThan(0.99);
    expect(covC).toBeLessThan(0.99);
    // ...and 'c' really is the higher-coverage (but lower-rate) option, so a
    // correct answer is distinguishable from an objective-only one.
    expect(covC).toBeGreaterThan(covA);

    const out = optimize(input(ms), curves, artifact(), opts);

    // Refusing to act is the one thing the fallback exists to avoid.
    const deployed = [...out.target.values()].reduce((s, v) => s + v, 0n);
    expect(deployed).toBeGreaterThan(0n);

    // It must be the HIGHER-coverage candidate ('c'), not the
    // higher-objective one ('a').
    expect(out.target.get('c') ?? 0n).toBe(Q_BIG);
    expect(out.target.get('a') ?? 0n).toBe(0n);
    expect(covOf(out.target, ms)).toBeCloseTo(covC, 9);

    // No other reachable (hard-feasible, single-quantum) candidate scores
    // strictly higher than what was returned.
    expect(covA).toBeLessThanOrEqual(covOf(out.target, ms));
  });

  it('never returns a target that violates a HARD constraint to raise coverage', () => {
    // Same shape as above, but this time 'b' -- the venue that WOULD have
    // given the best coverage (0.90, same arithmetic as 'c' above) -- sits
    // in a dependency group capped at 3,000 USDC, half its cash and well
    // under the one quantum (6,000) this universe allocates in. A fallback
    // that only relaxed the coverage floor (and nothing else) would still
    // reject 'b': the group cap is a GUARDRAIL, not a preference, and it
    // must keep binding even while the floor itself is being ignored.
    const ms = [
      market('a', { cash: 6_000_000_000n }),
      market('b', { cash: 6_500_000_000n }),
    ];
    const curves = [
      curve('a', Array(11).fill(WAD / 20n)),
      curve('b', Array(11).fill(WAD / 10n)), // higher rate too, not just higher coverage
    ];
    const groups = [
      { id: 'g1', capBps: 10_000, absoluteCapBase: 3_000_000_000n, members: ['b'] },
    ];
    const opts = { ...OPTS, quantumBase: Q_BIG };
    const inp: DecisionInput = { ...input(ms), dependencyGroups: groups };

    // Precondition: neither single-quantum candidate clears the floor, and
    // 'b' (if the group cap did not exist) would outscore 'a' on coverage --
    // so a fallback that ignored the group cap would have every incentive to
    // pick it instead of 'a'.
    const onlyA = new Map([['a', Q_BIG], ['b', 0n]]);
    const onlyB = new Map([['a', 0n], ['b', Q_BIG]]);
    expect(covOf(onlyA, ms)).toBeLessThan(0.99);
    expect(covOf(onlyB, ms)).toBeLessThan(0.99);
    expect(covOf(onlyB, ms)).toBeGreaterThan(covOf(onlyA, ms));

    const out = optimize(inp, curves, artifact(), opts);

    // The group cap must still bind: 'b' can never carry more than its
    // 3,000 USDC group cap, and in this single-quantum universe that means
    // it can never carry the quantum at all.
    expect(out.target.get('b') ?? 0n).toBeLessThanOrEqual(3_000_000_000n);
    expect(out.target.get('b') ?? 0n).toBe(0n);

    // The fallback still deploys -- into the only hard-feasible venue.
    expect(out.target.get('a') ?? 0n).toBe(Q_BIG);
  });

  it('does not freeze on the first candidate on a coverage tie -- a later, equally-good one may still displace it', () => {
    // `liquid = idle + min(balance, venueCash - balance)`, so on a coverage
    // TIE (two candidates scoring identically -- the flat part of the
    // liquid-vs-deployment curve, not just a coincidence) a STRICT `>`
    // comparison keeps whichever candidate the search reaches FIRST and
    // never lets an equally-good later one take over. That is the bug: the
    // fallback exists to find the least-infeasible candidate, and freezing
    // on "first found" rather than continuing to consider ties is an
    // arbitrary artifact of sort order, not a reasoned choice among equals.
    // `>=` fixes this by letting a later tie keep displacing the incumbent.
    //
    // Two markets with IDENTICAL cash (6,000 USDC, matching the one
    // deployable quantum exactly) score IDENTICAL coverage (0.80) whichever
    // one receives it -- a genuine tie, not an approximation.
    const ms = [
      market('a', { cash: 6_000_000_000n }),
      market('e', { cash: 6_000_000_000n }),
    ];
    const curves = [
      curve('a', Array(11).fill(WAD / 20n)),
      curve('e', Array(11).fill(WAD / 20n)),
    ];
    const opts = { ...OPTS, quantumBase: Q_BIG };

    const onlyA = new Map([['a', Q_BIG], ['e', 0n]]);
    const onlyE = new Map([['a', 0n], ['e', Q_BIG]]);
    expect(covOf(onlyA, ms)).toBeLessThan(0.99);
    // Precondition: this really is an exact tie, not merely "close".
    expect(covOf(onlyE, ms)).toBe(covOf(onlyA, ms));

    const out = optimize(input(ms), curves, artifact(), opts);

    // 'e' sorts AFTER 'a', so it is the later candidate evaluated at the
    // tie. Under `>` the search would freeze on 'a' (evaluated first);
    // under `>=` 'e' displaces it.
    expect(out.target.get('e') ?? 0n).toBe(Q_BIG);
    expect(out.target.get('a') ?? 0n).toBe(0n);
  });
});
