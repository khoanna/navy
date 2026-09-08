import type { HorizonSeconds, CoverageTarget, ForecastMethod } from './registered.js';

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
  realizedMinCashBase: bigint;
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
   * residual series under the candidate's own weights — and P8's band uses
   * the same quantity as its dispersion.
   */
  residualPanel?: ResidualPanel;
  minObservations: number;
  availabilityLagSeconds: number;
  /** P8 band multiplier. */
  noTradeBandK: number;
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

export interface CostGateResult {
  passed: boolean;
  reason: string;
  gainBase: bigint;
  moveCostBase: bigint;
  bandBase: bigint;
  terms: Record<string, bigint>;
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
