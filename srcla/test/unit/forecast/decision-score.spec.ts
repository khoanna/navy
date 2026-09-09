/**
 * P18/Task 7 — §7.3's two decision-focused loss terms.
 *
 * The fixtures below are the `decide.spec.ts` rebalance fixture, which is
 * already tuned so a genuinely profitable deployment of the whole vault
 * clears every gate. Three artifacts differentiate the behaviours the two
 * terms have to be able to SEE:
 *
 *  - `artifactThatTrades`  — conservative bound at the observed rate, a
 *    30-day payback: both venues' deploy legs clear.
 *  - `artifactThatNeverTrades` — the same artifact with a 60-second payback,
 *    which is what a movement cost has to repay itself within. The amortised
 *    cost hurdle is then ~43000x larger and no leg can clear, so the run
 *    holds at every origin and every positive bound is booked as sacrificed.
 *  - `artifactThatChurns` — both venues admissible at a near-zero bound, so
 *    the optimiser spreads across both and both legs clear. `steady` puts a
 *    deep residual quantile on 'bb', so 'bb' contributes neither allocation
 *    nor a cleared leg and strictly less notional moves.
 */
import { DEFAULT_DECIDE_OPTS } from '../../../src/policy/decide.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { scoreCandidateDecisions } from '../../../src/forecast/decision-score.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id,
    adapter: `0x${id.padEnd(40, '0')}`,
    protocol: 'compound',
    cash: 10n ** 12n,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: (WAD * 3n) / 100n,
    utilizationWad: 0n,
    positionBase: 0n,
    maxDeployableBase: 10n ** 12n,
    maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd',
    regimeId: 'r1',
    paused: false,
    // Half the vault per venue, so "how many venues cleared" is visible in
    // the notional: with 'bb' priced out, only 50% of NAV can be deployed.
    capBps: 5000,
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

/** Twelve origins an hour apart. Positions stay flat: the fixture varies the
 *  ARTIFACT, which is what the selection loss varies. */
function origins(): DecisionInput[] {
  return Array.from({ length: 12 }, (_unused, i) => ({
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
    markets: [market('aa'), market('bb')],
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

const artifactThatTrades = (): PolicyArtifact => baseArtifact();

/** A payback period a movement cost cannot repay itself within. */
const artifactThatNeverTrades = (): PolicyArtifact => ({ ...baseArtifact(), paybackSeconds: 60 });

const artifactThatChurns = (): PolicyArtifact => baseArtifact();

/** 'bb' priced at a bound so deep it is never worth entering. */
const artifactThatIsSteady = (): PolicyArtifact => ({
  ...baseArtifact(),
  residualQuantileWadByMarket: { aa: 0n, bb: -WAD },
});

const opts = () => ({
  ...DEFAULT_DECIDE_OPTS,
  cost: {
    ...DEFAULT_DECIDE_OPTS.cost,
    minTurnoverBps: 1,
    maxTurnoverBps: 10000,
    slippageBps: 0,
    mevBps: 0,
    impactBps: 0,
  },
});

describe('P18: decision-focused loss terms', () => {
  it('a candidate whose hurdle never opens scores maximal sacrificed return', () => {
    const blocked = scoreCandidateDecisions(origins(), artifactThatNeverTrades(), opts(), { everyNth: 1 });
    const trading = scoreCandidateDecisions(origins(), artifactThatTrades(), opts(), { everyNth: 1 });
    expect(blocked.rebalances).toBe(0);
    expect(trading.rebalances).toBeGreaterThan(0);
    expect(blocked.sacrificedReturn).toBeGreaterThan(trading.sacrificedReturn);
  });

  it('a candidate that churns scores high turnover', () => {
    const churn = scoreCandidateDecisions(origins(), artifactThatChurns(), opts(), { everyNth: 1 });
    const steady = scoreCandidateDecisions(origins(), artifactThatIsSteady(), opts(), { everyNth: 1 });
    expect(churn.turnover).toBeGreaterThan(steady.turnover);
  });

  /**
   * A blocked leg whose conservative bound is NEGATIVE forgoes nothing:
   * refusing it is the hurdle working. Summed signed, the term would be
   * minimised by the candidate least able to trade — and `LOSS_WEIGHTS` puts
   * a weight of 3.0 behind "lower is better", so an unclamped version would
   * actively select for the over-conservatism P18 exists to detect. On the
   * real calibration grid this is not hypothetical: at a 1-day horizon the
   * annualised residual quantile alone is around -18%.
   */
  it('never books a NEGATIVE bound as a sacrifice', () => {
    for (const a of [
      artifactThatTrades(),
      artifactThatNeverTrades(),
      artifactThatIsSteady(),
      { ...baseArtifact(), residualQuantileWadByMarket: { aa: -WAD, bb: -WAD } },
    ]) {
      const score = scoreCandidateDecisions(origins(), a, opts(), { everyNth: 1 });
      expect(score.sacrificedReturn).toBeGreaterThanOrEqual(0);
    }
  });

  it('the subsample rule is deterministic and reported', () => {
    const a = scoreCandidateDecisions(origins(), artifactThatTrades(), opts(), { everyNth: 4 });
    const b = scoreCandidateDecisions(origins(), artifactThatTrades(), opts(), { everyNth: 4 });
    expect(a).toEqual(b);
    expect(a.originsScored).toBeLessThan(origins().length);
    expect(a.originsScored).toBe(3);
  });
});
