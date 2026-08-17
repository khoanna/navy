import { z } from 'zod';

const DependencyGroupSchema = z.object({
  id: z.string(),
  capBps: z.bigint(),
  adapters: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)),
});

/**
 * SRCLA Extended Configuration Schema
 *
 * Includes all new parameters for:
 * - Post-deposit simulation (§6.3-§6.5)
 * - Dynamic reserve (§8.1)
 * - Cost gate (§9.1)
 * - Regime tracking (§6.2, §7.3)
 * - Reward processing (§9.2-§9.4)
 * - Exhaustive enumeration (§8.2)
 */
export const SrclaConfigSchema = z.object({
  // Simulation (§6.3-§6.5)
  simulationEnabled: z.boolean().default(true),
  utilizationDelta: z.number().default(0.05), // 5% max utilization change per deposit
  compoundK: z.number().default(5), // Compound rate curve steepness

  // Reserve (§8.1)
  reserveFloorBps: z.number().default(500), // 5% floor reserve
  reserveQuantile: z.number().default(0.95), // 95th percentile withdrawal
  reserveHorizonHours: z.number().default(24), // 24-hour withdrawal horizon
  reserveStressBufferBps: z.number().default(200), // 2% stress buffer

  // Cost Gate (§9.1)
  costGateMinThreshold: z.bigint().default(1n), // 1 USDC minimum threshold
  costGateSlippageBps: z.number().default(50), // 0.5% slippage
  costGateMevBps: z.number().default(10), // 0.1% MEV impact
  costGateGasLimit: z.bigint().default(200_000n), // Gas limit for cost estimation

  // Regime (§6.2, §7.3)
  regimeVolatilityThreshold: z.number().default(0.02), // 2% rate volatility
  regimeCapacityThreshold: z.number().default(0.8), // 80% capacity threshold
  coldStartPeriodDays: z.number().default(7), // 7-day cold start
  coldStartCapacityFactor: z.number().default(0.5), // 50% capacity during cold start
  coldStartReserveFactor: z.number().default(1.5), // 150% reserve during cold start

  // Rewards (§9.2-§9.4)
  harvestMinValue: z.bigint().default(10_000_000n), // 10 USDC minimum harvest value
  harvestObservationPeriod: z.number().default(3600), // 1-hour observation period
  harvestValueHaircutBps: z.number().default(100), // 1% haircut for valuation
  priceStalenessSeconds: z.number().default(86400), // 24-hour price staleness

  // Enumeration (§8.2)
  allocationQuantum: z.bigint().default(1_000_000n), // 1 USDC quantum
  maxRegretBps: z.number().default(100), // 1% maximum regret threshold

  // Forecast
  minForecastCoverage: z.number().default(0.95), // 95% minimum coverage

  // Execution (§9.5)
  divestFailureStrategy: z.enum(['stop', 'continue']).default('stop'),
  deployFailureStrategy: z.enum(['stop', 'recover_idle']).default('recover_idle'),
});

export const ConfigSchema = z.object({
  // Chain
  baseRpcUrl: z.string().url(),
  sepoliaRpcUrl: z.string().url(),
  chainId: z.number().default(8453),

  // Contracts
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  aaveStrategyAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  compoundStrategyAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  moonwellStrategyAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  rewardExecutorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  usdcAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),

  // Database
  databaseUrl: z.string().url(),

  // HTTP
  httpHost: z.string().default('0.0.0.0'),
  httpPort: z.number().int().min(1).max(65535).default(3100),

  // Scheduler
  collectorEnabled: z.boolean().default(true),
  collectorIntervalMs: z.number().int().min(60000).default(900000), // 15 min
  controllerEnabled: z.boolean().default(true),
  controllerIntervalMs: z.number().int().min(60000).default(3600000), // 1 hour

  // Optimizer - Dependency Groups
  dependencyGroups: z.array(DependencyGroupSchema).default([]),

  // SRCLA Extended Config
  srcla: SrclaConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type DependencyGroup = z.infer<typeof DependencyGroupSchema>;
export type SrclaConfig = z.infer<typeof SrclaConfigSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const raw = {
    baseRpcUrl: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org',
    chainId: parseInt(process.env.CHAIN_ID ?? '8453', 10),
    vaultAddress: process.env.VAULT_ADDRESS ?? '',
    aaveStrategyAddress: process.env.AAVE_STRATEGY_ADDRESS ?? '',
    compoundStrategyAddress: process.env.COMPOUND_STRATEGY_ADDRESS ?? '',
    moonwellStrategyAddress: process.env.MOONWELL_STRATEGY_ADDRESS ?? '',
    rewardExecutorAddress: process.env.REWARD_EXECUTOR_ADDRESS ?? '',
    usdcAddress: process.env.USDC_ADDRESS ?? '',
    databaseUrl: process.env.DATABASE_URL ?? '',
    httpHost: process.env.HTTP_HOST ?? '0.0.0.0',
    httpPort: parseInt(process.env.HTTP_PORT ?? '3100', 10),
    collectorEnabled: process.env.COLLECTOR_ENABLED !== 'false',
    collectorIntervalMs: parseInt(process.env.COLLECTOR_INTERVAL_MS ?? '900000', 10),
    controllerEnabled: process.env.CONTROLLER_ENABLED !== 'false',
    controllerIntervalMs: parseInt(process.env.CONTROLLOR_INTERVAL_MS ?? '3600000', 10),
    dependencyGroups: parseDependencyGroupsEnv(),
    srcla: parseSrclaConfig(),
  };

  cachedConfig = ConfigSchema.parse(raw);
  return cachedConfig;
}

/**
 * Parse SRCLA extended configuration from environment
 */
function parseSrclaConfig(): SrclaConfig {
  return {
    // Simulation
    simulationEnabled: process.env.SRCLA_SIMULATION_ENABLED !== 'false',
    utilizationDelta: parseFloat(process.env.SRCLA_UTILIZATION_DELTA ?? '0.05'),
    compoundK: parseFloat(process.env.SRCLA_COMPOUND_K ?? '5'),

    // Reserve
    reserveFloorBps: parseInt(process.env.SRCLA_RESERVE_FLOOR_BPS ?? '500', 10),
    reserveQuantile: parseFloat(process.env.SRCLA_RESERVE_QUANTILE ?? '0.95'),
    reserveHorizonHours: parseInt(process.env.SRCLA_RESERVE_HORIZON_HOURS ?? '24', 10),
    reserveStressBufferBps: parseInt(process.env.SRCLA_RESERVE_STRESS_BUFFER_BPS ?? '200', 10),

    // Cost Gate
    costGateMinThreshold: BigInt(process.env.SRCLA_COST_GATE_MIN_THRESHOLD ?? '1'),
    costGateSlippageBps: parseInt(process.env.SRCLA_COST_GATE_SLIPPAGE_BPS ?? '50', 10),
    costGateMevBps: parseInt(process.env.SRCLA_COST_GATE_MEV_BPS ?? '10', 10),
    costGateGasLimit: BigInt(process.env.SRCLA_COST_GATE_GAS_LIMIT ?? '200000'),

    // Regime
    regimeVolatilityThreshold: parseFloat(process.env.SRCLA_REGIME_VOLATILITY_THRESHOLD ?? '0.02'),
    regimeCapacityThreshold: parseFloat(process.env.SRCLA_REGIME_CAPACITY_THRESHOLD ?? '0.8'),
    coldStartPeriodDays: parseInt(process.env.SRCLA_COLD_START_PERIOD_DAYS ?? '7', 10),
    coldStartCapacityFactor: parseFloat(process.env.SRCLA_COLD_START_CAPACITY_FACTOR ?? '0.5'),
    coldStartReserveFactor: parseFloat(process.env.SRCLA_COLD_START_RESERVE_FACTOR ?? '1.5'),

    // Rewards
    harvestMinValue: BigInt(process.env.SRCLA_HARVEST_MIN_VALUE ?? '10000000'),
    harvestObservationPeriod: parseInt(process.env.SRCLA_HARVEST_OBSERVATION_PERIOD ?? '3600', 10),
    harvestValueHaircutBps: parseInt(process.env.SRCLA_HARVEST_VALUE_HAIRCUT_BPS ?? '100', 10),
    priceStalenessSeconds: parseInt(process.env.SRCLA_PRICE_STALENESS_SECONDS ?? '86400', 10),

    // Enumeration
    allocationQuantum: BigInt(process.env.SRCLA_ALLOCATION_QUANTUM ?? '1000000'),
    maxRegretBps: parseInt(process.env.SRCLA_MAX_REGRET_BPS ?? '100', 10),

    // Forecast
    minForecastCoverage: parseFloat(process.env.SRCLA_MIN_FORECAST_COVERAGE ?? '0.95'),

    // Execution
    divestFailureStrategy: (process.env.SRCLA_DIVEST_FAILURE_STRATEGY as 'stop' | 'continue') ?? 'stop',
    deployFailureStrategy: (process.env.SRCLA_DEPLOY_FAILURE_STRATEGY as 'stop' | 'recover_idle') ?? 'recover_idle',
  };
}

function parseDependencyGroupsEnv(): DependencyGroup[] {
  const env = process.env.DEPENDENCY_GROUPS;
  if (!env) return [];

  try {
    const parsed = JSON.parse(env);
    return DependencyGroupSchema.array().parse(parsed);
  } catch {
    console.warn('Invalid DEPENDENCY_GROUPS env var, using empty groups');
    return [];
  }
}
