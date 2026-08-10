import { SnapshotCollector } from '../collector/snapshot-collector.js';
import { PrismaClient } from '@prisma/client';

export interface SchedulerConfig {
  collectorEnabled: boolean;
  collectorIntervalMs: number;
  controllerEnabled: boolean;
  controllerIntervalMs: number;
}

export class Scheduler {
  private collector: SnapshotCollector;
  private prisma: PrismaClient;
  private config: SchedulerConfig;
  private timers: {
    collector?: ReturnType<typeof setInterval>;
    controller?: ReturnType<typeof setInterval>;
  } = {};
  private stopped = false;

  constructor(collector: SnapshotCollector, prisma: PrismaClient, config: SchedulerConfig) {
    this.collector = collector;
    this.prisma = prisma;
    this.config = config;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.config.collectorEnabled) {
      this.startCollector();
    }

    if (this.config.controllerEnabled) {
      this.startController();
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.stopped = true;

    if (this.timers.collector) {
      clearInterval(this.timers.collector);
    }

    if (this.timers.controller) {
      clearInterval(this.timers.controller);
    }
  }

  private startCollector(): void {
    // Run immediately
    this.runCollector();

    // Then schedule
    this.timers.collector = setInterval(() => {
      if (!this.stopped) {
        this.runCollector();
      }
    }, this.config.collectorIntervalMs);
  }

  private async runCollector(): Promise<void> {
    try {
      console.log('[Scheduler] Running snapshot collection...');
      const snapshot = await this.collector.collect();

      if (snapshot) {
        // Store each strategy as a market snapshot
        for (const strategy of snapshot.strategies) {
          await this.prisma.marketSnapshot.upsert({
            where: {
              marketId_blockHash: {
                marketId: strategy.address,
                blockHash: snapshot.blockHash,
              },
            },
            create: {
              marketId: strategy.address,
              blockHash: snapshot.blockHash,
              timestamp: snapshot.timestamp,
              totalAssetsBase: strategy.totalAssets.toString(),
              idleBase: '0',
              supplyRateE18: strategy.supplyRate.toString(),
              utilizationE18: strategy.utilization.toString(),
              cashBase: strategy.cash.toString(),
              borrowsBase: '0',
              reservesBase: '0',
              capBps: 0,
              paused: strategy.paused,
              configDigest: strategy.configDigest,
            },
            update: {
              totalAssetsBase: strategy.totalAssets.toString(),
            },
          });
        }

        console.log(`[Scheduler] Collected snapshot at block ${snapshot.blockNumber}`);
      }
    } catch (error) {
      console.error('[Scheduler] Collector error:', error);
    }
  }

  private startController(): void {
    // Run immediately
    this.runController();

    // Then schedule
    this.timers.controller = setInterval(() => {
      if (!this.stopped) {
        this.runController();
      }
    }, this.config.controllerIntervalMs);
  }

  private async runController(): Promise<void> {
    // Controller logic will be implemented in Phase 5
    console.log('[Scheduler] Controller tick (placeholder)');
  }
}
