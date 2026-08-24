/**
 * Withdrawal Repository
 *
 * Provides CRUD operations for withdrawal events.
 */
import type { PrismaClient } from '@prisma/client';
import type { WithdrawalEvent } from '../../collector/withdrawal-tracker.js';

export interface WithdrawalEventRecord {
  id: string;
  blockHash: string;
  timestamp: Date;
  sender: string;
  assets: string;
  shares: string;
  regimeId: string | null;
}

export class WithdrawalRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Store a withdrawal event
   */
  async create(event: WithdrawalEvent): Promise<WithdrawalEventRecord> {
    return this.prisma.withdrawalEvent.create({
      data: {
        blockHash: event.blockHash,
        timestamp: event.timestamp,
        sender: event.sender,
        assets: event.assets.toString(),
        shares: event.shares.toString(),
        regimeId: event.regimeId ?? null,
      },
    }) as unknown as WithdrawalEventRecord;
  }

  /**
   * Store multiple withdrawal events in a batch
   */
  async createMany(events: WithdrawalEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const result = await this.prisma.withdrawalEvent.createMany({
      data: events.map((e) => ({
        blockHash: e.blockHash,
        timestamp: e.timestamp,
        sender: e.sender,
        assets: e.assets.toString(),
        shares: e.shares.toString(),
        regimeId: e.regimeId ?? null,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Get withdrawal history for a market within a time window
   */
  async getHistory(
    marketId: string,
    windowDays: number
  ): Promise<bigint[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const events = await this.prisma.withdrawalEvent.findMany({
      where: {
        sender: marketId,
        timestamp: {
          gte: cutoff,
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    return events.map((e) => BigInt(e.assets));
  }

  /**
   * Get the last processed block number
   */
  async getLastProcessedBlock(): Promise<number> {
    const lastEvent = await this.prisma.withdrawalEvent.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    if (!lastEvent) return 0;

    const chainBlock = await this.prisma.chainBlock.findUnique({
      where: { blockHash: lastEvent.blockHash },
    });

    return chainBlock ? Number(chainBlock.blockNumber) : 0;
  }

  /**
   * Get withdrawal count within a time window
   */
  async getCountSince(marketId: string, since: Date): Promise<number> {
    return this.prisma.withdrawalEvent.count({
      where: {
        sender: marketId,
        timestamp: { gte: since },
      },
    });
  }

  /**
   * Get total withdrawal amount within a time window
   */
  async getTotalWithdrawn(
    marketId: string,
    windowDays: number
  ): Promise<bigint> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const events = await this.prisma.withdrawalEvent.findMany({
      where: {
        sender: marketId,
        timestamp: { gte: cutoff },
      },
      select: { assets: true },
    });

    return events.reduce((sum, e) => sum + BigInt(e.assets), 0n);
  }
}
