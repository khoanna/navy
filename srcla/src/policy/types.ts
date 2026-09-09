import type { HorizonSeconds, CoverageTarget, ForecastMethod } from './registered.js';
import type { LegVerdict } from './steps/hurdles.js';

/** Raw protocol state at one finalised origin, in native integer units. */
export interface MarketObservation {
  marketId: string;
  adapter: string;
  protocol: 'aave' | 'compound' | 'moonwell';
  cash: bigint;
  borrows: bigint;
  reserves: bigint;
  supplyRateWad: bigint;
  utilizationWad: bigint;
  /** Vault position currently held in this venue. */
  positionBase: bigint;
  /** Live protocol headroom: max additional assets deployable. */
  maxDeployableBase: bigint;
  /**
   * The venue's synchronous exit CAPACITY at this origin — how much the vault
   * could pull out in one transaction if it wanted to — in USDC base units.
   *
   * NOT `min(position, cash)`. Both consumers evaluate this against a
   * CANDIDATE allocation x, never against the current position:
   *   - optimize.ts's P4 weighting, `exitableFraction(x, maxWithdrawableBase)`
   *   - reserve.ts's e_i^cons, `min(x_i, maxWithdrawableBase)`
   * A value frozen at the current position's exit is identically 0 for a
   * venue the vault has not entered yet, and `exitableFraction(x, 0) = 0`
   * zeroes the objective for every positive candidate — so the optimiser can
   * never make a first deployment into an empty venue, a cold-start deadlock
   * with no error. (`admit.ts`'s NO_SYNC_LIQUIDITY rule already special-cases
   * the zero-position branch for the same reason.)
   *
   * The right quantity is the protocol's available cash, which is the
   * `availableInComet`/equivalent term the on-chain adapters' own
   * `maxWithdrawable()` mins against.
   */
  maxWithdrawableBase: bigint;
  configDigest: string;
  regimeId: string;
  paused: boolean;
  capBps: number;
  absoluteCapBase: bigint;
  maxLossBps: number;
  dependencyGroupIds: string[];
  /**
   * Live on-chain IRM parameters. Falls back to DefaultConfigs when absent.
   *
   * Paper §6.3-6.5 requires simulation to mirror the LIVE registered
   * interest-rate strategy, not a hardcoded default — this is that seam.
   * Shape matches the kinked-linear model (Compound/Moonwell); Aave's
   * quadratic model has no equivalent field here and always uses
   * DefaultConfigs.aave regardless of this value.
   *
   * NOT YET POPULATED from chain — the collector that reads live IRM params
   * off each venue's rate strategy contract is a later task. Until then this
   * is always undefined and every market falls back to DefaultConfigs.
   */
  irmParams?: { baseRateWad: bigint; kinkRay: bigint; slopeLowWad: bigint; slopeHighWad: bigint };
}

/** A completed, availability-lagged training observation. */
export interface CompletedLabel {
  marketId: string;
  regimeId: string;
  originSeconds: number;
  horizonSeconds: HorizonSeconds;
  /** Origin + horizon; must be <= decision origin to be usable. */
  horizonEndSeconds: number;
  /** When the outcome became readable off-chain. */
  availableAtSeconds: number;
  realizedReturnWad: bigint;
  /** §7.2's SECOND registered target: the minimum withdrawable venue cash
   *  observed over [origin, origin+H], in USDC base units. */
  realizedMinCashBase: bigint;
  /**
   * The venue's withdrawable cash AT THE ORIGIN, in USDC base units — the
   * denominator that turns `realizedMinCashBase` into a scale-free residual
   * (`realizedMinCash / originCash - 1`). Without it the second target's
   * residual would be an absolute number of USDC and could not transfer
   * across vault sizes or venues.
   *
   * `null` when the label's source cannot supply it. That is the live
   * `ForecastLabel` table today: it has no origin-cash column, and adding one
   * is a schema migration. `calibrateCashResidualQuantiles` SKIPS null rows
   * rather than treating them as a zero residual, and the artifact's
   * registered fallback quantile (which is strictly negative) governs
   * instead — so a missing input degrades conservatively, never optimistically.
   */
  originCashBase: bigint | null;
}

export interface WithdrawalObservation {
  timestampSeconds: number;
  assetsBase: bigint;
}

export interface GasObservation {
  l2BaseFeeWei: bigint;
  l1BaseFeeWei: bigint;
  l1BlobBaseFeeWei: bigint;
  ethUsdE8: bigint;
  usdcUsdE8: bigint;
}

export interface DecisionInput {
  origin: {
    blockNumber: number;
    blockHash: string;
    timestampSeconds: number;
    finalized: true;
  };
  vault: {
    totalAssetsBase: bigint;
    idleBase: bigint;
    sharesOutstanding: bigint;
    adminReserveBase: bigint;
    dynamicReserveBase: bigint;
    minIdleBps: number;
    paused: boolean;
    configurationDigest: string;
  };
  markets: MarketObservation[];
  dependencyGroups: Array<{ id: string; capBps: number; absoluteCapBase: bigint; members: string[] }>;
  withdrawals: WithdrawalObservation[];
  gas: GasObservation;
  /** Only completed and availability-lagged labels reach here. */
  history: CompletedLabel[];
  lastAction: LastActionState;
}

/**
 * One venue's signed exposure change from a past decision that actually
 * emitted a plan. `deltaBase` is positive for a deploy into the venue and
 * negative for a divest out of it — the SIGN is what makes a reversal
 * detectable, so it must never be stored as a magnitude.
 */
export interface MoveRecord {
  marketId: string;
  deltaBase: bigint;
  timestampSeconds: number;
}

/**
 * §9.1's three churn brakes need state that outlives one decision:
 * cooldown, the rolling turnover window, and the reversal allowance.
 *
 * Every field here is DERIVED FROM PERSISTED HISTORY by
 * `runtime/decision-driver.ts#loadLastAction`. The production driver used to
 * hardcode `{ timestampSeconds: null, turnoverWindowBase: 0n }`, which is a
 * permanently neutral input: `cost.ts` guards the cooldown on
 * `timestampSeconds !== null`, so the cooldown never fired, and a
 * permanently-zero `turnoverWindowBase` left the rolling window always
 * empty. Both gates were live code that could not restrain anything
 * (readiness audit NEW-19). `recentMoves` is required, not optional, for the
 * same reason: an omitted field would silently re-neutralise the reversal
 * allowance.
 */
export interface LastActionState {
  /** Origin timestamp of the most recent decision that emitted a plan. */
  timestampSeconds: number | null;
  /** Notional already moved inside the rolling max-turnover window. */
  turnoverWindowBase: bigint;
  /** Signed per-venue moves inside the reversal window, oldest-to-newest
   *  order not required — `reversalChurnBase` aggregates them. */
  recentMoves: MoveRecord[];
}

/** Piecewise-linear conservative rate curve over allocation x. */
export interface RateCurve {
  marketId: string;
  quantumBase: bigint;
  /**
   * points[k] is the post-deposit supply rate at x = k * quantumBase, where
   * x is the vault's ABSOLUTE (total) target allocation to this venue after
   * the move — NOT an incremental amount added on top of the vault's
   * current position. This matches every consumer: optimize.ts's
   * `target: Map<marketId, allocationBase>` is an absolute allocation
   * (its `effectiveCapBase` composes `positionBase + headroom` as an
   * absolute ceiling, and `decide.ts` computes plan deltas as
   * `target - positionBase`), and forecast.ts's `forecastMarkets` evaluates
   * `rateAt(curve, m.positionBase)` — the rate AT the vault's current
   * (absolute) holding, which only lands on the right curve point if x is
   * absolute. It also matches the paper: §8.2's objective evaluates
   * `\hat\mu_{i,t,H}(w_i V_t)` at the absolute candidate position
   * `x_i = w_i V_t`, and §6.3-6.5 simulate "candidate cash" after the move,
   * not cash plus a further deposit on top of the vault's own contribution.
   *
   * Whole-branch review, HIGH 4: an earlier revision built these points by
   * calling each protocol simulator with x as an INCREMENTAL deposit added
   * on top of the market's raw observed cash (which already includes the
   * vault's own position) — double-counting any existing position in the
   * curve's utilisation. simulate.ts's `simulateCurves` must exclude the
   * vault's own `positionBase` from the simulator's baseline cash before
   * adding the absolute target x back in; see its comment for the exact
   * construction.
   */
  points: bigint[];
  /** Largest x with a defined point. */
  maxXBase: bigint;
}

/**
 * Aligned per-venue horizon residuals. `rows[t][i]` is the residual of
 * `marketIds[i]` at origin `originsSeconds[t]`, in WAD over the horizon.
 *
 * Rectangular by construction: a row exists only where every listed market
 * has an observation, so a portfolio residual is always a sum over the same
 * instant rather than over whatever happened to be present.
 */
export interface ResidualPanel {
  marketIds: string[];
  originsSeconds: number[];
  rows: bigint[][];
}

export interface PolicyArtifact {
  artifactHash: string;
  policyVersion: number;
  horizonSeconds: HorizonSeconds;
  coverageTarget: CoverageTarget;
  method: ForecastMethod;
  methodParams: Record<string, number>;
  /** P1: residual quantile per market id, all <= 0 in WAD. */
  residualQuantileWadByMarket: Record<string, bigint>;
  /**
   * §7.2's SECOND registered target, calibrated with the same machinery as
   * the first: a lower prediction bound on the venue's WITHDRAWABLE CASH
   * over the horizon. Per market id, all <= 0 in WAD, expressed as a
   * RELATIVE shortfall against the origin's observed cash — so
   * `lowerBound = spotCash * (WAD + q) / WAD`.
   *
   * It supplies `e_i^cons` in §8.1's reserve and the exitable fraction
   * `phi_i` in §8.2's objective. Both consumers previously read the SPOT
   * value `MarketObservation.maxWithdrawableBase` directly, so the second
   * target existed in the paper and in the label column
   * (`prisma/schema.prisma realizedMinCashBase`) but nowhere in the policy
   * (readiness audit NEW-11).
   *
   * Relative rather than absolute because an absolute USDC quantile cannot
   * transfer between venues or vault sizes.
   */
  cashResidualQuantileWadByMarket: Record<string, bigint>;
  /**
   * The registered fallback for the above, <= 0 in WAD, used for a venue
   * with no calibrated entry AND no calibrated peer to borrow the most
   * conservative value from.
   *
   * It is deliberately NOT zero. Zero would make an uncalibrated venue's
   * predicted withdrawable cash equal its spot cash — i.e. exactly the
   * pre-fix behaviour, reached silently through an absent calibration. The
   * whole point of the second target is that absence must read as
   * conservative, not as success.
   */
  cashLowerBoundQuantileWad: bigint;
  /**
   * P2 fallback: a frozen portfolio residual quantile, <= 0 in WAD, used
   * only when `residualPanel` is absent.
   *
   * On its own this term is invariant to the MIX (it multiplies total
   * notional), so it cannot discriminate between candidate weightings and
   * P2 can never change a ranking. `residualPanel` is what makes
   * `q^p_alpha(w)` actually depend on w.
   */
  portfolioResidualQuantileWad: bigint;
  /**
   * P2's calibration input: the aligned panel of per-venue horizon residuals
   * from the CALIBRATION split, one row per origin at which every panel
   * market has a completed label.
   *
   * Present only on a calibrated artifact. `steps/portfolio-quantile.ts`
   * turns it into `q^p_alpha(w)` — a real lower quantile of the portfolio
   * residual series under the candidate's own weights. `steps/hurdles.ts`'s
   * `edgeStandardErrorWad` also reads this panel directly (per-venue sigma
   * and cross-venue correlation), independently of `q^p_alpha(w)`.
   */
  residualPanel?: ResidualPanel;
  minObservations: number;
  availabilityLagSeconds: number;
  /**
   * P8's significance multiplier k. Originally the no-trade band's
   * `k*sigma` scalar (`noTradeBandBase`, removed by P13/P15/P16);
   * `steps/hurdles.ts#rotateClears` now uses it to scale
   * `edgeStandardErrorWad` into `significanceWad`, the rotation hurdle's "k
   * standard errors of the estimated edge" term. Name kept for continuity
   * with the paper's registration record (P8, P15, P18) rather than
   * renamed to match the new call site.
   */
  noTradeBandK: number;
  /**
   * §9.1's registered payback period, in seconds. A move must repay its own
   * movement cost within this window at the conservative bound. Registered
   * jointly with `noTradeBandK` and `adjustmentRate` by the turnover-vs-return
   * sweep (paper P15, P18).
   */
  paybackSeconds: number;
  /** §9.1.4's partial-adjustment rate lambda, in (0, 1]. */
  adjustmentRate: number;
  /**
   * HAC-adjusted effective sample size of the estimation window, used as the
   * denominator of the edge standard error (§9.1.3). Overlapping horizons make
   * the nominal observation count an overstatement, so this is NOT
   * `methodParams.windowObservations`.
   */
  edgeWindowEffective: number;
  configDigest: string;
  /** Paper §6.2 — market id -> pinned configuration digest at registration. */
  pinnedConfigDigests: Record<string, string>;
  /**
   * Present only on a provisional (not calibrated) artifact, e.g. the Phase 1
   * bootstrap in `config/bootstrap-artifact.json`. When set, callers must
   * treat any result produced with this artifact as non-citable. A real
   * artifact from the Phase 4 grid sweep omits this field entirely.
   */
  _provisional?: string;
}

export interface AdmissionResult {
  eligible: string[];
  reasons: Array<{ marketId: string; code: string; passed: boolean; detail: string }>;
}

export interface ReserveResult {
  requiredBase: bigint;
  floorBase: bigint;
  netDemandQuantileBase: bigint;
  stressShortfallBase: bigint;
  scenarioFeasible: Array<{ scenario: string; feasible: boolean; shortfallBase: bigint }>;
}

/**
 * The movement decision's outcome.
 *
 * P17 removed `gainBase`, `moveCostBase`, `bandBase` and `terms`. They were the
 * single gate's `gain vs max(C_move, k*sigma)` comparison, which P13/P15/P16
 * deleted; once the gate went, all four were written as literal zeros on every
 * path, no consumer in `src/` read any of them, and `terms` was the `costs`
 * component of `computeDecisionHashV2` - so §10.2's hash covered a constant
 * `{}` while `legs`, which carries the actual reasoning, was not hashed at all.
 * `legs` now occupies that slot. The per-leg amounts are annualised WAD rates,
 * not base units; the movement cost is priced inside each leg's `hurdleWad`.
 */
export interface CostGateResult {
  passed: boolean;
  reason: string;
  /**
   * P17 - the per-leg verdicts `steps/legs.ts#planLegs` produced for this
   * decision, in the order they were paired. Empty when nothing was evaluated
   * (a hold before the hurdles, a safety-unwind bypass, or the H3 ablation).
   *
   * `passed` is now a statement about the EXECUTED vector, not about one
   * threshold over the whole target: it is true when at least one leg cleared,
   * the survivors were feasible, and the partial adjustment toward them
   * survived the aggregate brakes. The per-leg detail lives here because
   * "the move was refused" and "three of four legs were refused" are different
   * facts and a census must be able to tell them apart.
   */
  legs: LegVerdict[];
}

export interface PlanDraft {
  planId: string;
  decisionHash: string;
  merkleRoot: string;
  actions: Array<{
    index: number;
    kind: 0 | 1 | 2 | 3;
    adapter: string;
    amountBase: bigint;
    minOutBase: bigint;
    dataHash: string;
    proof: string[];
  }>;
  header: {
    planId: bigint;
    policyVersion: bigint;
    createdAt: bigint;
    expiresAt: bigint;
    actionCount: bigint;
    snapshotBlockNumber: bigint;
    snapshotHash: string;
    decisionHash: string;
    configurationDigest: string;
    reserve: bigint;
    minFinalAssets: bigint;
    maxRecognizedLoss: bigint;
    turnoverLimit: bigint;
  };
}

export interface DecisionOutput {
  snapshotHash: string;
  decisionHash: string;
  admission: AdmissionResult;
  curves: RateCurve[];
  lowerBounds: Array<{ marketId: string; muWad: bigint; lowerWad: bigint; exitableFraction: number }>;
  reserve: ReserveResult;
  target: Map<string, bigint>;
  enumeration: { regretBps: bigint; enumerated: number; passed: boolean } | null;
  costGate: CostGateResult;
  plan: PlanDraft | null;
  action: 'rebalance' | 'hold';
  reasons: string[];
}
