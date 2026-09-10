/**
 * Evaluation dataset loading and manipulation
 */
import type { PrismaClient } from '@prisma/client';
import type { MarketSnapshot } from '../domain/snapshots.js';
import type { WithdrawalObservation } from '../policy/types.js';
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
      ...(s.reserveFactorBps !== null ? { reserveFactorBps: s.reserveFactorBps } : {}),
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
