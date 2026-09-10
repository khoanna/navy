import { buildDecisionInput, type RawOrigin } from '../policy/input.js';
import { protocolOf } from '../domain/protocol.js';
import { decide, type DecideOpts } from '../policy/decide.js';
import { parseActionDecision, signedMovesFor, summariseLastAction } from '../policy/last-action.js';
import type { HorizonSeconds } from '../policy/registered.js';
import type {
  CompletedLabel,
  DecisionInput,
  DecisionOutput,
  MarketObservation,
  PolicyArtifact,
} from '../policy/types.js';
import type { SnapshotCollector } from '../collector/snapshot-collector.js';
import type { VenueIrmReading } from '../collector/types.js';
import type { PrismaClient, Prisma } from '@prisma/client';

/** A well-formed, ABI-encodable all-zero bytes32 -- see its use below. */
const ZERO_BYTES32 = '0x' + '00'.repeat(32);

export interface DecisionDriverDeps {
  loadOrigin: () => Promise<RawOrigin | null>;
  artifact: PolicyArtifact;
  opts: DecideOpts;
  /**
   * NOTE: the task-13 brief typed this as `(out: DecisionOutput) => Promise<void>`.
   * That is widened here to also pass the resolved `DecisionInput`, because
   * `Decision.blockNumber`/`Decision.timestamp` (prisma/schema.prisma) are
   * NOT-NULL columns and `DecisionOutput` carries neither field — only
   * `DecisionInput.origin` does (see policy/types.ts). A real Prisma persist
   * implementation (persistDecisionOutput below) needs `input` to populate
   * those columns. TypeScript allows a function with fewer declared
   * parameters to satisfy a type that declares more (the same rule that lets
   * `Array.prototype.map(x => x)` ignore the index/array arguments), so this
   * stays compatible with a persist function that only reads `out`.
   */
  persist: (out: DecisionOutput, input: DecisionInput) => Promise<void>;
}

/**
 * The live driver. It collects, calls decide(), and persists. It contains no
 * allocation logic of its own — that is the point. The evaluation replay is
 * the other driver, and both construct their input through buildDecisionInput
 * so neither can observe the future.
 */
export class DecisionDriver {
  constructor(private readonly deps: DecisionDriverDeps) {}

  async runCycle(): Promise<DecisionOutput | null> {
    const raw = await this.deps.loadOrigin();
    if (raw === null) return null;

    const input = buildDecisionInput(raw, this.deps.artifact);
    const output = decide(input, this.deps.artifact, this.deps.opts);
    await this.deps.persist(output, input);
    return output;
  }
}

/**
 * Shape of `config.srcla`'s derived placeholder-price status
 * (`computePlaceholderPriceStatus` in src/config.ts). Repeated as a
 * structural type here, rather than imported, so this module does not have
 * to depend on config.ts — any caller (production wiring, a test, a future
 * evaluation harness) can satisfy it with a plain object.
 */
export interface PricingGuardStatus {
  placeholderPricesInUse: boolean;
  placeholderPriceFields: string[];
}

/**
 * Thrown by assertExecutionAllowed. Deciding, persisting and logging a
 * DecisionOutput are never gated by this — only handing a produced plan to
 * an executor is.
 */
export class ExecutionBlockedError extends Error {
  constructor(public readonly placeholderPriceFields: string[]) {
    super(
      `Execution blocked: placeholder price input(s) in use: ${placeholderPriceFields.join(', ')}. ` +
      'These are named, configurable fallbacks (SRCLA_REAL_* in config.ts / .env.example), not ' +
      'real oracle readings -- acting on a plan priced with them would move real funds on a fabricated ' +
      'ETH price / L1 fee. Wire real values for these before any produced plan may be handed to an ' +
      'executor. This does not affect deciding, persisting or logging decisions.'
    );
    this.name = 'ExecutionBlockedError';
  }
}

/**
 * The sanctioned execution gate (Task 13, Finding 1). ANY code path that is
 * about to hand a produced PlanDraft to an executor -- KeeperExecutor et al,
 * wired by Task 14 -- MUST call this first and let it throw uncaught (or
 * catch ExecutionBlockedError specifically, e.g. to log and skip that
 * cycle) rather than re-deriving or re-checking placeholderPricesInUse
 * itself. That keeps there being exactly one place this rule can be
 * satisfied or missed, instead of every future call site needing to
 * remember to check it independently.
 */
export function assertExecutionAllowed(guard: PricingGuardStatus): void {
  if (guard.placeholderPricesInUse) {
    throw new ExecutionBlockedError(guard.placeholderPriceFields);
  }
}

/**
 * The three window lengths §9.1's churn brakes are measured over. Taken
 * from the SAME `DecideOpts['cost']` the gate is then evaluated with
 * (src/index.ts passes `decideOpts.cost`), so the window that is measured
 * and the window the gate enforces cannot drift apart.
 */
export interface LastActionChurnParams {
  cooldownSeconds: number;
  turnoverWindowSeconds: number;
  reversalWindowSeconds: number;
}

/**
 * §9.1's cooldown / max-turnover / reversal state, read from persisted
 * decisions.
 *
 * SOURCE, AND ITS LIMIT. The only table the live service writes on the
 * decision path is `Decision` (verified by grep: `ExecutionPlan`,
 * `PlanAction` and `SubmissionReceipt` have writers in
 * `db/repositories/decision-repository.ts` but that class has no caller
 * anywhere in `src/`). So this reconstructs churn from decisions that
 * EMITTED A PLAN, not from actions confirmed on chain. A plan that was
 * built and then failed preflight or reverted still counts as an action
 * here.
 *
 * That direction is the safe one — it can only make the brakes fire more
 * often than reality warrants, never less — but it is a real approximation
 * and must be replaced by confirmed `PlanAction` rows once something
 * actually writes them.
 *
 * The query window is the LONGEST of the three horizons: the cooldown may
 * legitimately be longer than either rolling window, and a row outside the
 * query window can affect none of the three.
 */
export async function loadLastAction(
  prisma: PrismaClient,
  originSeconds: number,
  p: LastActionChurnParams
): Promise<DecisionInput['lastAction']> {
  const horizonSeconds = Math.max(p.cooldownSeconds, p.turnoverWindowSeconds, p.reversalWindowSeconds);
  const rows = await prisma.decision.findMany({
    where: {
      timestamp: {
        gt: new Date((originSeconds - horizonSeconds) * 1000),
        lte: new Date(originSeconds * 1000),
      },
    },
    orderBy: { timestamp: 'desc' },
    take: 1000,
    select: { timestamp: true, actionDecision: true },
  });

  const records = rows.map((r) =>
    parseActionDecision(Math.floor(r.timestamp.getTime() / 1000), r.actionDecision)
  );

  return summariseLastAction(records, originSeconds, {
    turnoverWindowSeconds: p.turnoverWindowSeconds,
    reversalWindowSeconds: p.reversalWindowSeconds,
  });
}

const REGISTERED_HORIZON_SECONDS = new Set<number>([86_400, 604_800, 1_209_600]);

/**
 * Task-13 correction 4: the brief's sample code hardcoded
 * `horizonSeconds: 604_800` for every mapped label. `ForecastLabel.horizonSeconds`
 * is a real column (prisma/schema.prisma) — hardcoding it would silently
 * relabel every 1-day and 14-day observation as 7-day, corrupting forecast
 * calibration with no typecheck or test able to catch it. This reads the real
 * column and fails loudly (rather than silently coercing) if a row ever
 * carries a horizon outside the registered set in policy/registered.ts.
 */
function asHorizonSeconds(n: number, labelId: string): HorizonSeconds {
  if (REGISTERED_HORIZON_SECONDS.has(n)) return n as HorizonSeconds;
  throw new Error(`ForecastLabel ${labelId} has an unregistered horizonSeconds ${n}`);
}

/**
 * Un-alias a collector `VenueIrmReading` into whichever of
 * `MarketObservation`'s two rate-model seams the venue's protocol takes.
 *
 * Mirrors `evaluation/kernel/decision-input.ts` field for field, so the live
 * and offline paths cannot disagree about what a rate-model observation is.
 * PURE and exported so the dispatch is unit-tested directly rather than only
 * through a chain-backed collector.
 *
 * Returns an EMPTY object — not a default — when there is no reading, or when
 * an Aave reading is missing either of its two Aave-only bounds. The empty
 * object is what makes `policy/steps/simulate.ts#resolveConfig` warn instead
 * of substituting silently.
 */
export function irmSeamFor(
  marketId: string,
  irm: VenueIrmReading | undefined
): Pick<MarketObservation, 'irmParams' | 'aaveIrmParams'> {
  if (irm === undefined) return {};
  if (protocolOf(marketId) === 'aave') {
    if (irm.optimalUtilizationRay === undefined || irm.maxUtilizationRay === undefined) return {};
    return {
      aaveIrmParams: {
        baseRateWad: irm.baseRateWad,
        variableRateSlope1Wad: irm.slopeLowWad,
        variableRateSlope2Wad: irm.slopeHighWad,
        optimalUtilizationRay: irm.optimalUtilizationRay,
        maxUtilizationRay: irm.maxUtilizationRay,
        reserveFactorBps: irm.reserveFactorBps,
      },
    };
  }
  return {
    irmParams: {
      baseRateWad: irm.baseRateWad,
      kinkRay: irm.kinkRay,
      slopeLowWad: irm.slopeLowWad,
      slopeHighWad: irm.slopeHighWad,
      reserveFactorBps: irm.reserveFactorBps,
    },
  };
}

/**
 * Adapter from a collected finalised snapshot to the unfiltered RawOrigin.
 * It does no filtering of its own — buildDecisionInput owns the barrier.
 *
 * `gas` and `chainConfigDigests` are supplied by the caller (src/index.ts):
 * this function has no gas-price or configuration-digest oracle of its own —
 * see task-13-report.md for exactly which GasObservation fields are read
 * live off chain versus configured placeholders.
 */
export async function buildRawOriginFromCollector(
  collector: SnapshotCollector,
  prisma: PrismaClient,
  gas: RawOrigin['gas'],
  chainConfigDigests: Record<string, string>,
  churn: LastActionChurnParams
): Promise<RawOrigin | null> {
  const snap = await collector.collect();
  if (snap === null) return null;

  // Paper §12 row 1: "Mark snapshot incomplete; do not decide." A configured
  // venue that could not be read is NOT the same as a venue that is absent —
  // deciding on the remainder would reallocate the whole vault across a
  // silently truncated market set.
  if (snap.incomplete) {
    console.error(
      `[DecisionDriver] Refusing to decide on an incomplete snapshot at block ${snap.blockNumber}: ` +
        `could not read ${snap.missingMarkets.join(', ')}`
    );
    return null;
  }

  const markets: MarketObservation[] = snap.strategies.map((s) => ({
    marketId: s.name,
    adapter: s.address,
    protocol: protocolOf(s.name),
    cash: s.cash,
    borrows: s.borrows,
    reserves: s.reserves,
    supplyRateWad: s.supplyRate,
    utilizationWad: s.utilization,
    positionBase: s.totalAssets,
    // The adapter's own `maxDeployable()`, NOT `maxWithdrawable()`. The two
    // are different quantities: `maxWithdrawable()` is
    // min(our position, venue cash) and is therefore 0 for a venue the vault
    // has not entered, so reusing it here made `admit.ts`'s CAP_ZERO rule
    // (`maxDeployableBase > 0`) reject every empty venue and
    // `effectiveCapBase`'s `positionBase + maxDeployableBase` headroom cap
    // it to zero — the deployable half of readiness audit NEW-11's
    // cold-start deadlock. `maxDeployable()` is position-independent and
    // reports the venue's real supply headroom (2^256-1 where uncapped).
    maxDeployableBase: s.maxDeployable,
    // NOT `s.maxWithdrawable`: the adapter's `maxWithdrawable()` is
    // `min(ourBalance, protocolCash)`, so it is 0 for a venue the vault has
    // not entered — and `exitableFraction(x, 0) = 0` then zeroes the
    // objective for every candidate, so the optimiser could never make a
    // first deployment into an empty venue. The kernel needs the venue's
    // exit CAPACITY (the `availableInComet` half of that min), which the
    // collector now reports as `s.cash`. See MarketObservation's doc comment.
    maxWithdrawableBase: s.cash,
    configDigest: s.configDigest,
    regimeId: chainConfigDigests[s.name] ?? s.configDigest,
    paused: s.paused,
    // KNOWN GAP, not introduced by this task: per-market capBps/maxLossBps/
    // dependencyGroupIds are not yet collected on-chain — StrategySnapshot
    // has no fields for them. These are fixed placeholders pending a
    // collector enhancement. (This comment used to cite the irmParams gap as
    // a peer; that one is CLOSED as of 2026-09-10 — see the seams below.)
    capBps: 5000,
    absoluteCapBase: snap.vault.totalAssets,
    maxLossBps: 50,
    dependencyGroupIds: [],
    // §6.3-6.5's LIVE registered rate model, read at THIS cycle's own block
    // by `SnapshotCollector` — not `DefaultConfigs`.
    //
    // FIX 2026-09-10 (E1b), GAP 2. This function populated NEITHER seam, so
    // every venue on the LIVE keeper path ran through placeholder curves on
    // every cycle: Aave through DEFAULT_AAVE_CONFIG (the defect E1 closed on
    // the offline path only) and Compound/Moonwell through
    // DEFAULT_COMPOUND_CONFIG/DEFAULT_MOONWELL_CONFIG. `RateCurve.points`
    // feeds `rateAt` -> `annualLowerBound` -> both movement hurdles, so a
    // placeholder curve is a wrong deployment and rotation decision with real
    // funds behind it. Measured against the stored rate over the calibration
    // era, the placeholders were off 7.5689 pp MAE (Compound), 7.2538 pp MAE
    // (Moonwell) and 3.9769 pp MAE (Aave) at each origin's own utilization.
    //
    // The SHAPE dispatch is the same one `decision-input.ts` makes offline
    // and `resolveConfig` enforces: Aave's reading is a structurally
    // different curve and rides in `aaveIrmParams`; Compound's and
    // Moonwell's kinked-linear readings ride in `irmParams`. Supplying
    // `irmParams` on an Aave market is a caller error `resolveConfig` THROWS
    // on, so the protocol gate here is load-bearing, not cosmetic.
    //
    // ALL-OR-NOTHING: `s.irm` is either a complete reading or absent, and
    // absent leaves both seams undefined so `resolveConfig` falls back to the
    // placeholder AND WARNS, naming the market. Never half-populated, never a
    // silent substitution. Aave additionally requires its two own bounds to
    // be present, so a kinked-only reading can never be misread as an Aave
    // one.
    ...irmSeamFor(s.name, s.irm),
  }));

  const rows = await prisma.forecastLabel.findMany({
    // Task-13 correction 3: `availableAt` is a required (non-optional)
    // DateTime column — filtering it `{ not: null }` is a type error, and
    // there is nothing to filter since it can never be null. `horizonEndsAt`
    // IS optional and is the real gate for "has an outcome been recorded".
    where: { horizonEndsAt: { not: null } },
    // Whole-branch review, MEDIUM 6: `take: N` with an `asc` order returns
    // the OLDEST N rows, the opposite of a rolling window's intent — once
    // history exceeds 5000 rows, every decision would train on the oldest
    // data forever and never see anything recent. `desc` takes the most
    // recent 5000 instead. Order of the returned array does not matter to
    // any consumer (admit.ts's REGIME_MIN_HISTORY only counts/filters it).
    orderBy: { horizonEndsAt: 'desc' },
    take: 5000,
  });

  const allLabels: CompletedLabel[] = rows.map((r) => ({
    marketId: r.marketId,
    regimeId: r.regimeId ?? 'unknown',
    // Task-13 correction 2: ForecastLabel has no `createdAt` field — the
    // origin timestamp is `originTimestamp`.
    originSeconds: Math.floor(r.originTimestamp.getTime() / 1000),
    // Task-13 correction 4: read the real column, never hardcode.
    horizonSeconds: asHorizonSeconds(r.horizonSeconds, r.id),
    horizonEndSeconds: Math.floor(r.horizonEndsAt!.getTime() / 1000),
    availableAtSeconds: Math.floor(r.availableAt.getTime() / 1000),
    // Task-13 correction 5: `realizedReturnWad` is a new optional column;
    // `realizedReturnE18` is the pre-existing required one. Prefer the new
    // column when present, fall back to the legacy one.
    realizedReturnWad: BigInt(r.realizedReturnWad ?? r.realizedReturnE18),
    // Task-13 correction 6: `realizedMinCashBase` is optional.
    realizedMinCashBase: BigInt(r.realizedMinCashBase ?? '0'),
    // §7.2's second target needs the ORIGIN's withdrawable cash as the
    // denominator of a scale-free residual, and `ForecastLabel` has no such
    // column (prisma/schema.prisma). Adding one is a schema migration, which
    // is out of scope here, so this reports `null` — which
    // `calibrateCashResidualQuantiles` SKIPS rather than reading as a zero
    // residual. The artifact's registered (strictly negative) fallback
    // quantile governs instead, so the missing input degrades
    // conservatively. See fix-e-policy-report.md.
    originCashBase: null,
  }));

  const withdrawals = (
    // Whole-branch review, MEDIUM 6: same `take` + ordering defect as
    // forecastLabel above — `desc` takes the most recent 5000 withdrawal
    // events, not the oldest, so reserve.ts's rolling withdrawal-demand
    // quantile can actually see recent withdrawals once history exceeds the
    // cap. `demandQuantileBase` (policy/steps/reserve.ts) re-sorts its input
    // ascending itself, so the order of this array does not matter, only
    // WHICH rows come back.
    await prisma.withdrawalEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 5000 })
  ).map((w) => ({
    timestampSeconds: Math.floor(w.timestamp.getTime() / 1000),
    // Task-13 correction 1: the column is `assets`, not `assetsBase`.
    assetsBase: BigInt(w.assets),
  }));

  const originSeconds = Math.floor(snap.timestamp.getTime() / 1000);

  return {
    origin: {
      blockNumber: snap.blockNumber,
      blockHash: snap.blockHash,
      timestampSeconds: originSeconds,
      finalized: true,
    },
    vault: {
      totalAssetsBase: snap.vault.totalAssets,
      idleBase: snap.vault.idleBase,
      // KNOWN GAP, not introduced by this task: VaultSnapshot
      // (src/collector/types.ts) has no share-supply field. No policy step
      // reads DecisionInput.vault.sharesOutstanding today (confirmed by
      // grep across src/policy), so this placeholder is inert, but it is
      // NOT a real reading — do not rely on it once something starts
      // consuming that field.
      sharesOutstanding: snap.vault.totalAssets,
      // snap.vault.reserve is a required field (collector/types.ts) --
      // adminReserve()/dynamicReserve() are core vault state, always
      // attempted by collectVault, and a failed read propagates as a
      // thrown error from collector.collect() rather than landing here as
      // an optional field to silently default to 0n (whole-branch review,
      // HIGH 5).
      adminReserveBase: snap.vault.reserve.admin,
      dynamicReserveBase: snap.vault.reserve.dynamic,
      minIdleBps: Number(snap.vault.minIdleBps),
      paused: snap.vault.paused,
      // Whole-branch review, MEDIUM 6: '0x' (a ZERO-LENGTH byte string) is
      // NOT a valid bytes32 — plan.ts's ABI-encodes this field as a fixed
      // bytes32 (HEADER_TUPLE), and ethers throws on a 0-length BytesLike
      // for a fixed-size type. This only stayed latent because admission
      // never succeeds while `pinnedConfigDigests: {}` (CONFIG_DIGEST_UNPINNED
      // rejects every market before buildPlan is ever reached) — the moment
      // digest pinning is wired up, this becomes an uncaught throw inside
      // decide(). There is no live configuration-digest oracle to supply the
      // REAL vault digest here yet (chainConfigDigests is caller-supplied
      // and src/index.ts passes {} — see its own comment), so this uses a
      // well-formed all-zero bytes32 sentinel instead of a malformed one:
      // it ABI-encodes safely AND can never coincidentally equal a real
      // pinned digest, so CONFIG_DIGEST_UNPINNED's behavior is unchanged.
      configurationDigest: chainConfigDigests['vault'] ?? ZERO_BYTES32,
    },
    markets,
    dependencyGroups: [],
    withdrawals,
    gas,
    allLabels,
    lastAction: await loadLastAction(prisma, originSeconds, churn),
  };
}

/**
 * Concrete Prisma persistence for one DecisionOutput. `Decision.policyVersion`
 * is a foreign key into `PolicyVersion.version` (prisma/schema.prisma) — the
 * PolicyVersion row is upserted first so the first-ever decision recorded
 * against a given artifact does not fail the foreign-key constraint.
 */
export async function persistDecisionOutput(
  prisma: PrismaClient,
  artifact: PolicyArtifact,
  out: DecisionOutput,
  input: DecisionInput
): Promise<void> {
  const policyVersion = String(artifact.policyVersion);

  await prisma.policyVersion.upsert({
    where: { version: policyVersion },
    update: {},
    create: {
      version: policyVersion,
      payload: {
        artifactHash: artifact.artifactHash,
        configDigest: artifact.configDigest,
        method: artifact.method,
      } as unknown as Prisma.InputJsonValue,
      artifactHash: artifact.artifactHash,
    },
  });

  await prisma.decision.create({
    data: {
      decisionHash: out.decisionHash,
      policyVersion,
      snapshotHash: out.snapshotHash,
      blockNumber: BigInt(input.origin.blockNumber),
      timestamp: new Date(input.origin.timestampSeconds * 1000),
      admissions: out.admission as unknown as Prisma.InputJsonValue,
      forecasts: out.lowerBounds.map((f) => ({
        marketId: f.marketId,
        muWad: f.muWad.toString(),
        lowerWad: f.lowerWad.toString(),
        exitableFraction: f.exitableFraction,
      })) as unknown as Prisma.InputJsonValue,
      reserveBase: out.reserve.requiredBase.toString(),
      allocation: Object.fromEntries(
        [...out.target.entries()].map(([marketId, amount]) => [marketId, amount.toString()])
      ) as unknown as Prisma.InputJsonValue,
      // `moves` is what makes §9.1's cooldown, rolling turnover window and
      // reversal allowance readable on a LATER cycle (loadLastAction above).
      // Nothing else in the schema records a realised exposure change, so
      // dropping this field silently re-neutralises all three gates.
      // Written only for a decision that actually emitted a plan: a HOLD
      // moved nothing and must not start a cooldown.
      actionDecision: {
        action: out.action,
        reasons: out.reasons,
        planId: out.plan?.planId ?? null,
        moves:
          out.plan === null
            ? []
            : signedMovesFor(input.markets, out.target).map((m) => ({
                marketId: m.marketId,
                deltaBase: m.deltaBase.toString(),
              })),
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // §8.2: "its output is checked against exhaustive enumeration at the same
  // quantum and its approximation regret is persisted"; §10.2 lists the
  // stored records. `model EnumerationResult` had no writer anywhere in
  // `src/` (readiness audit NEW-18) — the regret existed only on the
  // in-memory DecisionOutput and was discarded with it.
  //
  // A null enumeration writes NOTHING rather than a zero-regret row: "the
  // universe was too large to enumerate" and "enumerated, regret zero" are
  // different claims, and a zero row would make the second unfalsifiable.
  if (out.enumeration !== null) {
    await prisma.enumerationResult.upsert({
      where: { decisionHash: out.decisionHash },
      update: {
        enumerated: out.enumeration.enumerated,
        regretBps: out.enumeration.regretBps.toString(),
        passed: out.enumeration.passed,
      },
      create: {
        decisionHash: out.decisionHash,
        enumerated: out.enumeration.enumerated,
        regretBps: out.enumeration.regretBps.toString(),
        passed: out.enumeration.passed,
      },
    });
  }
}
