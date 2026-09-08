import { SnapshotCollector } from '../collector/snapshot-collector.js';
import { WithdrawalTracker } from '../collector/withdrawal-tracker.js';
import { PrismaClient } from '@prisma/client';
import {
  isCalibrationNeeded,
  runWalkForwardCalibration,
  getSelectedMethod,
  type CalibrationConfig,
} from '../forecast/calibration.js';
import { KeeperExecutor, createKeeperExecutor, type KeeperExecutionLock } from '../execution/keeper-executor.js';
import { assertExecutionAllowed, ExecutionBlockedError, type DecisionDriver, type PricingGuardStatus } from './decision-driver.js';

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
  /** Enable execution (default: true) */
  executionEnabled?: boolean;
  /**
   * Task 13 Finding 1: whether any GasObservation price input feeding the
   * decision kernel is a placeholder (config.ts's computePlaceholderPriceStatus).
   * Required (not optional / not defaulted here) so every construction site
   * must consciously supply it rather than the scheduler silently assuming
   * "safe to execute". runController() refuses to hand a produced plan to
   * any executor while placeholderPricesInUse is true.
   */
  pricingGuard: PricingGuardStatus;
  /**
   * Task 15 review, Finding 1: threaded straight through to
   * createKeeperExecutor / KeeperExecutorConfig.executionLock. Required
   * (not defaulted) for the same reason as pricingGuard — this package has
   * no database, so exactly one composition root decides what durable
   * lock/persist/release implementation backs live execution (or
   * consciously supplies UNCONFIGURED_EXECUTION_LOCK when execution is
   * disabled).
   */
  executionLock: KeeperExecutionLock;
}

/**
 * Scheduler manages the SRCLA decision cycle:
 * 1. Snapshot collection (every 15 min by default)
 * 2. Walk-forward calibration (weekly by default)
 * 3. Market ranking via selected forecaster
 * 4. Decision execution (hourly by default)
 *
 * This scheduler integrates with the KeeperExecutor to execute
 * plans on-chain when decisions are made.
 */
export class Scheduler {
  private collector: SnapshotCollector;
  private withdrawalTracker: WithdrawalTracker;
  private prisma: PrismaClient;
  private config: SchedulerConfig;
  private timers: {
    collector?: ReturnType<typeof setInterval>;
    controller?: ReturnType<typeof setInterval>;
    calibration?: ReturnType<typeof setInterval>;
  } = {};
  private stopped = false;
  private selectedMethod: string = 'rolling';
  private keeperExecutor: KeeperExecutor | null = null;
  /** The decision kernel driver (Task 13). Set via setDecisionDriver(); runController is a no-op until it is. */
  private decisionDriver: DecisionDriver | null = null;

  constructor(
    collector: SnapshotCollector,
    prisma: PrismaClient,
    config: SchedulerConfig,
    vaultAddress: string
  ) {
    this.collector = collector;
    this.prisma = prisma;
    this.config = config;
    this.withdrawalTracker = new WithdrawalTracker(collector['client'], vaultAddress, prisma);
  }

  /**
   * Wire the decision kernel driver (src/runtime/decision-driver.ts). Called
   * from src/index.ts once the driver's dependencies (origin loader,
   * artifact, decide() options, persistence) are constructed.
   */
  setDecisionDriver(driver: DecisionDriver): void {
    this.decisionDriver = driver;
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    // Load selected method from DB at startup
    await this.loadSelectedMethod();

    // Initialize keeper executor if execution is enabled
    if (this.config.executionEnabled !== false) {
      try {
        this.keeperExecutor = createKeeperExecutor(this.config.pricingGuard, this.config.executionLock);
        console.log(`[Scheduler] Keeper executor initialized for ${this.keeperExecutor.getAddress()}`);

        // Check keeper permissions
        const hasAllocator = await this.keeperExecutor.hasAllocatorRole();
        if (hasAllocator) {
          console.log('[Scheduler] Keeper has ALLOCATOR_ROLE');
        } else {
          console.warn('[Scheduler] WARNING: Keeper does NOT have ALLOCATOR_ROLE - execution will fail');
        }
      } catch (error) {
        console.error('[Scheduler] Failed to initialize keeper executor:', error);
        console.warn('[Scheduler] Continuing without execution - decisions will be logged only');
      }
    }

    if (this.config.collectorEnabled) {
      this.startCollector();
    }

    if (this.config.controllerEnabled) {
      await this.startController();
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

      console.log(`[Scheduler] Loaded selected method: ${this.selectedMethod}`);
    } catch (error) {
      // selectedMethod keeps its class-level default ('rolling') on
      // failure; decide()'s own forecast step (src/policy/steps/forecast.ts)
      // reads the calibrated artifact, not an in-memory forecaster instance
      // from here.
      console.warn('[Scheduler] Could not load selected method, using defaults:', error);
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

      // Update the selected method (persisted by runWalkForwardCalibration).
      this.selectedMethod = result.selectedMethod;

      if (this.selectedMethod === 'arx' && result.arxForecaster) {
        console.log('[Scheduler] Using calibrated ARX forecaster with residual-based lower bound');
      }

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
              borrowsBase: strategy.borrows.toString(),
              reservesBase: strategy.reserves.toString(),
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

  /**
   * Initialize and start the controller
   */
  private async startController(): Promise<void> {
    console.log('[Scheduler] Controller starting - decision cycles run through DecisionDriver / decide()');

    // Run immediately
    await this.runController();

    // Then schedule
    this.timers.controller = setInterval(() => {
      if (!this.stopped) {
        this.runController().catch((error) => {
          console.error('[Scheduler] Controller run error:', error);
        });
      }
    }, this.config.controllerIntervalMs);
  }

  /**
   * Run one SRCLA decision cycle: collect the finalized origin, run it
   * through the decide() kernel via DecisionDriver, and log the result.
   *
   * This replaced a hardcoded heuristic (highest lower-bound forecast, 5%
   * idle threshold, 80% target, 10% divest, 100 USDC drift threshold) that
   * never called the paper-conformant decide() kernel in src/policy at all.
   * DecisionDriver contains no allocation logic itself — it collects, calls
   * decide(), and persists — so this method stays a thin wrapper around it.
   */
  private async runController(): Promise<void> {
    if (!this.decisionDriver) {
      console.log('[Scheduler] No decision driver configured; skipping cycle');
      return;
    }
    try {
      const out = await this.decisionDriver.runCycle();
      if (out === null) {
        console.log('[Scheduler] No finalized origin available');
        return;
      }
      console.log(`[Scheduler] decision ${out.decisionHash} action=${out.action} reasons=${out.reasons.join('; ')}`);

      if (out.action === 'rebalance' && out.plan) {
        // Finding-1 execution guard (Task 13): assertExecutionAllowed is the
        // sanctioned gate for handing a produced plan to any executor. It
        // throws ExecutionBlockedError while placeholderPricesInUse is true
        // (no real ETH/USD, USDC/USD, L1-base-fee or L1-blob-base-fee
        // oracle wired — see config.ts's computePlaceholderPriceStatus).
        // Deciding, persisting and logging already happened above via
        // decisionDriver.runCycle() and are unaffected by this — only
        // execution is blocked.
        try {
          assertExecutionAllowed(this.config.pricingGuard);
        } catch (error) {
          if (error instanceof ExecutionBlockedError) {
            console.warn(`[Scheduler] plan ${out.plan.planId}: ${error.message}`);
            return;
          }
          throw error;
        }

        // TASK 14: the sanctioned call site. KeeperExecutor.executePlanDraft
        // (src/execution/keeper-executor.ts) is the only place a produced
        // plan is handed to the vault — it independently re-asserts
        // assertExecutionAllowed as its own first statement, so this call
        // cannot submit a transaction even if the guard above were ever
        // removed or this branch reached some other way. Do not move plan
        // execution outside of this branch, and do not call any other
        // executor method for plan submission.
        console.log(
          `[Scheduler] plan ${out.plan.planId} ready with ${out.plan.actions.length} action(s) ` +
          `(reserve=${out.reserve.requiredBase}) - submitting`
        );

        if (!this.keeperExecutor) {
          console.warn(`[Scheduler] plan ${out.plan.planId}: no keeper executor configured; skipping execution`);
          return;
        }

        const result = await this.keeperExecutor.executePlanDraft(out.plan);
        if (result.success) {
          console.log(
            `[Scheduler] plan ${result.planId ?? out.plan.planId} executed: ${result.txHashes.length} tx(s) ` +
            `[${result.txHashes.join(', ')}]`
          );
        } else {
          console.error(
            `[Scheduler] plan ${result.planId ?? out.plan.planId} execution failed: ${result.errors.join('; ')}`
          );
        }
      }
    } catch (error) {
      console.error('[Scheduler] Controller error:', error);
    }
  }

  /**
   * Trigger a manual decision cycle.
   * This endpoint allows the backend to force a rebalance evaluation.
   *
   * @param force - If true, skip the decision interval check and force immediate evaluation
   */
  async trigger(force = false): Promise<{ triggered: boolean; message: string }> {
    try {
      // Check if enough time has passed since last decision (unless force is true)
      if (!force) {
        const lastDecision = await this.prisma.decision.findFirst({
          orderBy: { timestamp: 'desc' },
        });

        if (lastDecision) {
          const timeSinceLastDecision = Date.now() - lastDecision.timestamp.getTime();
          const minInterval = this.config.controllerIntervalMs;

          if (timeSinceLastDecision < minInterval) {
            const remainingSeconds = Math.ceil((minInterval - timeSinceLastDecision) / 1000);
            return {
              triggered: false,
              message: `Decision interval not elapsed. Try again in ${remainingSeconds} seconds.`,
            };
          }
        }
      }

      // Run the controller
      await this.runController();

      return {
        triggered: true,
        message: 'Decision cycle triggered successfully.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Scheduler] Trigger failed:', message);
      return {
        triggered: false,
        message: `Trigger failed: ${message}`,
      };
    }
  }
}
