import { SnapshotCollector } from '../collector/snapshot-collector.js';
import { WithdrawalTracker } from '../collector/withdrawal-tracker.js';
import { PrismaClient } from '@prisma/client';
import type { RollingForecast } from '../forecast/rolling.js';
import type { ForecastResult } from '../forecast/types.js';
import {
  isCalibrationNeeded,
  runWalkForwardCalibration,
  getSelectedMethod,
  createForecaster,
  type CalibrationConfig,
} from '../forecast/calibration.js';

export interface SchedulerConfig {
  collectorEnabled: boolean;
  collectorIntervalMs: number;
  controllerEnabled: boolean;
  controllerIntervalMs: number;
  /** Calibration interval in milliseconds (default: weekly) */
  calibrationIntervalMs: number;
  /** Calibration window in days (training data) */
  calibrationWindowDays: number;
  /** Held-out window in days (evaluation data) */
  heldOutWindowDays: number;
  /** Forecast horizon in seconds (default: 7 days) */
  forecastHorizonSeconds: number;
  /** Artifact hash for calibration traceability */
  artifactHash: string;
  /** Chain ID for block records */
  chainId: number;
  /** Optional forecaster for production decisions (deprecated: use selected method from DB) */
  forecaster?: RollingForecast;
}

/**
 * Scheduler manages the SRCLA decision cycle:
 * 1. Snapshot collection (every 15 min by default)
 * 2. Walk-forward calibration (weekly by default)
 * 3. Market ranking via selected forecaster
 * 4. Decision execution (hourly by default)
 */
export class Scheduler {
  private collector: SnapshotCollector;
  private withdrawalTracker: WithdrawalTracker;
  private prisma: PrismaClient;
  private config: SchedulerConfig;
  private forecaster: RollingForecast | undefined;
  private timers: {
    collector?: ReturnType<typeof setInterval>;
    controller?: ReturnType<typeof setInterval>;
    calibration?: ReturnType<typeof setInterval>;
  } = {};
  private stopped = false;
  private marketHistories: Map<string, bigint[]> = new Map();
  private selectedMethod: string = 'rolling';
  private selectedConfig: Record<string, unknown> = { windowDays: 30, quantile: 0.10 };

  constructor(
    collector: SnapshotCollector,
    prisma: PrismaClient,
    config: SchedulerConfig,
    vaultAddress: string
  ) {
    this.collector = collector;
    this.prisma = prisma;
    this.config = config;
    this.forecaster = config.forecaster ?? undefined;
    this.withdrawalTracker = new WithdrawalTracker(collector['client'], vaultAddress, prisma);
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    // Load selected method from DB at startup
    await this.loadSelectedMethod();

    if (this.config.collectorEnabled) {
      this.startCollector();
    }

    if (this.config.controllerEnabled) {
      this.startController();
    }

    // Start calibration timer
    this.startCalibration();
  }

  /**
   * Load the currently selected forecast method from the database.
   */
  private async loadSelectedMethod(): Promise<void> {
    try {
      const selected = await getSelectedMethod(this.prisma);
      this.selectedMethod = selected.method;
      this.selectedConfig = selected.config;

      // Initialize forecaster from selected method
      const forecasterInstance = createForecaster(this.selectedMethod, this.selectedConfig) as RollingForecast;
      this.forecaster = forecasterInstance;

      console.log(`[Scheduler] Loaded selected method: ${this.selectedMethod}`);
    } catch (error) {
      console.warn('[Scheduler] Could not load selected method, using defaults:', error);
      // Fallback: use rolling with default config
      const { RollingForecast } = await import('../forecast/rolling.js');
      this.forecaster = new RollingForecast({ windowDays: 30, quantile: 0.10 });
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

    if (this.timers.calibration) {
      clearInterval(this.timers.calibration);
    }
  }

  /**
   * Start the calibration timer.
   * Calibration runs on the configured interval (default: weekly).
   */
  private startCalibration(): void {
    // Run initial calibration check
    this.runCalibration();

    // Schedule periodic calibration
    this.timers.calibration = setInterval(() => {
      if (!this.stopped) {
        this.runCalibration();
      }
    }, this.config.calibrationIntervalMs);
  }

  /**
   * Run calibration if needed.
   * Checks if the last calibration is older than the calibration interval.
   */
  private async runCalibration(): Promise<void> {
    try {
      // Check if calibration is needed
      const needed = await isCalibrationNeeded(
        this.prisma,
        this.config.calibrationIntervalMs
      );

      if (!needed) {
        console.log('[Scheduler] Calibration not needed yet');
        return;
      }

      console.log('[Scheduler] Running walk-forward calibration...');

      const calibrationConfig: CalibrationConfig = {
        calibrationWindowDays: this.config.calibrationWindowDays,
        heldOutWindowDays: this.config.heldOutWindowDays,
        horizonSeconds: this.config.forecastHorizonSeconds,
        artifactHash: this.config.artifactHash,
      };

      const result = await runWalkForwardCalibration(this.prisma, calibrationConfig);

      // Update the selected method and forecaster
      this.selectedMethod = result.selectedMethod;
      const calibrations = await getSelectedMethod(this.prisma);
      this.selectedConfig = calibrations.config;

      // Re-initialize forecaster with new config
      const forecasterInstance = createForecaster(this.selectedMethod, this.selectedConfig) as RollingForecast;
      this.forecaster = forecasterInstance;

      console.log(`[Scheduler] Calibration complete. Selected method: ${this.selectedMethod}`);
    } catch (error) {
      console.error('[Scheduler] Calibration error:', error);
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
            chainId: this.config.chainId, // Use configured chain ID (8453 for Base/Anvil)
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

        // Collect withdrawal events since last processed block
        const lastBlock = await this.withdrawalTracker.getLastProcessedBlock();
        if (lastBlock > 0) {
          const withdrawalEvents = await this.withdrawalTracker.collectSince(lastBlock);
          if (withdrawalEvents.length > 0) {
            console.log(`[Scheduler] Collected ${withdrawalEvents.length} withdrawal events`);
          }
        } else {
          // First run: collect from block 0 (genesis) with a reasonable limit
          // In production, set a reasonable start block based on vault deployment
          console.log('[Scheduler] No previous withdrawal data, skipping retroactive collection');
        }
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

        // Compute forecast using the selected method
        if (this.forecaster) {
          const forecast = this.forecaster.forecast(history, this.config.forecastHorizonSeconds);
          forecasts.push({
            ...forecast,
            marketId: strategy.address,
            method: this.selectedMethod,
            config: this.selectedConfig,
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
