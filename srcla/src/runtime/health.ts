import { ChainClient } from '../chain/client.js';
import { PrismaClient } from '@prisma/client';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  checks: {
    database: boolean;
    chain: boolean;
    collector: boolean;
  };
  lastSnapshot: Date | null;
  timestamp: Date;
}

export class HealthService {
  private client: ChainClient;
  private prisma: PrismaClient;

  constructor(client: ChainClient, prisma: PrismaClient) {
    this.client = client;
    this.prisma = prisma;
  }

  /**
   * Check overall health status
   */
  async check(): Promise<HealthStatus> {
    const [database, chain, lastSnapshot] = await Promise.all([
      this.checkDatabase(),
      this.checkChain(),
      this.getLastSnapshot(),
    ]);

    const allHealthy = database && chain;
    const status = allHealthy ? 'ok' : 'unhealthy';

    return {
      status,
      checks: {
        database,
        chain,
        collector: database, // Collector health implies database health
      },
      lastSnapshot,
      timestamp: new Date(),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkChain(): Promise<boolean> {
    try {
      await this.client.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  private async getLastSnapshot(): Promise<Date | null> {
    const snapshot = await this.prisma.marketSnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    return snapshot?.timestamp ?? null;
  }
}
