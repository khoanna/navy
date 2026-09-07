import { buildDecisionInput, type RawOrigin } from '../policy/input.js';
import { decide, type DecideOpts } from '../policy/decide.js';
import type { HorizonSeconds } from '../policy/registered.js';
import type {
  CompletedLabel,
  DecisionInput,
  DecisionOutput,
  MarketObservation,
  PolicyArtifact,
} from '../policy/types.js';
import type { SnapshotCollector } from '../collector/snapshot-collector.js';
import type { PrismaClient, Prisma } from '@prisma/client';

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
      'These are named, configurable fallbacks (SRCLA_PLACEHOLDER_* in config.ts / .env.example), not ' +
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

const PROTOCOL_BY_NAME: Record<string, MarketObservation['protocol']> = {
  aave: 'aave',
  compound: 'compound',
  moonwell: 'moonwell',
};

function protocolOf(name: string): MarketObservation['protocol'] {
  const key = Object.keys(PROTOCOL_BY_NAME).find((k) => name.toLowerCase().includes(k));
  if (!key) throw new Error(`cannot classify strategy "${name}" as a known protocol`);
  return PROTOCOL_BY_NAME[key]!;
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
  chainConfigDigests: Record<string, string>
): Promise<RawOrigin | null> {
  const snap = await collector.collect();
  if (snap === null) return null;

  const markets: MarketObservation[] = snap.strategies.map((s) => ({
    marketId: s.name,
    adapter: s.address,
    protocol: protocolOf(s.name),
    cash: s.cash,
    borrows: 0n,
    reserves: 0n,
    supplyRateWad: s.supplyRate,
    utilizationWad: s.utilization,
    positionBase: s.totalAssets,
    // StrategySnapshot (src/collector/types.ts) exposes only one
    // same-transaction headroom figure (maxWithdrawable) — until the
    // collector distinguishes deployable vs withdrawable headroom, both
    // DecisionInput fields read the same on-chain value.
    maxDeployableBase: s.maxWithdrawable,
    maxWithdrawableBase: s.maxWithdrawable,
    configDigest: s.configDigest,
    regimeId: chainConfigDigests[s.name] ?? s.configDigest,
    paused: s.paused,
    // KNOWN GAP, not introduced by this task: per-market capBps/maxLossBps/
    // dependencyGroupIds are not yet collected on-chain — StrategySnapshot
    // has no fields for them. These are fixed placeholders pending a
    // collector enhancement (mirrors the existing irmParams gap documented
    // on MarketObservation in policy/types.ts).
    capBps: 5000,
    absoluteCapBase: snap.vault.totalAssets,
    maxLossBps: 50,
    dependencyGroupIds: [],
  }));

  const rows = await prisma.forecastLabel.findMany({
    // Task-13 correction 3: `availableAt` is a required (non-optional)
    // DateTime column — filtering it `{ not: null }` is a type error, and
    // there is nothing to filter since it can never be null. `horizonEndsAt`
    // IS optional and is the real gate for "has an outcome been recorded".
    where: { horizonEndsAt: { not: null } },
    orderBy: { horizonEndsAt: 'asc' },
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
  }));

  const withdrawals = (
    await prisma.withdrawalEvent.findMany({ orderBy: { timestamp: 'asc' }, take: 5000 })
  ).map((w) => ({
    timestampSeconds: Math.floor(w.timestamp.getTime() / 1000),
    // Task-13 correction 1: the column is `assets`, not `assetsBase`.
    assetsBase: BigInt(w.assets),
  }));

  return {
    origin: {
      blockNumber: snap.blockNumber,
      blockHash: snap.blockHash,
      timestampSeconds: Math.floor(snap.timestamp.getTime() / 1000),
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
      adminReserveBase: snap.vault.reserve?.admin ?? 0n,
      dynamicReserveBase: snap.vault.reserve?.dynamic ?? 0n,
      minIdleBps: Number(snap.vault.minIdleBps),
      paused: snap.vault.paused,
      configurationDigest: chainConfigDigests['vault'] ?? '0x',
    },
    markets,
    dependencyGroups: [],
    withdrawals,
    gas,
    allLabels,
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
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
      actionDecision: {
        action: out.action,
        reasons: out.reasons,
        planId: out.plan?.planId ?? null,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}
