/**
 * Evaluation dataset loading and manipulation
 */
import type { PrismaClient } from '@prisma/client';
import type { MarketSnapshot } from '../domain/snapshots.js';
import type { WithdrawalObservation } from '../policy/types.js';
import { protocolOf } from '../domain/protocol.js';
import { REGISTERED_ERAS, assertNotSealed, type EraTag } from './eras.js';

export interface TimeOrderedSnapshot {
  index: number;
  timestamp: Date;
  blockHash: string;
  snapshots: MarketSnapshot[];
}

export interface ForecastLabel {
  marketId: string;
  originTimestamp: Date;
  horizonSeconds: number;
  realizedReturn: bigint;
  availableAt: Date;
}

export interface EvaluationDataset {
  manifestId: string;
  snapshots: TimeOrderedSnapshot[];
  labels: ForecastLabel[];
  /**
   * The vault's real ERC-4626 `Withdraw` series over the window (§8.1's
   * W_H). Without it Q_beta(W_H) is identically zero and the reserve's
   * demand term can never bind, so the replay's redemptions have nothing to
   * be sized against. Optional only for hand-built test datasets.
   */
  withdrawals?: WithdrawalObservation[];
}

/**
 * VENUE-AWARE reserve-factor default, not generic (review round 2, fix 1).
 * Compound III (Comet) sets `reserveFactorBps` NULL BY DESIGN
 * (`collector/archive/calls.ts`) because its supply curve is already net of
 * reserves -- there is no separate reserve cut to apply, so 0 is exactly
 * right THERE. Defaulting a null reading to 0 for ANY other protocol would
 * silently assert "no reserve cut" for a venue that really does apply one
 * (Aave, Moonwell): this only ever substitutes for 'compound'; a null for
 * any other protocol is a genuine missing reading and stays `undefined`, so
 * `forecast/grid-sweep.ts`'s state-space candidate refuses that label rather
 * than guessing. PURE and exported so this venue-aware branch is unit
 * tested directly rather than only through a Prisma-backed `loadDataset`.
 */
export function resolveReserveFactorBps(marketId: string, storedReserveFactorBps: number | null): number | undefined {
  if (storedReserveFactorBps !== null) return storedReserveFactorBps;
  return protocolOf(marketId) === 'compound' ? 0 : undefined;
}

/**
 * Load dataset from database
 */
export async function loadDataset(
  prisma: PrismaClient,
  manifestId: string,
  startDate: Date,
  endDate: Date,
): Promise<EvaluationDataset> {
  const rawSnapshots = await prisma.marketSnapshot.findMany({
    where: {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { timestamp: 'asc' },
  });

  const rawLabels = await prisma.forecastLabel.findMany({
    where: {
      availableAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { availableAt: 'asc' },
  });

  // Group snapshots by timestamp
  const grouped = new Map<number, TimeOrderedSnapshot>();

  rawSnapshots.forEach((s) => {
    const key = s.timestamp.getTime();
    if (!grouped.has(key)) {
      grouped.set(key, {
        index: grouped.size,
        timestamp: s.timestamp,
        blockHash: s.blockHash,
        snapshots: [],
      });
    }
    const marketSnapshot: MarketSnapshot = {
      marketId: s.marketId,
      blockHash: s.blockHash,
      timestamp: s.timestamp,
      totalAssetsBase: BigInt(s.totalAssetsBase),
      idleBase: BigInt(s.idleBase),
      supplyRateE18: BigInt(s.supplyRateE18),
      utilizationE18: BigInt(s.utilizationE18),
      cashBase: BigInt(s.cashBase),
      borrowsBase: BigInt(s.borrowsBase),
      reservesBase: BigInt(s.reservesBase),
      capBps: s.capBps,
      paused: s.paused,
      configDigest: s.configDigest,
      // Additive: only present where the backfill collector resolved a
      // kinked-linear IRM reading (prisma/schema.prisma's irm* columns are
      // all nullable). Omitted entirely rather than defaulted, so an absent
      // reading stays absent through to `forecast/state-space.ts`'s callers
      // instead of silently becoming zero.
      ...(s.irmBaseRateWad !== null &&
      s.irmKinkRay !== null &&
      s.irmSlopeLowWad !== null &&
      s.irmSlopeHighWad !== null
        ? {
            irmBaseRateWad: BigInt(s.irmBaseRateWad),
            irmKinkRay: BigInt(s.irmKinkRay),
            irmSlopeLowWad: BigInt(s.irmSlopeLowWad),
            irmSlopeHighWad: BigInt(s.irmSlopeHighWad),
          }
        : {}),
      // Aave V3's two extra bounds. Same all-or-nothing rule as the
      // kinked-linear block above: a partially-resolved reading is omitted
      // rather than half-populated, so `decision-input.ts` can treat the
      // presence of the SET as the signal that a live Aave reading exists.
      ...(s.irmOptimalUtilizationRay !== null && s.irmMaxUtilizationRay !== null
        ? {
            irmOptimalUtilizationRay: BigInt(s.irmOptimalUtilizationRay),
            irmMaxUtilizationRay: BigInt(s.irmMaxUtilizationRay),
          }
        : {}),
      ...(resolveReserveFactorBps(s.marketId, s.reserveFactorBps) !== undefined
        ? { reserveFactorBps: resolveReserveFactorBps(s.marketId, s.reserveFactorBps)! }
        : {}),
    };
    grouped.get(key)!.snapshots.push(marketSnapshot);
  });

  const rawWithdrawals = await prisma.withdrawalEvent.findMany({
    where: { timestamp: { gte: startDate, lte: endDate } },
    orderBy: { timestamp: 'asc' },
  });

  return {
    manifestId,
    snapshots: Array.from(grouped.values()),
    withdrawals: rawWithdrawals.map((w) => ({
      timestampSeconds: Math.floor(w.timestamp.getTime() / 1000),
      // The column is `assets` (a decimal string), in USDC base units.
      assetsBase: BigInt(w.assets),
    })),
    labels: rawLabels.map((l) => ({
      marketId: l.marketId,
      originTimestamp: l.originTimestamp,
      horizonSeconds: l.horizonSeconds,
      realizedReturn: BigInt(l.realizedReturnE18),
      availableAt: l.availableAt,
    })),
  };
}

/**
 * Split dataset into calibration and evaluation sets
 */
export function splitDataset(
  dataset: EvaluationDataset,
  calibrationFraction: number = 0.7,
): { calibration: EvaluationDataset; evaluation: EvaluationDataset } {
  if (dataset.snapshots.length === 0) {
    return { calibration: dataset, evaluation: dataset };
  }

  const splitIndex = Math.floor(dataset.snapshots.length * calibrationFraction);
  const splitTime = dataset.snapshots[splitIndex]!.timestamp;

  return {
    calibration: {
      ...dataset,
      snapshots: dataset.snapshots.slice(0, splitIndex),
      labels: dataset.labels.filter((l) => l.availableAt <= splitTime),
    },
    evaluation: {
      ...dataset,
      snapshots: dataset.snapshots.slice(splitIndex),
      labels: dataset.labels.filter((l) => l.availableAt > splitTime),
    },
  };
}

/**
 * Create an empty dataset for testing
 */
export function createEmptyDataset(manifestId: string): EvaluationDataset {
  return {
    manifestId,
    snapshots: [],
    labels: [],
  };
}

/**
 * Create synthetic snapshots for testing
 */
export function createSyntheticDataset(
  manifestId: string,
  count: number,
  startDate: Date,
): EvaluationDataset {
  const snapshots: TimeOrderedSnapshot[] = [];
  const DAY = 86400 * 1000;

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(startDate.getTime() + i * DAY);
    const snapshot: MarketSnapshot = {
      marketId: 'compound',
      blockHash: `0x${i.toString(16).padStart(64, '0')}`,
      timestamp,
      totalAssetsBase: 1_000_000_000_000n,
      idleBase: 100_000_000_000n,
      supplyRateE18: 50_000_000_000_000_00n, // 5% APY
      utilizationE18: 800_000_000_000_000_000n, // 80% util
      cashBase: 200_000_000_000n,
      borrowsBase: 800_000_000_000n,
      reservesBase: 10_000_000_000n,
      capBps: 5000,
      paused: false,
      configDigest: '0x' + 'a'.repeat(64),
    };
    snapshots.push({
      index: i,
      timestamp,
      blockHash: snapshot.blockHash,
      snapshots: [snapshot],
    });
  }

  return { manifestId, snapshots, labels: [] };
}

// ---------------------------------------------------------------------------
// R30: a held-out era's rows must come from the archive backfill
// ---------------------------------------------------------------------------

/**
 * The subset of `MarketSnapshot` that says WHERE A ROW CAME FROM.
 *
 * These four groups of columns are written by `collector/archive/backfill.ts`
 * and by nothing else. The live path (`runtime/scheduler.ts`,
 * `collector/orchestrator.ts`) upserts state columns only: no `blockNumber`,
 * no `eraTag`, no `irm*`, and a `marketId` that is an ADAPTER ADDRESS rather
 * than a registered venue id.
 */
export interface ProvenanceRow {
  marketId: string;
  timestamp: Date;
  blockNumber: bigint | null;
  eraTag: string | null;
  irmAddress: string | null;
  irmBaseRateWad: string | null;
  irmKinkRay: string | null;
  irmSlopeLowWad: string | null;
  irmSlopeHighWad: string | null;
}

export interface ProvenanceViolation {
  marketId: string;
  timestampIso: string;
  reasons: string[];
}

/**
 * Rows in a held-out era that were NOT produced by the archive backfill.
 *
 * WHY THIS EXISTS (ruling R30). `heldout-b` is registered OPEN_ENDED, so its
 * window includes the present and the live collector is writing into it right
 * now. If the era were ever "populated" by relabelling those live rows instead
 * of by re-running `backfill.ts`, it would inherit a separate defect: the live
 * upsert persists only state columns, so every such row carries NULL `irm*`
 * and every venue would fall back to `DefaultConfigs` -- measured at 7.5689 pp
 * MAE for Compound and 7.2538 pp for Moonwell against mean rates near 4.9 pp.
 * The project's most valuable sealed era would then be built on placeholder
 * rate models, and nothing in the output would say so.
 *
 * A comment cannot prevent that and a runbook line cannot either, so this is a
 * predicate `loadEra` enforces. It is PURE, so the rule is unit-tested on
 * hand-built rows rather than only against a database.
 */
export function archiveProvenanceViolations(
  tag: EraTag,
  rows: readonly ProvenanceRow[],
): ProvenanceViolation[] {
  const out: ProvenanceViolation[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    if (r.eraTag !== tag) {
      reasons.push(
        `eraTag is ${r.eraTag === null ? 'NULL' : `'${r.eraTag}'`}, not '${tag}' -- the ` +
          `backfill stamps it at write time and the live upsert never does`,
      );
    }
    if (r.blockNumber === null) {
      reasons.push('no archive block height -- the live upsert keys on blockHash alone');
    }
    try {
      protocolOf(r.marketId);
    } catch {
      reasons.push(
        `'${r.marketId}' is not a registered venue id -- the live collector writes the ` +
          `adapter's ADDRESS here`,
      );
    }
    const irmMissing = (
      [
        ['irmAddress', r.irmAddress],
        ['irmBaseRateWad', r.irmBaseRateWad],
        ['irmKinkRay', r.irmKinkRay],
        ['irmSlopeLowWad', r.irmSlopeLowWad],
        ['irmSlopeHighWad', r.irmSlopeHighWad],
      ] as const
    )
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    if (irmMissing.length > 0) {
      reasons.push(
        `no rate-model parameters (${irmMissing.join(', ')} NULL) -- this row would be ` +
          `simulated on DefaultConfigs, a PLACEHOLDER model`,
      );
    }
    if (reasons.length > 0) {
      out.push({ marketId: r.marketId, timestampIso: r.timestamp.toISOString(), reasons });
    }
  }
  return out;
}

/**
 * Enforce R30 for one era. Throws, loudly, naming the offending rows.
 *
 * Deliberately NOT a warning and NOT a filter. Dropping the bad rows would
 * leave a shorter era that still reports a number, and a number computed on a
 * silently truncated held-out era is worse than no number: §11.5 forbids
 * adjusting a held-out run to avoid a failure, and quietly discarding part of
 * it is that adjustment.
 */
export async function assertArchiveProvenance(
  prisma: PrismaClient,
  tag: EraTag,
): Promise<void> {
  const era = REGISTERED_ERAS[tag];
  const rows = (await prisma.marketSnapshot.findMany({
    where: {
      timestamp: {
        gte: new Date(era.startSeconds * 1000),
        lte: new Date(Math.min(era.endSeconds, Math.floor(Date.now() / 1000)) * 1000),
      },
    },
    select: {
      marketId: true, timestamp: true, blockNumber: true, eraTag: true,
      irmAddress: true, irmBaseRateWad: true, irmKinkRay: true,
      irmSlopeLowWad: true, irmSlopeHighWad: true,
    },
    orderBy: { timestamp: 'asc' },
  })) as ProvenanceRow[];

  if (rows.length === 0) {
    throw new Error(
      `Era '${tag}' holds NO rows in ${new Date(era.startSeconds * 1000).toISOString()} .. ` +
        `${new Date(era.endSeconds * 1000).toISOString()}. An empty era is not an era with no ` +
        `events; it is a collection that never ran. Run 'pnpm backfill:history --era ${tag}'.`,
    );
  }

  const violations = archiveProvenanceViolations(tag, rows);
  if (violations.length === 0) return;

  const NL = String.fromCharCode(10);
  const shown = violations
    .slice(0, 5)
    .map((v) => `  ${v.timestampIso}  ${v.marketId}` + NL + v.reasons.map((r) => `      - ${r}`).join(NL));
  const more =
    violations.length > shown.length ? `${NL}  ... and ${violations.length - shown.length} more` : '';
  throw new Error(
    `Era '${tag}': ${violations.length} of ${rows.length} rows were NOT produced by the ` +
      `archive backfill (ruling R30).` + NL + shown.join(NL) + more + NL + NL +
      `A held-out era must be built by 'pnpm backfill:history --era ${tag}', which reads ` +
      `Comet, the Aave Pool and the mToken directly at each origin's own block and records the ` +
      `rate model in force there. It must NOT be built by promoting rows the live collector ` +
      `wrote: those carry no IRM parameters, so every venue would be replayed on ` +
      `DefaultConfigs and the run would report a yield claim measured against a placeholder ` +
      `rate model.`,
  );
}

/**
 * Load exactly one registered era, THROUGH the sealing guard.
 *
 * `purpose` is not decoration: `assertNotSealed` puts it in the error, so a
 * stack trace names what tried to read sealed data. Every fitting path --
 * the grid sweep, the artifact freeze, the `k` sweep -- must come through
 * here rather than calling `loadDataset` with hand-written dates, because a
 * date range is a value someone can get wrong quietly and an era tag is not.
 *
 * `allowSealed` exists for exactly one caller: the registered evaluation
 * itself, which is the moment the held-out data is legitimately opened. It
 * takes the same `purpose` string so the intent is recorded at the call site.
 */
export async function loadEra(
  prisma: PrismaClient,
  tag: EraTag,
  purpose: string,
  opts: { allowSealed?: boolean } = {},
): Promise<EvaluationDataset> {
  if (opts.allowSealed !== true) assertNotSealed(tag, purpose);

  // R30. Runs only for a HELD-OUT era, and only after the seal has been
  // legitimately opened above -- so the check reads provenance columns at the
  // one moment the era is meant to be read at all, and a violation fails the
  // registered run rather than being discovered in its published numbers.
  if (REGISTERED_ERAS[tag].sealed) await assertArchiveProvenance(prisma, tag);

  const era = REGISTERED_ERAS[tag];
  const start = new Date(era.startSeconds * 1000);
  // Held-out B's registered end is an open sentinel; clamp to now, since no
  // data exists past the present and a far-future bound would make an empty
  // result look like a collection failure.
  const end = new Date(Math.min(era.endSeconds, Math.floor(Date.now() / 1000)) * 1000);

  return loadDataset(prisma, `era:${tag}`, start, end);
}

/**
 * Origins from the `warmupDays` immediately BEFORE an era starts.
 *
 * These supply the history a policy would have carried across the era
 * boundary in production. They are never replayed, never scored and never
 * fitted on -- see `RegisteredEvaluationOptions.warmupSnapshots` for why that
 * is not look-ahead.
 *
 * Deliberately NOT behind `assertNotSealed`: the warm-up for a sealed era is
 * drawn from the era BEFORE it, which is calibration or burned data, and
 * loading it is exactly what a live deployment's own history would be.
 */
export async function loadWarmup(
  prisma: PrismaClient,
  tag: EraTag,
  warmupDays: number,
): Promise<TimeOrderedSnapshot[]> {
  if (warmupDays <= 0) return [];
  const era = REGISTERED_ERAS[tag];
  const start = new Date((era.startSeconds - warmupDays * 86_400) * 1000);
  const end = new Date((era.startSeconds - 1) * 1000);
  const ds = await loadDataset(prisma, `warmup:${tag}`, start, end);
  return ds.snapshots;
}
