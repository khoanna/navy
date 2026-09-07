import { loadConfig } from './config.js';
import { ChainClient } from './chain/client.js';
import { SnapshotCollector } from './collector/snapshot-collector.js';
import { buildServer, startServer } from './http/server.js';
import { Scheduler } from './runtime/scheduler.js';
import { DecisionDriver, buildRawOriginFromCollector, persistDecisionOutput } from './runtime/decision-driver.js';
import { loadBootstrapArtifact } from './policy/artifact.js';
import { DEFAULT_DECIDE_OPTS, type DecideOpts } from './policy/decide.js';
import type { GasObservation } from './policy/types.js';
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
    chainId: config.chainId,
    // Task 13 Finding 1: derived from which SRCLA_PLACEHOLDER_* env vars
    // were actually set (config.ts's computePlaceholderPriceStatus) -- the
    // scheduler refuses to hand a produced plan to any executor while this
    // is true.
    pricingGuard: {
      placeholderPricesInUse: config.srcla.placeholderPricesInUse,
      placeholderPriceFields: config.srcla.placeholderPriceFields,
    },
  }, config.vaultAddress);

  if (config.srcla.placeholderPricesInUse) {
    console.warn(
      `[SRCLA] EXECUTION BLOCKED: placeholder price input(s) in use: ` +
      `${config.srcla.placeholderPriceFields.join(', ')}. Deciding, persisting and logging will proceed ` +
      'normally, but no produced plan will be handed to an executor until real values are set for ' +
      'these (see SRCLA_PLACEHOLDER_* in .env.example).'
    );
  }

  // Wire the decision kernel (Task 13): DecisionDriver replaces the old
  // hardcoded scheduler heuristic with decide() (src/policy/decide.ts).
  //
  // KNOWN GAP inherited from policy/artifact.ts: the Phase 1 bootstrap
  // artifact ships pinnedConfigDigests: {} (empty), so until a later task
  // populates it from chain, every market is admission-rejected
  // (CONFIG_DIGEST_UNPINNED) and the kernel holds. That is correct-by-design
  // for a placeholder artifact -- see policy/artifact.ts's comment.
  const artifact = loadBootstrapArtifact();
  const decideOpts: DecideOpts = {
    ...DEFAULT_DECIDE_OPTS,
    plan: {
      ...DEFAULT_DECIDE_OPTS.plan,
      // DEFAULT_DECIDE_OPTS.plan.vaultAddress/chainId/assetAddress are
      // placeholder constants (decide.ts keeps them as a generic default for
      // unit tests). Wire the real deployed values for the running service.
      chainId: config.chainId,
      vaultAddress: config.vaultAddress,
      assetAddress: config.usdcAddress,
    },
  };

  const decisionDriver = new DecisionDriver({
    artifact,
    opts: decideOpts,
    loadOrigin: async () => {
      const gas: GasObservation = {
        // REAL: read live off the configured L2 RPC.
        l2BaseFeeWei: await chainClient.getGasPrice(),
        // PLACEHOLDERS pending a real oracle - see config.ts's
        // SrclaConfigSchema comment on these four fields.
        l1BaseFeeWei: config.srcla.placeholderL1BaseFeeWei,
        l1BlobBaseFeeWei: config.srcla.placeholderL1BlobBaseFeeWei,
        ethUsdE8: config.srcla.placeholderEthUsdE8,
        usdcUsdE8: config.srcla.placeholderUsdcUsdE8,
      };
      // chainConfigDigests is empty: no per-venue/vault configuration-digest
      // oracle is wired yet either. buildRawOriginFromCollector falls back
      // to each market's live on-chain configDigest when a key is absent.
      return buildRawOriginFromCollector(collector, prisma, gas, {});
    },
    persist: (out, input) => persistDecisionOutput(prisma, artifact, out, input),
  });
  scheduler.setDecisionDriver(decisionDriver);

  // Build HTTP server with scheduler for trigger endpoint
  const server = await buildServer({
    host: config.httpHost,
    port: config.httpPort,
  }, scheduler);

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
