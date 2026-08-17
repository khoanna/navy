import { SnapshotCollector } from '../collector/snapshot-collector.js';
import { PrismaClient } from '@prisma/client';
import type { RollingForecast } from '../forecast/rolling.js';
import type { ForecastResult } from '../forecast/types.js';

export interface SchedulerConfig {
  collectorEnabled: boolean;
  collectorIntervalMs: number;
  controllerEnabled: boolean;
  controllerIntervalMs: number;
  /** Optional forecaster for production decisions */
  forecaster?: RollingForecast;
}

/**
 * Scheduler manages the SRCLA decision cycle:
 * 1. Snapshot collection (every 15 min by default)
 * 2. Market ranking via Rolling Quantile forecaster
 * 3. Decision execution (hourly by default)
 */
export class Scheduler {
  private collector: SnapshotCollector;
  private prisma: PrismaClient;
  private config: SchedulerConfig;
  private forecaster: RollingForecast | undefined;
  private timers: {
    collector?: ReturnType<typeof setInterval>;
    controller?: ReturnType<typeof setInterval>;
  } = {};
  private stopped = false;
  private marketHistories: Map<string, bigint[]> = new Map();

  constructor(collector: SnapshotCollector, prisma: PrismaClient, config: SchedulerConfig) {
    this.collector = collector;
    this.prisma = prisma;
    this.config = config;
    this.forecaster = config.forecaster ?? undefined;
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
        // Insert chain block record
        await this.prisma.chainBlock.upsert({
          where: { blockHash: snapshot.blockHash },
          create: {
            chainId: 8453, // Base chainId
            blockNumber: BigInt(snapshot.blockNumber),
            blockHash: snapshot.blockHash,
            timestamp: snapshot.timestamp,
          },
          update: {}, // No update needed
        });

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
    try {
      console.log('[Scheduler] Running SRCLA decision cycle...');

      // Collect fresh snapshot
      const snapshot = await this.collector.collect();
      if (!snapshot) {
        console.log('[Scheduler] No snapshot available, skipping decision cycle');
        return;
      }

      // Update market histories and compute forecasts
      const forecasts: ForecastResult[] = [];
      for (const strategy of snapshot.strategies) {
        // Update history
        const history = this.marketHistories.get(strategy.address) ?? [];
        history.push(strategy.supplyRate);
        // Keep last 30 days of history
        if (history.length > 30) {
          history.shift();
        }
        this.marketHistories.set(strategy.address, history);

        // Compute forecast using Rolling Quantile
        if (this.forecaster) {
          const forecast = this.forecaster.forecast(history, 604800); // 7-day horizon
          forecasts.push({
            ...forecast,
            marketId: strategy.address,
          });
        }
      }

      // Rank markets by lower-bound forecast
      const rankedMarkets = forecasts
        .sort((a, b) => (b.lowerReturn > a.lowerReturn ? 1 : -1))
        .map((f, i) => ({ ...f, rank: i + 1 }));

      if (rankedMarkets.length > 0) {
        console.log('[Scheduler] Market rankings by lower-bound forecast:');
        for (const market of rankedMarkets) {
          console.log(`  #${market.rank}: ${market.marketId} - lower bound: ${market.lowerReturn}`);
        }

        // Log top market for SRCLA decision
        const topMarket = rankedMarkets[0]!;
        console.log(`[SRCLA] Selected market: ${topMarket.marketId} (rank #${topMarket.rank})`);
      }

      // Decision logic would go here (Phase 5 implementation)
      // For now, just log the decision
      console.log(`[Scheduler] Decision cycle complete, ${forecasts.length} markets evaluated`);
    } catch (error) {
      console.error('[Scheduler] Controller error:', error);
    }
  }
}
