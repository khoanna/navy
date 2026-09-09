/**
 * P18/Task 7 — §7.3's two decision-focused loss terms, over a SEQUENTIAL
 * replay.
 *
 * The world these fixtures present is 24 hourly origins over two venues whose
 * supply rates ALTERNATE leadership every origin ('aa' leads on even origins,
 * 'bb' on odd). That oscillation is what makes churn expressible at all: with
 * a frozen cold-start state — the defect this replay replaces — `current` is
 * empty at every origin, only deploy legs can ever be emitted, and no capital
 * is ever moved twice.
 *
 * Four artifacts, each isolating one behaviour the terms must be able to see:
 *
 *  - `artifactThatChurns`    — a shallow bound at both venues, so the
 *    optimiser chases the leader and rotates the book every origin.
 *  - `artifactThatIsSteady`  — 'bb' priced at a bound so deep it is never
 *    worth entering, so the vault deploys into 'aa' once and holds.
 *  - `artifactThatNeverTrades` — a 60-second payback period, so the amortised
 *    movement cost hurdle is ~43,000x larger and no leg can clear. It holds
 *    from a standing start and earns nothing.
 *  - `artifactThatAdmitsNothing` — the C2 pathology. Its pinned config digests
 *    match no venue, so `admit` rejects the whole universe and `decide`
 *    returns before the cost gate with `legs: []`. Under the old
 *    edge-on-blocked-legs definition of the second term this scored
 *    `turnover = 0` and `sacrificedReturn = 0` — both BEST attainable — so the
 *    amendment written to catch "this forecast leaves the movement rule unable
 *    to trade" ranked it FIRST. It must now rank LAST.
 */
import { DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import {
  bestNetReturn,
  sacrificedReturn,
  scoreCandidateDecisions,
  type DecisionScore,
} from '../../../src/forecast/decision-score.js';
import {
  attachDecisionTerms,
  scoreGrid,
  LOSS_WEIGHTS,
  MIN_DISCRIMINATING_IQR,
  type FitPoint,
  type GridPoint,
} from '../../../src/forecast/grid-sweep.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const HIGH = (WAD * 6n) / 100n;
const LOW = (WAD * 3n) / 100n;

/**
 * LEADERSHIP IS EXPRESSED IN UTILISATION, NOT IN THE DISPLAYED RATE.
 * `simulate.ts` seeds only `points[0]` from `supplyRateWad` and derives every
 * other point from real IRM math over `cash`/`borrows`, so two venues with
 * identical cash and borrows produce identical curves however their displayed
 * rates differ — and the optimiser, which reads the curve, would see no
 * reason to rotate. The leader therefore runs at 75% utilisation on
 * Compound's kinked model and the laggard at zero.
 */
function market(id: string, leads: boolean, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id,
    adapter: `0x${id.padEnd(40, '0')}`,
    protocol: 'compound',
    cash: leads ? 2_000_000_000_000n : 10n ** 12n,
    borrows: leads ? 6_000_000_000_000n : 0n,
    reserves: 0n,
    supplyRateWad: leads ? HIGH : LOW,
    utilizationWad: leads ? (WAD * 75n) / 100n : 0n,
    positionBase: 0n,
    maxDeployableBase: 10n ** 13n,
    maxWithdrawableBase: leads ? 2_000_000_000_000n : 10n ** 12n,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    capBps: 10000,
    absoluteCapBase: 10n ** 13n,
    maxLossBps: 50,
    dependencyGroupIds: [],
    ...over,
  };
}

function history(marketId: string) {
  return Array.from({ length: 40 }, () => ({
    marketId,
    regimeId: 'r1',
    originSeconds: 1,
    horizonSeconds: 604_800 as const,
    horizonEndSeconds: 2,
    availableAtSeconds: 3,
    realizedReturnWad: WAD / 100n,
    realizedMinCashBase: 1n,
    originCashBase: 1n,
  }));
}

/** 24 hourly origins with alternating venue leadership. */
function origins(): DecisionInput[] {
  return Array.from({ length: 24 }, (_unused, i) => ({
    origin: {
      blockNumber: 1000 + i,
      blockHash: '0x' + 'ab'.repeat(32),
      timestampSeconds: 1_000_000 + i * 3600,
      finalized: true as const,
    },
    vault: {
      totalAssetsBase: 10_000_000_000n,
      idleBase: 10_000_000_000n,
      sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n,
      dynamicReserveBase: 0n,
      minIdleBps: 0,
      paused: false,
      configurationDigest: '0x' + 'cd'.repeat(32),
    },
    markets: [
      market('aa', i % 2 === 0),
      market('bb', i % 2 !== 0),
    ],
    dependencyGroups: [],
    withdrawals: [],
    gas: {
      l2BaseFeeWei: 5_000_000n,
      l1BaseFeeWei: 8_000_000_000n,
      l1BlobBaseFeeWei: 1n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    history: [...history('aa'), ...history('bb')],
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  }));
}

function baseArtifact(): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    residualQuantileWadByMarket: { aa: 0n, bb: 0n },
    pinnedConfigDigests: { aa: '0xd', bb: '0xd' },
    portfolioResidualQuantileWad: -1_000_000n,
    cashResidualQuantileWadByMarket: {},
    cashLowerBoundQuantileWad: 0n,
    noTradeBandK: 0,
    paybackSeconds: 30 * 86_400,
  };
}

const artifactThatChurns = (): PolicyArtifact => baseArtifact();

/** 'bb' priced at a bound so deep it is never worth entering. */
const artifactThatIsSteady = (): PolicyArtifact => ({
  ...baseArtifact(),
  residualQuantileWadByMarket: { aa: 0n, bb: -WAD },
});

/** A payback period a movement cost cannot repay itself within. */
const artifactThatNeverTrades = (): PolicyArtifact => ({ ...baseArtifact(), paybackSeconds: 60 });

/** C2: pins that match no venue, so `admit` empties the universe. */
const artifactThatAdmitsNothing = (): PolicyArtifact => ({
  ...baseArtifact(),
  pinnedConfigDigests: { aa: '0xdeadbeef', bb: '0xdeadbeef' },
});

const opts = () => ({
  ...DEFAULT_DECIDE_OPTS,
  cost: {
    ...DEFAULT_DECIDE_OPTS.cost,
    // §9.1's aggregate brakes are deliberately slackened here so the ROTATION
    // behaviour is what the fixture measures. At the defaults a book that
    // rotates fully every hour exhausts the 100%-of-TVL daily turnover window
    // after the first move, and every candidate then reports the same
    // turnover — the brake, not the forecast, would be what the test sees.
    cooldownSeconds: 0,
    minTurnoverBps: 1,
    maxTurnoverBps: 10_000_000,
    reversalAllowanceBps: 10_000_000,
    slippageBps: 0,
    mevBps: 0,
    impactBps: 0,
  },
});

const score = (a: PolicyArtifact, everyNth = 1): DecisionScore =>
  scoreCandidateDecisions(origins(), a, opts(), { everyNth });

describe('P18: decision-focused loss terms', () => {
  it('is a SEQUENTIAL replay: capital deployed once stays deployed and earns', () => {
    const steady = score(artifactThatIsSteady());
    expect(steady.rebalances).toBeGreaterThan(0);
    // A cold start at every origin would re-deploy the whole book every time,
    // so turnover would be ~1 per rebalancing origin. Holding a position
    // means far less than that moves.
    expect(steady.turnover).toBeLessThan(steady.rebalances);
    // And the position accrued: net return is positive, which is only
    // possible if a position survived from one origin to the next.
    expect(steady.realizedNetReturn).toBeGreaterThan(0);
  });

  it('a candidate that chases the leader scores higher turnover than one that holds', () => {
    expect(score(artifactThatChurns()).turnover).toBeGreaterThan(
      score(artifactThatIsSteady()).turnover,
    );
  });

  it('a candidate whose hurdle never opens earns nothing and sacrifices the most', () => {
    const blocked = score(artifactThatNeverTrades());
    const trading = score(artifactThatIsSteady());
    const best = bestNetReturn([blocked, trading]);
    expect(blocked.rebalances).toBe(0);
    expect(blocked.realizedNetReturn).toBe(0);
    expect(sacrificedReturn(blocked, best)).toBeGreaterThan(sacrificedReturn(trading, best));
  });

  /**
   * C2, the regression this whole redefinition exists for. The pathological
   * candidate is BEST on turnover (it moves nothing) and would have been
   * tied-best on the old edge-on-blocked-legs second term (it has no blocked
   * legs to accumulate an edge over, because it never reaches the cost gate).
   * Under the realised-return shortfall it must come LAST.
   */
  it('C2: a candidate that admits NOTHING ranks last on the economic terms, not first', () => {
    const dead = score(artifactThatAdmitsNothing());
    const steady = score(artifactThatIsSteady());
    const churn = score(artifactThatChurns());

    // The trap: on the terms that used to decide, the dead candidate wins.
    expect(dead.rebalances).toBe(0);
    expect(dead.turnover).toBe(0);
    expect(dead.turnover).toBeLessThan(steady.turnover);

    const scores = [dead, steady, churn];
    const best = bestNetReturn(scores);
    const point = (id: string): GridPoint => ({
      method: 'rolling',
      methodParams: { windowObservations: 24 },
      horizonSeconds: 604_800,
      coverageTarget: 0.95,
      ...({ id } as unknown as object),
    });
    const fit = (s: DecisionScore): FitPoint =>
      attachDecisionTerms(
        {
          quantileWadByMarket: {},
          coverageByMarket: {},
          loss: {
            pointError: 0, coverageDeviation: 0, exceedanceShortfall: 0, sharpness: 0,
            downsideRate: 0, turnover: 0, sacrificedReturn: 0, total: 0,
            observations: 100, achievedCoverage: 0.95,
          },
        },
        { turnover: s.turnover, sacrificedReturn: sacrificedReturn(s, best) },
      );

    const scored = scoreGrid(
      [
        { point: point('dead'), fit: fit(dead) },
        { point: point('steady'), fit: fit(steady) },
        { point: point('churn'), fit: fit(churn) },
      ],
      { minIqr: MIN_DISCRIMINATING_IQR },
    );
    const econ = (i: number): number =>
      scored[i]!.normalized['turnover']! * LOSS_WEIGHTS.turnover +
      scored[i]!.normalized['sacrificedReturn']! * LOSS_WEIGHTS.sacrificedReturn;

    // Lower is better, and `scoreGrid` sorts ascending, so the dead candidate
    // must be the LAST entry and carry the WORST economic total.
    const deadIndex = scored.findIndex((sp) => sp.fit.loss.turnover === 0);
    expect(deadIndex).toBe(scored.length - 1);
    expect(econ(deadIndex)).toBeGreaterThan(econ(0));
  });

  it('the subsample rule is deterministic and reported', () => {
    const a = score(artifactThatIsSteady(), 4);
    const b = score(artifactThatIsSteady(), 4);
    expect(a).toEqual(b);
    expect(a.originsScored).toBeLessThan(origins().length);
    expect(a.originsScored).toBe(6);
  });
});
