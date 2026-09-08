import { z } from 'zod';
import 'dotenv/config';

const DependencyGroupSchema = z.object({
  id: z.string(),
  capBps: z.bigint(),
  adapters: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)),
});

/**
 * Env vars that supply a GENUINE, oracle-sourced value for the four
 * GasObservation price inputs (Task 13). The keys are the SrclaConfig field
 * names; the values are their env vars. Declared once here so the schema
 * default, computePlaceholderPriceStatus, and parseSrclaConfig cannot list a
 * different set of fields from each other.
 *
 * NAMING IS LOAD-BEARING: these vars are named `SRCLA_REAL_*`, not
 * `SRCLA_PLACEHOLDER_*`, because setting one means "a real value has been
 * supplied" -- the opposite of what a `PLACEHOLDER`-prefixed name would
 * suggest. An earlier revision named them `SRCLA_PLACEHOLDER_*` and shipped
 * `.env.example` with all four SET to fabricated defaults; because
 * `computePlaceholderPriceStatus` treats "set" as "real", that shipped
 * `.env.example` silently disengaged the Task-13 execution guard on the
 * documented `cp .env.example .env` setup path. Do not reintroduce a
 * `PLACEHOLDER`-named var whose presence means "real value supplied".
 */
const REAL_PRICE_ENV_VARS: Record<string, string> = {
  l1BaseFeeWei: 'SRCLA_REAL_L1_BASE_FEE_WEI',
  l1BlobBaseFeeWei: 'SRCLA_REAL_L1_BLOB_BASE_FEE_WEI',
  ethUsdE8: 'SRCLA_REAL_ETH_USD_E8',
  usdcUsdE8: 'SRCLA_REAL_USDC_USD_E8',
};

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

  // Gas/price oracle placeholders (Task 13 - see task-13-report.md).
  // GasObservation (policy/types.ts) needs l2BaseFeeWei, l1BaseFeeWei,
  // l1BlobBaseFeeWei, ethUsdE8 and usdcUsdE8. Only l2BaseFeeWei is sourced
  // live from chain (ChainClient.getGasPrice(), wired in src/index.ts) --
  // this service has no L1-base-fee, L1-blob-base-fee, ETH/USD or USDC/USD
  // oracle wired yet. These four fields hold the HARDCODED FALLBACK values
  // used when no genuine value has been supplied via the corresponding
  // `SRCLA_REAL_*` env var (see REAL_PRICE_ENV_VARS above) -- a wrong ETH
  // price silently mis-scales every cost term in policy/steps/cost.ts, and
  // this plan has already found three separate unit/scale bugs of exactly
  // that kind. Replace with a real oracle before citing any cost-gate
  // result.
  placeholderL1BaseFeeWei: z.bigint().default(8_000_000_000n), // ~8 gwei on L1 - NOT read from chain
  placeholderL1BlobBaseFeeWei: z.bigint().default(10_000_000n), // ~0.01 gwei-equivalent - NOT read from chain
  placeholderEthUsdE8: z.bigint().default(350_000_000_000n), // $3,500.00, 8 decimals - NOT read from an oracle
  placeholderUsdcUsdE8: z.bigint().default(100_000_000n), // $1.00, 8 decimals - assumed peg, NOT read from an oracle

  // Derived from the four fields above (see computePlaceholderPriceStatus) -
  // NOT independently settable, and NOT a second hand-maintained flag: it is
  // recomputed from which SRCLA_REAL_* env vars were actually set every time
  // parseSrclaConfig() runs, so it cannot drift out of sync with them. This
  // is the single source of truth the Task-13 execution guard
  // (src/runtime/decision-driver.ts's assertExecutionAllowed) reads to
  // refuse handing a produced plan to any executor.
  // Defaults here are the fail-safe (execution-blocked) state and are only
  // ever reached if `srcla` itself were entirely absent from ConfigSchema's
  // input; loadConfig() always supplies both via parseSrclaConfig() /
  // computePlaceholderPriceStatus(), which is the real source of truth.
  placeholderPricesInUse: z.boolean().default(true),
  placeholderPriceFields: z.array(z.string()).default(Object.keys(REAL_PRICE_ENV_VARS)),
});

export const ConfigSchema = z.object({
  // Chain
  baseRpcUrl: z.string().url(),
  chainId: z.number().default(8453),

  // Contracts
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  aaveStrategyAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  compoundStrategyAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  moonwellStrategyAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  rewardAccountantAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  rewardExecutorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  usdcAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),

  // Database
  databaseUrl: z.string().url(),

  // HTTP
  httpHost: z.string().default('0.0.0.0'),
  httpPort: z.number().int().min(1).max(65535).default(3100),

  // Operator (mutation) listener. Only the PORT is configurable -- the host is
  // the OPERATOR_HTTP_HOST constant in src/http/server.ts (127.0.0.1), so no
  // env var can expose the mutation routes off-box.
  operatorHttpPort: z.number().int().min(1).max(65535).default(3101),

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

function isEnvSet(name: string, env: NodeJS.ProcessEnv): boolean {
  const v = env[name];
  return v !== undefined && v.trim() !== '';
}

/**
 * Derives which GasObservation price inputs are still running on their
 * hardcoded fallback (the operator never set the corresponding
 * SRCLA_REAL_* env var) and whether ANY of them are. Exported and
 * pure (takes `env` explicitly, defaulting to `process.env`) so it is unit
 * testable without booting the service.
 *
 * This is the single source of truth for "is this service's pricing real":
 * `placeholderPricesInUse` is derived here, not maintained as a separate
 * flag anywhere else, so it cannot drift out of sync with the four
 * placeholder fields it is computed from.
 */
export function computePlaceholderPriceStatus(
  env: NodeJS.ProcessEnv = process.env
): { placeholderPricesInUse: boolean; placeholderPriceFields: string[] } {
  const placeholderPriceFields = Object.entries(REAL_PRICE_ENV_VARS)
    .filter(([, envVar]) => !isEnvSet(envVar, env))
    .map(([field]) => field);
  return {
    placeholderPricesInUse: placeholderPriceFields.length > 0,
    placeholderPriceFields,
  };
}

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const raw = {
    baseRpcUrl: process.env.BASE_RPC_URL ?? 'http://127.0.0.1:8545',
    chainId: parseInt(process.env.CHAIN_ID ?? '8453', 10),
    vaultAddress: process.env.VAULT_ADDRESS ?? '',
    aaveStrategyAddress: process.env.AAVE_STRATEGY_ADDRESS ?? '',
    compoundStrategyAddress: process.env.COMPOUND_STRATEGY_ADDRESS ?? '',
    moonwellStrategyAddress: process.env.MOONWELL_STRATEGY_ADDRESS ?? '',
    rewardAccountantAddress: process.env.REWARD_ACCOUNTANT_ADDRESS,
    rewardExecutorAddress: process.env.REWARD_EXECUTOR_ADDRESS ?? '',
    usdcAddress: process.env.USDC_ADDRESS ?? '',
    databaseUrl: process.env.DATABASE_URL ?? '',
    httpHost: process.env.HTTP_HOST ?? '0.0.0.0',
    httpPort: parseInt(process.env.HTTP_PORT ?? '3100', 10),
    operatorHttpPort: parseInt(process.env.OPERATOR_HTTP_PORT ?? '3101', 10),
    collectorEnabled: process.env.COLLECTOR_ENABLED !== 'false',
    collectorIntervalMs: parseInt(process.env.COLLECTOR_INTERVAL_MS ?? '900000', 10),
    controllerEnabled: process.env.CONTROLLER_ENABLED !== 'false',
    controllerIntervalMs: parseInt(process.env.CONTROLLER_INTERVAL_MS ?? '3600000', 10),
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

    // Gas/price oracle placeholders (Task 13) - see SrclaConfigSchema comment.
    // Reads the SRCLA_REAL_* env vars (see REAL_PRICE_ENV_VARS) and falls
    // back to the hardcoded placeholder constant when unset.
    placeholderL1BaseFeeWei: BigInt(process.env.SRCLA_REAL_L1_BASE_FEE_WEI ?? '8000000000'),
    placeholderL1BlobBaseFeeWei: BigInt(process.env.SRCLA_REAL_L1_BLOB_BASE_FEE_WEI ?? '10000000'),
    placeholderEthUsdE8: BigInt(process.env.SRCLA_REAL_ETH_USD_E8 ?? '350000000000'),
    placeholderUsdcUsdE8: BigInt(process.env.SRCLA_REAL_USDC_USD_E8 ?? '100000000'),

    // Derived, not hand-maintained - see computePlaceholderPriceStatus.
    ...computePlaceholderPriceStatus(),
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
