/**
 * Evaluation dataset loading and manipulation
 */
import type { PrismaClient } from '@prisma/client';
import type { MarketSnapshot } from '../domain/snapshots.js';

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
    };
    grouped.get(key)!.snapshots.push(marketSnapshot);
  });

  return {
    manifestId,
    snapshots: Array.from(grouped.values()),
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
