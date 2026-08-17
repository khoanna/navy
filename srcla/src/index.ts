import { loadConfig } from './config.js';
import { ChainClient } from './chain/client.js';
import { SnapshotCollector } from './collector/snapshot-collector.js';
import { buildServer, startServer } from './http/server.js';
import { Scheduler } from './runtime/scheduler.js';
import { PrismaClient } from '@prisma/client';
import { WEEKLY_MS } from './forecast/calibration.js';

/**
 * SRCLA Service - Production Configuration
 *
 * Selected forecast method: Walk-forward calibration (§7.2)
 * - Calibration interval: weekly
 * - Calibration window: 30 days
 * - Held-out window: 7 days
 * - Forecast horizon: 7 days
 *
 * See SRCLA-REPORT.md for full evaluation results.
 */

// Weekly calibration interval: 7 days
const CALIBRATION_INTERVAL_MS = WEEKLY_MS;
const CALIBRATION_WINDOW_DAYS = 30;
const HELD_OUT_WINDOW_DAYS = 7;
const FORECAST_HORIZON_SECONDS = 604800; // 7 days

console.log('[SRCLA] Production Configuration:');
console.log('  Calibration Interval: weekly');
console.log('  Calibration Window: 30 days');
console.log('  Held-out Window: 7 days');
console.log('  Forecast Horizon: 7 days');
console.log('  Artifact Hash: 5ed517d128bab909');

async function main(): Promise<void> {
  console.log('Starting SRCLA Service...');

  // Load configuration
  const config = loadConfig();
  console.log(`Chain ID: ${config.chainId}`);
  console.log(`Vault: ${config.vaultAddress}`);

  // Initialize clients
  const chainClient = new ChainClient({
    rpcUrl: config.baseRpcUrl,
    chainId: config.chainId,
  });

  const prisma = new PrismaClient();

  // Initialize collector
  const collector = new SnapshotCollector(chainClient, {
    vaultAddress: config.vaultAddress,
    strategyAddresses: {
      aave: config.aaveStrategyAddress,
      compound: config.compoundStrategyAddress,
      moonwell: config.moonwellStrategyAddress,
    },
    usdcAddress: config.usdcAddress,
  });

  // Initialize scheduler with calibration config
  const scheduler = new Scheduler(collector, prisma, {
    collectorEnabled: config.collectorEnabled,
    collectorIntervalMs: config.collectorIntervalMs,
    controllerEnabled: config.controllerEnabled,
    controllerIntervalMs: config.controllerIntervalMs,
    calibrationIntervalMs: CALIBRATION_INTERVAL_MS,
    calibrationWindowDays: CALIBRATION_WINDOW_DAYS,
    heldOutWindowDays: HELD_OUT_WINDOW_DAYS,
    forecastHorizonSeconds: FORECAST_HORIZON_SECONDS,
    artifactHash: '5ed517d128bab909',
  }, config.vaultAddress);

  // Build HTTP server
  const server = await buildServer({
    host: config.httpHost,
    port: config.httpPort,
  });

  // Start
  await scheduler.start();
  await startServer(server, { host: config.httpHost, port: config.httpPort });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    scheduler.stop();
    await server.close();
    await prisma.$disconnect();
    chainClient.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
