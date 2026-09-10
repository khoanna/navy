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
   * Live on-chain IRM parameters, KINKED-LINEAR SHAPE (Compound III /
   * Moonwell). Falls back to DefaultConfigs — loudly — when absent.
   *
   * Paper §6.3-6.5 requires simulation to mirror the LIVE registered
   * interest-rate strategy, not a hardcoded default — this is that seam.
   * Aave's `DefaultReserveInterestRateStrategy` takes a structurally
   * different parameter set and has its OWN field, `aaveIrmParams`; supplying
   * this one on an Aave market is a caller error and
   * `policy/steps/simulate.ts#resolveConfig` throws on it rather than
   * silently dropping an override that does not apply.
   *
   * WHAT THE FOUR COEFFICIENTS MEAN IS PROTOCOL-DEPENDENT, and the shape
   * alone does not say which. On Comet they ARE the supply curve
   * (`supplyPerSecondInterestRate*` / `supplyKink()`, already net of
   * reserves). On an mToken they are the BORROW curve
   * (`baseRatePerTimestamp` / `multiplierPerTimestamp` /
   * `jumpMultiplierPerTimestamp` / `kink`) and the supply rate is
   * `borrow * u * (1 - reserveFactor)`. `resolveConfig` dispatches on
   * `protocol` for exactly that reason.
   *
   * Populated on BOTH drivers as of 2026-09-10: the offline evaluation path
   * (`evaluation/kernel/decision-input.ts`, from the archive row's per-origin
   * chain reading) and the LIVE runtime path
   * (`runtime/decision-driver.ts`, from `StrategySnapshot.irm`, which
   * `SnapshotCollector` now reads off each venue's rate model through the
   * Navy adapters). Before that date NEITHER driver populated it, so every
   * Compound and Moonwell curve in the shipped controller came from
   * `DefaultConfigs` — measured at 7.5689 pp MAE (Compound) and 7.2538 pp MAE
   * (Moonwell) against the stored rate over the calibration era.
   *
   * ALL-OR-NOTHING: a producer supplies every field or omits the object.
   * Never half-populated, never defaulted field by field.
   */
  irmParams?: {
    baseRateWad: bigint;
    kinkRay: bigint;
    slopeLowWad: bigint;
    slopeHighWad: bigint;
    /**
     * The venue's reserve factor, bps. REQUIRED for the same reason
     * `aaveIrmParams.reserveFactorBps` is: on Moonwell it is a
     * multiplicative term in the borrow -> supply conversion and an absent
     * value silently reading as 0 overstates the supply rate by exactly that
     * factor. On Compound it is 0 by construction — Comet's curve is already
     * net of reserves, which is why the archive stores NULL there and
     * `evaluation/dataset.ts#resolveReserveFactorBps` resolves that NULL to 0
     * for that venue only.
     */
    reserveFactorBps: number;
  };
  /**
   * Live on-chain IRM parameters, AAVE V3 SHAPE — the per-origin reading of
   * `DefaultReserveInterestRateStrategy` plus the reserve's own reserve
   * factor, which is a multiplicative term in Aave's borrow -> supply
   * conversion and therefore part of its rate model, not decoration.
   *
   * Exists because Aave's model is NOT the kinked-linear `irmParams` shape:
   * it has an optimal usage ratio rather than a kink, two BORROW slopes
   * rather than supply slopes, a max-utilization bound, and the reserve cut.
   * Before 2026-09-10 there was no Aave-shaped seam at all, so `resolveConfig`
   * discarded every live Aave reading and simulated Base USDC with
   * `DEFAULT_AAVE_CONFIG`'s placeholders (slope1 4% / slope2 60% / optimal
   * 80% against a real 4.7% / 10% / 90%) — see `resolveConfig`.
   *
   * Absent means "no chain reading for this origin": `resolveConfig` then
   * falls back to `DEFAULT_AAVE_CONFIG` and WARNS, once per market. It is
   * never half-populated — every field comes from the same origin's snapshot
   * or the whole object is omitted.
   */
  aaveIrmParams?: {
    /** Base BORROW rate at 0 utilization, WAD annualized. */
    baseRateWad: bigint;
    /** First BORROW slope, below the optimal usage ratio, WAD annualized. */
    variableRateSlope1Wad: bigint;
    /** Second BORROW slope, above the optimal usage ratio, WAD annualized. */
    variableRateSlope2Wad: bigint;
    /** Optimal usage ratio, RAY. */
    optimalUtilizationRay: bigint;
    /** Maximum usage ratio the curve is defined to, RAY. */
    maxUtilizationRay: bigint;
    /** Protocol's cut of borrow interest, bps. */
    reserveFactorBps: number;
  };
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
  /**
   * The venue's total BORROWS outstanding AT THE FORECAST ORIGIN, USDC base
   * units — the other half of the (cash, borrows) pair §7.2 registers as the
   * state a mean-reverting level model runs on (utilization is the ratio of
   * the two, not itself the primitive state). Populated alongside
   * `originCashBase` by the same origin snapshot; OPTIONAL and additive
   * rather than `bigint | null` like its sibling, so every pre-existing
   * `CompletedLabel` literal keeps compiling unchanged. Absent/undefined
   * means the same as `originCashBase === null`: the state-space candidate
   * (`forecast/grid-sweep.ts`) must refuse this label, not substitute 0 or
   * any other value.
   */
  originBorrowsBase?: bigint;
  /**
   * The venue's protocol RESERVES AT THE FORECAST ORIGIN, USDC base units —
   * the third state component `forecast/grid-sweep.ts` needs to derive
   * Aave's/Moonwell's utilization the same way the collector computed the
   * stored one (`borrows / (cash + borrows - reserves)`), rather than the
   * reserves-blind `borrows / (cash + borrows)`. Always 0 for Aave by
   * construction (its on-chain reserves are denominated in scaled aToken
   * units, not underlying, so the collector never nets them in). OPTIONAL
   * and additive for the same reason as its siblings.
   */
  originReservesBase?: bigint;
  /**
   * The venue's utilization AT THE FORECAST ORIGIN (never the horizon end —
   * that would be look-ahead), Wad. Populated by
   * `evaluation/kernel/decision-input.ts#deriveCompletedLabels` from the
   * same origin snapshot the label's `regimeId` comes from. OPTIONAL and
   * additive so every pre-existing `CompletedLabel` literal (test fixtures,
   * hand-built datasets) keeps compiling unchanged; absent only where the
   * source snapshot never carried it.
   *
   * COMPOUND-ONLY PRIMITIVE. `forecast/grid-sweep.ts`'s state-space
   * candidate forecasts THIS field directly for Compound rather than
   * deriving utilization from (cash, borrows): Comet reports utilization
   * off-chain-read (`getUtilization()`) and DERIVES `borrows` from it
   * (`borrows = totalSupply * utilization / WAD`), so recomputing
   * utilization back from (cash, borrows) does not invert cleanly — measured
   * against 10,632 calibration rows, doing so cost 0.72pp MAE that reading
   * this field directly does not. Aave and Moonwell go the other way
   * (`originCashBase`/`originBorrowsBase`/`originReservesBase` are the
   * primitives for them, matching how the collector derived THEIR stored
   * utilization) — see `grid-sweep.ts`'s module comment for the full
   * per-protocol reasoning and the measured evidence.
   */
  originUtilizationWad?: bigint;
  /**
   * Kinked-linear IRM parameters observed AT THE FORECAST ORIGIN, mirroring
   * `forecast/state-space.ts#IrmParams` structurally (duck-typed rather than
   * imported, so this core policy type does not depend on the forecast
   * module). `null`/absent means the origin's snapshot carried no reading —
   * a failed protocol read, or a protocol with no kinked-linear equivalent
   * (Aave's real model is quadratic). `forecast/grid-sweep.ts`'s
   * 'state-space' candidate MUST treat that as a REFUSAL for this label —
   * never substitute `DEFAULT_*_CONFIG` or fall back to a return-series
   * proxy, which would register a candidate under a name it does not
   * implement.
   */
  originIrmParams?: {
    baseRateWad: bigint;
    kinkRay: bigint;
    slopeLowWad: bigint;
    slopeHighWad: bigint;
    reserveFactorBps: number;
  } | null;
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
  /**
   * `true` when each row entry is a RELATIVE residual — `(realized -
   * forecast) / forecast`, WAD — rather than the absolute `realized - mean`
   * the panel originally carried.
   *
   * Two defects are corrected together, and both live in the term that
   * actually gates SRCLA: `optimize.ts#portfolioLowerBound` applies the
   * PORTFOLIO quantile, not the per-venue one, so the per-venue map's form is
   * irrelevant to the decision.
   *
   *   BASIS. The original panel measured `realized - the venue's own mean
   *   realized return over the calibration era`. That is the dispersion of
   *   realized returns, NOT forecast error: a perfect forecaster and a
   *   coin-flip forecaster receive the identical haircut, and the method the
   *   grid sweep selected earns no credit for being better. Measured, the
   *   mean-based portfolio quantile is -2.566% APY on an equal three-venue
   *   mix against -0.890% to -1.159% for the same venues' MODEL residuals:
   *   a factor of 2.7.
   *
   *   FORM. It was applied as `mu + q * notional`. `mu` is evaluated at the
   *   candidate allocation, so §6's capacity curves have already compressed
   *   it by the vault's own market impact; a constant per-unit haircut then
   *   consumes a growing share of a shrinking edge. At -2.566% against venue
   *   rates of 3-6% it removes roughly two thirds of the edge before size is
   *   even considered.
   *
   * A panel WITHOUT this flag is the legacy absolute form and
   * `portfolioLowerBound` keeps applying it additively — an artifact frozen
   * before this field must not have its haircut silently reinterpreted.
   */
  relative?: boolean;
}

export interface PolicyArtifact {
  artifactHash: string;
  policyVersion: number;
  horizonSeconds: HorizonSeconds;
  coverageTarget: CoverageTarget;
  method: ForecastMethod;
  methodParams: Record<string, number>;
  /** P1: residual quantile per market id, all <= 0 in WAD. ABSOLUTE — a
   *  horizon-return haircut subtracted from the point forecast. Retained as
   *  the fallback for `relativeResidualQuantileWadByMarket` below, and as
   *  what an artifact frozen before that field existed carries. */
  residualQuantileWadByMarket: Record<string, bigint>;
  /**
   * P1, RELATIVE form — the residual quantile as a FRACTION of the forecast
   * it haircuts, all <= 0 in WAD, applied as
   * `lowerBound = mu * (WAD + q) / WAD`.
   *
   * WHY RELATIVE. The absolute form above is one constant per venue,
   * subtracted from a point forecast whose level varies by a factor of
   * several across the era — and, critically, which the vault's OWN deposit
   * compresses at scale, because §6's capacity curves evaluate the rate after
   * the deposit. A constant absolute haircut therefore consumes a growing
   * share of a shrinking edge, and past a certain vault size it exceeds the
   * edge entirely and no venue can ever clear the deployment hurdle. That is
   * observable: at the 10M tier the controller left 61% of NAV idle, while
   * the same controller with the haircut removed deployed 86% and remained
   * fully redeemable.
   *
   * The multiplicative form is not a relaxation, it is the specification the
   * calibration data supports. Measured on the calibration era, the 5% lower
   * quantile of the ABSOLUTE forecast error varies 2.9x-5.9x across
   * utilization bands while the RELATIVE error varies only 1.8x-2.9x and
   * tracks the forecast level: the error is proportional to what is being
   * forecast. The resulting bound is STRICTER than the absolute one wherever
   * the forecast rate is above the venue's mean and looser only below it.
   *
   * This also makes §7.2's two registered targets consistent:
   * `cashResidualQuantileWadByMarket` below has always been relative, and is
   * applied by exactly this arithmetic.
   *
   * OPTIONAL: an artifact frozen before this field carries only the absolute
   * map, and `lowerBoundAt` falls back to it rather than fabricating a
   * relative quantile from it — the two are not interconvertible without the
   * forecast level each was calibrated against.
   */
  relativeResidualQuantileWadByMarket?: Record<string, bigint>;
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
  /**
   * P2's panel in RELATIVE, MODEL-residual form — used ONLY by
   * `optimize.ts#portfolioLowerBound`.
   *
   * WHY THIS IS A SECOND FIELD AND NOT A FLAG ON THE FIRST. `residualPanel`
   * has two consumers with incompatible unit expectations:
   * `hurdles.ts#columnSigma` reads its columns as ABSOLUTE horizon-return
   * residuals to build §9.1.3's edge standard error, while
   * `portfolioLowerBound` wants a haircut proportional to the forecast.
   * Reinterpreting one panel as relative silently inflated `columnSigma` by
   * roughly three orders of magnitude, which made the rotation hurdle
   * unclearable and drove the controller to ZERO rebalances across every
   * grid candidate. Two panels, two units, no reinterpretation.
   */
  relativeResidualPanel?: ResidualPanel;
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
  /**
   * True when the EXECUTED vector is `decide.ts#chooseExecuted`'s
   * risk-reducing backoff (the divest-only subset) rather than the full
   * surviving set. This is reported independently of `reason` because a
   * churn brake evaluated AFTER the backoff (`applyBrakes` runs on the final
   * executed vector) overwrites `reason` with the brake string alone —
   * `'REVERSAL_ALLOWANCE: ...'` looks identical whether it fired on the full
   * target or on an already-backed-off one. A census that only parses
   * `reason` cannot tell "the policy tried to back off and STILL got
   * brake-blocked" from "the policy never needed to back off and got
   * brake-blocked on the full move" — two different failure modes that call
   * for different fixes. `passed && backedOff` is the success case
   * (`reason === 'HURDLES_CLEARED_DIVEST_ONLY'`); `!passed && backedOff` is
   * the degenerate one this field exists to surface.
   */
  backedOff: boolean;
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
