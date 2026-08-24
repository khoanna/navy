/**
 * Snapshot Repository
 *
 * Provides CRUD operations for market and vault snapshots.
 */

export interface SnapshotRecord {
  id: string;
  marketId: string;
  blockHash: string;
  timestamp: Date;
  totalAssetsBase: string;
  idleBase: string;
  supplyRateE18: string;
  utilizationE18: string;
  cashBase: string;
  borrowsBase: string;
  reservesBase: string;
  capBps: number;
  paused: boolean;
  configDigest: string;
  regimeId: string | null;
}

export interface MarketSnapshotData {
  marketId: string;
  supplyRateE18: bigint;
  utilizationE18: bigint;
  cashBase: bigint;
  borrowsBase: bigint;
  reservesBase: bigint;
  totalAssetsBase: bigint;
  capBps: number;
  paused: boolean;
  configDigest: string;
}

export class SnapshotRepository {
  constructor(private prisma: any) {}

  /**
   * Store a market snapshot
   */
  async create(snapshot: MarketSnapshotData & { blockHash: string; timestamp: Date }): Promise<SnapshotRecord> {
    return this.prisma.marketSnapshot.create({
      data: {
        marketId: snapshot.marketId,
        blockHash: snapshot.blockHash,
        timestamp: snapshot.timestamp,
        totalAssetsBase: snapshot.totalAssetsBase.toString(),
        idleBase: snapshot.cashBase.toString(),
        supplyRateE18: snapshot.supplyRateE18.toString(),
        utilizationE18: snapshot.utilizationE18.toString(),
        cashBase: snapshot.cashBase.toString(),
        borrowsBase: snapshot.borrowsBase.toString(),
        reservesBase: snapshot.reservesBase.toString(),
        capBps: snapshot.capBps,
        paused: snapshot.paused,
        configDigest: snapshot.configDigest,
      },
    });
  }

  /**
   * Store multiple snapshots in a batch
   */
  async createMany(snapshots: (MarketSnapshotData & { blockHash: string; timestamp: Date })[]): Promise<number> {
    if (snapshots.length === 0) return 0;

    const result = await this.prisma.marketSnapshot.createMany({
      data: snapshots.map((s) => ({
        marketId: s.marketId,
        blockHash: s.blockHash,
        timestamp: s.timestamp,
        totalAssetsBase: s.totalAssetsBase.toString(),
        idleBase: s.cashBase.toString(),
        supplyRateE18: s.supplyRateE18.toString(),
        utilizationE18: s.utilizationE18.toString(),
        cashBase: s.cashBase.toString(),
        borrowsBase: s.borrowsBase.toString(),
        reservesBase: s.reservesBase.toString(),
        capBps: s.capBps,
        paused: s.paused,
        configDigest: s.configDigest,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Get latest snapshot for a market
   */
  async getLatest(marketId: string): Promise<SnapshotRecord | null> {
    return this.prisma.marketSnapshot.findFirst({
      where: { marketId },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * Get snapshots for a market within a time window
   */
  async getHistory(
    marketId: string,
    windowDays: number
  ): Promise<SnapshotRecord[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    return this.prisma.marketSnapshot.findMany({
      where: {
        marketId,
        timestamp: { gte: cutoff },
      },
      orderBy: { timestamp: 'asc' },
    });
  }

  /**
   * Get snapshots for a market between two dates
   */
  async getRange(
    marketId: string,
    startDate: Date,
    endDate: Date
  ): Promise<SnapshotRecord[]> {
    return this.prisma.marketSnapshot.findMany({
      where: {
        marketId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { timestamp: 'asc' },
    });
  }

  /**
   * Get rate history for forecasting
   */
  async getRateHistory(
    marketId: string,
    limit: number = 30
  ): Promise<bigint[]> {
    const snapshots = await this.prisma.marketSnapshot.findMany({
      where: { marketId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return snapshots
      .map((s: SnapshotRecord) => BigInt(s.supplyRateE18))
      .reverse();
  }

  /**
   * Get all markets with latest snapshots
   */
  async getAllMarketsWithLatest(): Promise<SnapshotRecord[]> {
    const markets = await this.prisma.marketSnapshot.groupBy({
      by: ['marketId'],
      _max: { timestamp: true },
    });

    const result: SnapshotRecord[] = [];
    for (const market of markets) {
      const latest = await this.prisma.marketSnapshot.findFirst({
        where: {
          marketId: market.marketId,
          timestamp: market._max.timestamp ?? undefined,
        },
      });
      if (latest) result.push(latest);
    }

    return result;
  }
}
