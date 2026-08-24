#!/usr/bin/env tsx
/**
 * Scheduled Collection Script
 *
 * Runs collection cycles on a configurable schedule.
 * Supports both interval-based and cron-based scheduling.
 */
import { CollectorOrchestrator, type CollectorConfig } from '../src/collector/orchestrator.js';
import { loadConfig } from '../src/config.js';
import { closePrisma } from '../src/db/client.js';

interface ScheduleOptions {
  /** Interval in milliseconds (default: 15 minutes) */
  intervalMs?: number;
  /** Maximum consecutive failures before stopping */
  maxFailures?: number;
  /** Whether to run immediately on start */
  runImmediately?: boolean;
}

/**
 * Run scheduled collection
 */
async function runScheduledCollection(options: ScheduleOptions = {}): Promise<void> {
  const {
    intervalMs = 15 * 60 * 1000, // 15 minutes
    maxFailures = 10,
    runImmediately = true,
  } = options;

  console.log('[Scheduler] Starting scheduled collection');
  console.log(`  Interval: ${intervalMs / 1000 / 60} minutes`);
  console.log(`  Max failures: ${maxFailures}`);

  const config = loadConfig();
  const collectorConfig: CollectorConfig = {
    vaultAddress: config.vaultAddress,
    strategyAddresses: {
      aave: config.aaveStrategyAddress,
      compound: config.compoundStrategyAddress,
      moonwell: config.moonwellStrategyAddress,
    },
    chainRpcUrl: config.baseRpcUrl,
    chainId: config.chainId,
    rewardAccountantAddress: config.rewardAccountantAddress,
    rewardExecutorAddress: config.rewardExecutorAddress,
  };

  const collector = new CollectorOrchestrator(collectorConfig);

  let consecutiveFailures = 0;
  let lastRunTime = 0;

  const runCycle = async (): Promise<void> => {
    const startTime = Date.now();
    console.log(`\n[Scheduler] Starting cycle at ${new Date().toISOString()}`);

    try {
      const result = await collector.runCollectionCycle();

      if (result.success) {
        console.log(`[Scheduler] Cycle completed successfully in ${Date.now() - startTime}ms`);
        console.log(`  Block: ${result.blockNumber}`);
        console.log(`  Strategies: ${result.strategySnapshots.length}`);
        console.log(`  Withdrawals: ${result.withdrawalEvents}`);
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        console.error(`[Scheduler] Cycle completed with errors (failure ${consecutiveFailures}/${maxFailures}):`);
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
      }
    } catch (error) {
      consecutiveFailures++;
      console.error(`[Scheduler] Cycle failed (failure ${consecutiveFailures}/${maxFailures}):`, error);
    }

    lastRunTime = Date.now();

    // Check if we should stop
    if (consecutiveFailures >= maxFailures) {
      console.error(`[Scheduler] Maximum consecutive failures reached. Stopping.`);
      collector.close();
      await closePrisma();
      process.exit(1);
    }
  };

  // Run immediately if requested
  if (runImmediately) {
    await runCycle();
  }

  // Schedule next run
  const scheduleNext = (): void => {
    const now = Date.now();
    const elapsed = now - lastRunTime;
    const delay = Math.max(0, intervalMs - elapsed);

    console.log(`[Scheduler] Next cycle in ${Math.round(delay / 1000 / 60)} minutes`);

    setTimeout(async () => {
      await runCycle();
      scheduleNext();
    }, delay);
  };

  // Handle graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\n[Scheduler] Shutting down...');
    collector.close();
    await closePrisma();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start scheduling
  scheduleNext();
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: ScheduleOptions = {
  intervalMs: parseInt(args.find(a => a.startsWith('--interval='))?.split('=')[1] ?? '900000'),
  maxFailures: parseInt(args.find(a => a.startsWith('--max-failures='))?.split('=')[1] ?? '10'),
  runImmediately: !args.includes('--no-immediate'),
};

runScheduledCollection(options).catch((error) => {
  console.error('[Scheduler] Fatal error:', error);
  process.exit(1);
});
