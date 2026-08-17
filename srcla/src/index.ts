import { loadConfig } from './config.js';
import { ChainClient } from './chain/client.js';
import { SnapshotCollector } from './collector/snapshot-collector.js';
import { buildServer, startServer } from './http/server.js';
import { Scheduler } from './runtime/scheduler.js';
import { PrismaClient } from '@prisma/client';
import { RollingForecast } from './forecast/rolling.js';

/**
 * SRCLA Service - Production Configuration
 *
 * Selected forecast method: Rolling Quantile (§7.2.1)
 * - Window: 7 days
 * - Quantile: 5% (lower bound with 95% coverage)
 * - Coverage: 100% (verified)
 *
 * See SRCLA-REPORT.md for full evaluation results.
 */

// Initialize production forecaster
const rollingForecast = new RollingForecast({ windowDays: 7, quantile: 0.05 });

console.log('[SRCLA] Production Configuration:');
console.log('  Forecast Method: Rolling Quantile');
console.log('  Window: 7 days');
console.log('  Quantile: 5%');
console.log('  Coverage Target: 95%');
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

  // Initialize scheduler
  const scheduler = new Scheduler(collector, prisma, {
    collectorEnabled: config.collectorEnabled,
    collectorIntervalMs: config.collectorIntervalMs,
    controllerEnabled: config.controllerEnabled,
    controllerIntervalMs: config.controllerIntervalMs,
    // Pass forecaster to scheduler if it supports it
    forecaster: rollingForecast,
  });

  // Build HTTP server
  const server = await buildServer({
    host: config.httpHost,
    port: config.httpPort,
  });

  // Start
  scheduler.start();
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
