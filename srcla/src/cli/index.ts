/**
 * SRCLA CLI
 *
 * Command-line interface for SRCLA operations.
 */
import { loadConfig } from '../config.js';
import { CollectorOrchestrator, type OrchestratorConfig } from '../collector/orchestrator.js';
import { runEvaluation, type EvaluationConfig } from '../evaluation/runner/integration.js';
import { RegimeTracker } from '../regime/regime-tracker.js';
import { RegimeRepository } from '../regime/repository.js';
import { getPrisma, closePrisma, isConnected } from '../db/client.js';
import { RegimeState } from '../regime/types.js';

export interface CLIOptions {
  command: string;
  args?: Record<string, string>;
}

/**
 * Main CLI entry point
 */
export async function runCLI(options: CLIOptions): Promise<void> {
  const { command, args = {} } = options;

  switch (command) {
    case 'collect':
      await runCollect(args);
      break;
    case 'evaluate':
      await runEvaluate(args);
      break;
    case 'regime':
      await runRegimeStatus(args);
      break;
    case 'health':
      await runHealthCheck();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log('Available commands: collect, evaluate, regime, health');
      process.exit(1);
  }
}

/**
 * Run a single collection cycle
 */
async function runCollect(_args: Record<string, string>): Promise<void> {
  console.log('[CLI] Starting collection cycle...');

  const config = loadConfig();
  const collectorConfig: OrchestratorConfig = {
    vaultAddress: config.vaultAddress,
    strategyAddresses: {
      aave: config.aaveStrategyAddress,
      compound: config.compoundStrategyAddress,
      moonwell: config.moonwellStrategyAddress,
    },
    chainRpcUrl: config.baseRpcUrl,
    chainId: config.chainId,
    rewardAccountantAddress: config.rewardAccountantAddress ?? undefined,
    rewardExecutorAddress: config.rewardExecutorAddress ?? undefined,
  };

  const collector = new CollectorOrchestrator(collectorConfig);

  try {
    const result = await collector.runCollectionCycle();

    if (result.success) {
      console.log('[CLI] Collection cycle completed successfully');
      console.log(`  Block: ${result.blockNumber} (${result.blockHash.slice(0, 10)}...)`);
      console.log(`  Vault: ${result.vaultSnapshot?.totalAssets.toString() ?? 'N/A'} assets`);
      console.log(`  Strategies: ${result.strategySnapshots.length}`);
      console.log(`  Withdrawals: ${result.withdrawalEvents}`);
    } else {
      console.error('[CLI] Collection cycle completed with errors:');
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
    }
  } finally {
    collector.close();
    await closePrisma();
  }
}

/**
 * Run evaluation
 */
async function runEvaluate(args: Record<string, string>): Promise<void> {
  console.log('[CLI] Starting evaluation...');

  const startDate = args.start ? new Date(args.start) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = args.end ? new Date(args.end) : new Date();

  const config: EvaluationConfig = {
    startDate,
    endDate,
    marketIds: args.markets ? args.markets.split(',') : ['vault'],
    tiers: args.tiers ? args.tiers.split(',').map((t) => BigInt(t)) : [10_000n, 100_000n],
    coverageTarget: 0.95,
    significanceLevel: 0.05,
  };

  try {
    const result = await runEvaluation(config);

    console.log('\n=== Evaluation Results ===');
    console.log(`Evaluation ID: ${result.evaluationId}`);
    console.log(`Manifest Hash: ${result.manifestHash}`);
    console.log(`Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
    console.log(`\nRelease Gate: ${result.releaseGate.overallReason}`);

    for (const check of result.releaseGate.checks) {
      const status = check.pass ? '✅' : '❌';
      console.log(`  ${status} ${check.name}: ${check.value.toFixed(4)}`);
    }

    if (result.baselines) {
      console.log('\nBaselines:');
      for (const [key, baseline] of Object.entries(result.baselines)) {
        console.log(`  ${key}: ${(baseline.realizedNetApy * 100).toFixed(2)}% APY`);
      }
    }

    if (result.srcla) {
      console.log(`\nSRCLA: ${(result.srcla.realizedNetApy * 100).toFixed(2)}% APY`);
    }

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
    }
  } finally {
    await closePrisma();
  }
}

/**
 * Show regime status
 */
async function runRegimeStatus(args: Record<string, string>): Promise<void> {
  console.log('[CLI] Checking regime status...');

  const prisma = getPrisma();
  const regimeRepo = new RegimeRepository(prisma);
  const regimeTracker = new RegimeTracker();

  const marketIds = args.markets ? args.markets.split(',') : ['aave', 'compound', 'moonwell'];

  console.log('\n=== Regime Status ===');
  for (const marketId of marketIds) {
    const regime = await regimeRepo.loadRegime(marketId);
    const history = await regimeRepo.loadHistory(marketId, 7);

    const state = regimeTracker.getRegimeState(marketId) ?? RegimeState.STEADY;

    console.log(`\n${marketId}:`);
    console.log(`  State: ${state}`);
    console.log(`  Config Digest: ${regime?.configDigest ?? 'N/A'}`);
    console.log(`  Activated: ${regime?.activatedAt?.toISOString() ?? 'N/A'}`);
    console.log(`  Data Points: ${history.length}`);

    if (history.length > 0) {
      const avgRate = history.reduce((sum, h) => sum + Number(h.supplyRateE18), 0) / history.length / 1e18;
      console.log(`  Avg Supply Rate: ${(avgRate * 100).toFixed(2)}%`);
    }
  }

  const summary = regimeTracker.getSummary();
  console.log('\n=== Summary ===');
  console.log(`Total Markets: ${summary.totalMarkets}`);
  console.log(`In Cold Start: ${summary.inColdStart}`);
  console.log(`Eligible: ${summary.eligible}`);
  console.log(`By State:`, summary.byState);

  await closePrisma();
}

/**
 * Run health check
 */
async function runHealthCheck(): Promise<void> {
  console.log('[CLI] Running health check...\n');

  const checks: Array<{ name: string; passed: boolean; message: string }> = [];

  // Check database
  try {
    const connected = await isConnected();
    checks.push({
      name: 'Database',
      passed: connected,
      message: connected ? 'Connected' : 'Not connected',
    });
  } catch (error) {
    checks.push({
      name: 'Database',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Check config
  try {
    const config = loadConfig();
    checks.push({
      name: 'Configuration',
      passed: !!config.vaultAddress,
      message: config.vaultAddress ? `Vault: ${config.vaultAddress.slice(0, 10)}...` : 'Missing vault address',
    });
  } catch (error) {
    checks.push({
      name: 'Configuration',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Check Prisma
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    checks.push({
      name: 'Prisma',
      passed: true,
      message: 'Operational',
    });
  } catch (error) {
    checks.push({
      name: 'Prisma',
      passed: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  console.log('=== Health Check Results ===\n');
  for (const check of checks) {
    const status = check.passed ? '✅' : '❌';
    console.log(`${status} ${check.name}: ${check.message}`);
  }

  const allPassed = checks.every((c) => c.passed);
  console.log(`\nOverall: ${allPassed ? 'HEALTHY' : 'UNHEALTHY'}`);

  await closePrisma();
  process.exit(allPassed ? 0 : 1);
}

/**
 * Export data
 */
export async function exportData(outputPath: string, options: {
  marketId?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<void> {
  console.log(`[CLI] Exporting data to ${outputPath}...`);

  const prisma = getPrisma();
  const where: any = {};

  if (options.marketId) {
    where.marketId = options.marketId;
  }
  if (options.startDate || options.endDate) {
    where.timestamp = {};
    if (options.startDate) where.timestamp.gte = options.startDate;
    if (options.endDate) where.timestamp.lte = options.endDate;
  }

  const snapshots = await prisma.marketSnapshot.findMany({
    where,
    orderBy: { timestamp: 'asc' },
  });

  // Convert BigInt strings back to numbers for JSON
  const exportData = snapshots.map((s) => ({
    ...s,
    totalAssetsBase: BigInt(s.totalAssetsBase).toString(),
    idleBase: BigInt(s.idleBase).toString(),
  }));

  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

  console.log(`[CLI] Exported ${exportData.length} snapshots`);
  await closePrisma();
}
