/**
 * §7.3's two decision-focused loss terms, computed by running the REGISTERED
 * DECISION RULE over the calibration era under a candidate artifact.
 *
 * This is what couples the forecast to its consumer. v0.6 selected a horizon
 * on forecast accuracy alone and the winning horizon left the movement rule
 * unable to act; no accuracy statistic can see that. §7.3 has always named
 * seven terms and the implementation carried five, so the two that price the
 * consequence of a forecast were structurally absent from the selection.
 *
 * THIS IS A SEQUENTIAL REPLAY, AND THAT IS LOAD-BEARING.
 *
 * The first version of this module handed `decide` the SAME frozen vault
 * state at every origin: `totalAssets = idle`, no positions, and a neutral
 * `lastAction`. `decide` is pure, so 886 origins were 886 independent COLD
 * STARTS rather than a trajectory. Three things followed, and each one
 * inverted the term it was supposed to measure:
 *
 *   C1  From a cold start the moved notional IS the deployed capital, so
 *       `turnover` measured DEPLOYED FRACTION -- and `LOSS_WEIGHTS` treats
 *       lower as better, so the term rewarded putting LESS capital to work.
 *       Every one of the 81 registered candidates sat between 0.4457 and
 *       0.4986 of NAV per rebalancing origin, pinned against the 50%
 *       `maxTurnoverBps` brake, with a 0.980 correlation to the rebalance
 *       count and identical values across all nine methods in seven of the
 *       nine (horizon, coverage) buckets. It carried almost no forecast
 *       information.
 *   C2  `current` was empty at every origin, so `planLegs` could only ever
 *       emit DEPLOY legs. Nothing rotated, nothing round-tripped, and no
 *       capital was ever moved twice -- the churn the term exists to price
 *       could not occur.
 *   C3  A candidate too conservative to admit anything booked `turnover = 0`
 *       (the best attainable value) and, under the old edge-on-blocked-legs
 *       definition of the second term, `sacrificedReturn = 0` (tied best).
 *       The amendment written to catch "this forecast leaves the movement
 *       rule unable to trade" would have RANKED THAT CANDIDATE FIRST.
 *
 * So the replay below threads the vault forward: the executed target becomes
 * the next origin's position, positions accrue at each venue's observed
 * supply rate over the elapsed interval, movement cost is charged against
 * idle, and `lastAction` is reduced from the run's own action history through
 * the same `summariseLastAction` the live driver uses.
 *
 * THE §9.1 BRAKES ARE STILL LOOSER HERE THAN IN PRODUCTION, and the cause is
 * the stride, not the reduction. Origins are hourly and the registered stride
 * is 12, so scored origins sit 12 h apart while `DEFAULT_DECIDE_OPTS.cost`
 * sets `cooldownSeconds: 3600` and 86,400 s turnover/reversal windows. The
 * cooldown therefore can NEVER bind in the scorer, and the 24 h windows hold
 * at most 2 decisions where production would see 24. Measured `turnover` is
 * consequently an UPPER-BIASED proxy: the aggregate brakes that would trim a
 * thrashing candidate are materially weaker here than they would be live.
 * This remains a large improvement on the permanently-neutral `lastAction` it
 * replaces — the rolling window and the reversal allowance do bind across
 * consecutive scored origins — but it is not the production envelope, and a
 * report must not claim the brakes "see real history" without this caveat.
 *
 * DETERMINISTIC: the subsample is every Nth origin in time order, never a
 * random draw, and `everyNth` is recorded in the artifact's registration.
 *
 * PURE: no I/O, no Date.now(), no randomness. `decide` is itself pure, so two
 * runs over the same origins under the same artifact return identical scores.
 */
import { decide } from '../policy/decide.js';
import type { DecideOpts } from '../policy/decide.js';
import { summariseLastAction, type PersistedActionRecord } from '../policy/last-action.js';
import { movementCostBase, type Move } from '../policy/steps/cost.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../policy/types.js';

const WAD = 10n ** 18n;
const SECONDS_PER_YEAR = 31_557_600n;

export interface DecisionScore {
  /**
   * §7.3's sixth term: ROUND-TRIP CHURN. Notional moved as a multiple of the
   * NAV at each origin, summed over every scored origin.
   *
   * DOUBLE-SIDED. It sums `|delta|` PER VENUE, so a rotation of X out of one
   * venue and into another books 2X, and a reported figure of "20x NAV" is
   * ~10x NAV of round trips. That convention matches `notionalBase` and
   * §9.1's turnover brakes, and it is scale-invariant across candidates, so
   * the ranking is unaffected -- but any prose quoting the number has to say
   * which side it counts.
   *
   * Meaningful only because the replay is sequential: capital deployed at one
   * origin and pulled back at the next is counted twice, which is what makes
   * "lower is better" the correct direction. Comparable across candidates
   * only at a fixed `originsScored`, which the grid holds constant.
   *
   * It is also the ONLY term in the loss that prices churn at all. §9.1's
   * claim that execution cost does not capture reversal risk is validated
   * rather than merely asserted here: the movement cost this replay charges
   * is ~$0.01 for a two-leg rotation at the dataset's own median gas and ETH
   * price, about 1e-4 pp of APY -- four orders of magnitude below the 0.75 pp
   * of realised return the registered winner trades away to churn less. If
   * `turnover` carried no weight, nothing would restrain churn.
   */
  turnover: number;
  /**
   * The candidate's realised net return over the scored era, ANNUALISED:
   * terminal NAV against initial NAV, with venue interest accrued at each
   * venue's observed supply rate and every executed move charged its §9.1
   * movement cost.
   *
   * NOT COMPARABLE TO A §11 REPLAY NUMBER, for two reasons that both need
   * saying wherever this is quoted:
   *
   *  1. Interest is accrued at the rate observed at the START of each
   *     interval; the §11 replay credits the interval's END snapshot. The
   *     start rate is the causal choice here (the end rate is not knowable
   *     while the interval is being earned) but it is a different estimator.
   *  2. The credited rate is the venue's DISPLAYED rate, with no post-deposit
   *     capacity curve applied. A candidate that deploys size into a venue is
   *     therefore credited a rate its own deposit would have depressed, so
   *     this ledger UNDER-PRICES churn: the returns side is flattered for the
   *     candidates that move most, which biases `sacrificedReturn` against
   *     the low-churn candidates the loss ends up choosing. The bias runs
   *     opposite to the selection, not toward it.
   *
   * §7.3's seventh term is derived FROM this, not stored here, because it is
   * grid-relative -- see `sacrificedReturn`.
   */
  realizedNetReturn: number;
  /**
   * DIAGNOSTIC, NOT A LOSS TERM. §7.3's letter asks the decision terms to
   * score "the realized net return, the realized turnover, and the return
   * foregone by every hurdle rejection". This is that third quantity: the
   * mean per-origin annualised conservative bound of the legs the hurdle
   * REFUSED, as a fraction of NAV, clamped at a non-negative edge (a blocked
   * leg whose bound is negative forgoes nothing -- refusing it is the hurdle
   * working).
   *
   * It was P18's first definition of `sacrificedReturn` and it is NOT used as
   * that term, because it is blind to the failure the term exists to detect:
   * a candidate whose forecast admits no venue never reaches the cost gate,
   * has no blocked legs, and scores this at its BEST value. `sacrificedReturn`
   * below is the realised-return shortfall instead. But the paper asks for the
   * quantity to be SCORED, so it is measured and reported rather than deleted
   * along with the definition that used it.
   */
  foregoneEdge: number;
  /** Origins at which `decide` returned `action: 'rebalance'`. */
  rebalances: number;
  /** Origins actually visited, i.e. after the stride. */
  originsScored: number;
}

/**
 * §7.3's seventh term: RETURN SACRIFICED, as a shortfall against the best
 * realised net return anywhere on the grid.
 *
 * WHY NOT "the edge on blocked legs". That was this module's first
 * definition and it cannot see the failure it exists to detect. A forecast
 * so conservative that `admit` rejects every venue, or one whose reserve
 * demand leaves nothing deployable, never reaches the cost gate at all:
 * `decide` returns with `legs: []` (the `ADMISSION_EMPTY` and
 * `SAFETY_UNWIND_BYPASS` paths both do), so there are no blocked legs to
 * accumulate an edge over and the term reads zero -- its BEST value. The
 * v0.6 failure lives strictly upstream of the cost gate, which is precisely
 * where a leg-level statistic is blind.
 *
 * A realised-return shortfall has no such blind spot: a candidate that never
 * deploys earns nothing, and therefore sacrifices everything the grid showed
 * was attainable. Lower is better, matching every other term in
 * `SelectionLoss`.
 *
 * WHY THE REFERENCE IS THE GRID'S OWN BEST. A within-grid relative measure
 * needs no new registration (an absolute benchmark would be one more number
 * fitted on calibration data), it is invariant to anything that shifts every
 * candidate equally, and it cannot be gamed by a candidate that simply
 * refuses to act. The best candidate scores exactly 0; everything else scores
 * the return it gave up relative to what this grid demonstrably could reach.
 */
export function sacrificedReturn(score: DecisionScore, gridBestNetReturn: number): number {
  return gridBestNetReturn - score.realizedNetReturn;
}

/** The reference `sacrificedReturn` is measured against. */
export function bestNetReturn(scores: readonly DecisionScore[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((a, s) => (s.realizedNetReturn > a ? s.realizedNetReturn : a), -Infinity);
}

export function scoreCandidateDecisions(
  origins: readonly DecisionInput[],
  artifact: PolicyArtifact,
  opts: DecideOpts,
  subsample: { everyNth: number },
): DecisionScore {
  const n = Math.max(1, Math.round(subsample.everyNth));

  const first = origins[0];
  if (first === undefined) {
    return { turnover: 0, realizedNetReturn: 0, foregoneEdge: 0, rebalances: 0, originsScored: 0 };
  }

  // The replay's own state. `origins` supplies the MARKET observations
  // (rates, cash, digests, labels) and is shared unchanged by every
  // candidate; the vault half is overlaid from here, so two candidates see
  // the same world and their own trajectory through it.
  const initialNav = first.vault.totalAssetsBase;
  let idleBase = initialNav;
  const positions = new Map<string, bigint>();
  const actionHistory: PersistedActionRecord[] = [];

  // Each venue's most recently observed annual supply rate, used to accrue
  // that venue's position over the interval that ENDS at the next origin.
  // Reading the rate at the START of the interval is the causal choice: the
  // next origin's rate is not knowable while the interval is being earned.
  const lastRateWad = new Map<string, bigint>();
  let lastSeconds = first.origin.timestampSeconds;

  let turnover = 0;
  let foregone = 0;
  let rebalances = 0;
  let scored = 0;

  for (let i = 0; i < origins.length; i += n) {
    const base = origins[i]!;
    const originSeconds = base.origin.timestampSeconds;

    // ---- Accrue since the previous scored origin.
    const elapsed = BigInt(Math.max(0, originSeconds - lastSeconds));
    if (elapsed > 0n) {
      for (const [marketId, position] of positions) {
        if (position <= 0n) continue;
        const rate = lastRateWad.get(marketId) ?? 0n;
        if (rate <= 0n) continue;
        positions.set(marketId, position + (position * rate * elapsed) / (WAD * SECONDS_PER_YEAR));
      }
    }
    lastSeconds = originSeconds;
    for (const m of base.markets) lastRateWad.set(m.marketId, m.supplyRateWad);

    let deployed = 0n;
    for (const v of positions.values()) deployed += v;
    const totalAssetsBase = idleBase + deployed;

    const markets: MarketObservation[] = base.markets.map((m) => ({
      ...m,
      positionBase: positions.get(m.marketId) ?? 0n,
    }));

    const input: DecisionInput = {
      ...base,
      vault: { ...base.vault, totalAssetsBase, idleBase },
      markets,
      lastAction: summariseLastAction(actionHistory, originSeconds, {
        turnoverWindowSeconds: opts.cost.turnoverWindowSeconds,
        reversalWindowSeconds: opts.cost.reversalWindowSeconds,
      }),
    };

    const out = decide(input, artifact, opts);
    scored += 1;

    const nav = Number(totalAssetsBase);
    if (nav <= 0) continue;

    // §7.3's third named quantity, reported as a diagnostic. See
    // `DecisionScore.foregoneEdge` for why it is not the loss term.
    for (const leg of out.costGate.legs) {
      if (leg.clears) continue;
      const edge = Number(leg.edgeWad) / 1e18;
      if (edge <= 0) continue;
      foregone += edge * (Number(leg.amountBase) / nav);
    }

    if (out.action !== 'rebalance') continue;

    // ---- Apply the executed target.
    const moves: Move[] = [];
    const signed: Array<{ marketId: string; deltaBase: bigint }> = [];
    let movedBase = 0n;
    const ids = [...new Set([...positions.keys(), ...out.target.keys()])].sort();
    for (const id of ids) {
      const before = positions.get(id) ?? 0n;
      const after = out.target.get(id) ?? before;
      const delta = after - before;
      if (delta === 0n) continue;
      positions.set(id, after);
      idleBase -= delta;
      movedBase += delta < 0n ? -delta : delta;
      signed.push({ marketId: id, deltaBase: delta });
      moves.push({
        adapter: id,
        amountBase: delta < 0n ? -delta : delta,
        kind: delta > 0n ? 'deploy' : 'divest',
      });
    }
    if (moves.length === 0) continue;

    rebalances += 1;
    turnover += Number(movedBase) / nav;
    // §9.1's movement cost is REAL money and comes out of idle, so a
    // candidate that churns pays for it in `realizedNetReturn` as well as
    // booking it in `turnover`. Charged through the same `movementCostBase`
    // the hurdles price against, so the cost a candidate is scored on is the
    // cost it was gated on.
    idleBase -= movementCostBase(input, moves, opts.cost).totalBase;
    actionHistory.push({ timestampSeconds: originSeconds, isAction: true, moves: signed });
  }

  // ---- Accrue the tail, so a candidate is credited for what it was holding
  //      at the last scored origin rather than being cut off at it.
  const lastOrigin = origins[origins.length - 1]!;
  const tail = BigInt(Math.max(0, lastOrigin.origin.timestampSeconds - lastSeconds));
  if (tail > 0n) {
    for (const [marketId, position] of positions) {
      if (position <= 0n) continue;
      const rate = lastRateWad.get(marketId) ?? 0n;
      if (rate <= 0n) continue;
      positions.set(marketId, position + (position * rate * tail) / (WAD * SECONDS_PER_YEAR));
    }
  }

  let finalDeployed = 0n;
  for (const v of positions.values()) finalDeployed += v;
  const finalNav = idleBase + finalDeployed;

  const eraSeconds = lastOrigin.origin.timestampSeconds - first.origin.timestampSeconds;
  const realizedNetReturn =
    initialNav <= 0n || eraSeconds <= 0
      ? 0
      : ((Number(finalNav) / Number(initialNav) - 1) * Number(SECONDS_PER_YEAR)) / eraSeconds;

  return {
    turnover,
    realizedNetReturn,
    foregoneEdge: scored === 0 ? 0 : foregone / scored,
    rebalances,
    originsScored: scored,
  };
}
