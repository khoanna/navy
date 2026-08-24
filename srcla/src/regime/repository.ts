/**
 * Regime Repository
 *
 * Provides persistence for regime tracking data.
 */
import { PrismaClient } from '@prisma/client';
import {
  RegimeState,
  type RegimeTransition,
  type RegimeConfig,
  type RegimeMetrics,
} from './types.js';

export class RegimeRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Save a regime transition
   */
  async saveTransition(transition: RegimeTransition): Promise<void> {
    await this.prisma.contractRegime.upsert({
      where: { digest: transition.configDigest },
      create: {
        digest: transition.configDigest,
        marketId: transition.marketId,
        activatedAt: transition.timestamp,
      },
      update: {},
    });
  }

  /**
   * Load regime config for a market
   */
  async loadRegime(marketId: string): Promise<RegimeConfig | null> {
    const regimes = await this.prisma.contractRegime.findMany({
      where: { marketId },
      orderBy: { activatedAt: 'desc' },
      take: 1,
    });

    if (regimes.length === 0) return null;

    const latest = regimes[0]!;
    return {
      marketId,
      currentState: RegimeState.STEADY,
      configDigest: latest.digest,
      activatedAt: latest.activatedAt,
      minObservationDays: 7,
      minCompletedOutcomes: 10,
    };
  }

  /**
   * Load metrics history for a market
   */
  async loadHistory(marketId: string, days: number): Promise<RegimeMetrics[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const snapshots = await this.prisma.marketSnapshot.findMany({
      where: {
        marketId,
        timestamp: { gte: cutoff },
      },
      orderBy: { timestamp: 'asc' },
    });

    return snapshots.map((s) => ({
      marketId,
      supplyRateE18: BigInt(s.supplyRateE18),
      utilizationE18: BigInt(s.utilizationE18),
      volatilityE18: 0n, // Calculated externally
      configDigest: s.configDigest,
      blockHash: s.blockHash,
      timestamp: s.timestamp,
    }));
  }

  /**
   * Get regime history
   */
  async getRegimeHistory(marketId: string): Promise<Array<{
    digest: string;
    activatedAt: Date;
  }>> {
    return this.prisma.contractRegime.findMany({
      where: { marketId },
      orderBy: { activatedAt: 'asc' },
      select: { digest: true, activatedAt: true },
    });
  }

  /**
   * Check if config digest exists (for transition detection)
   */
  async configDigestExists(marketId: string, digest: string): Promise<boolean> {
    const count = await this.prisma.contractRegime.count({
      where: { marketId, digest },
    });
    return count > 0;
  }
}
