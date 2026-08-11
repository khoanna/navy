import { z } from 'zod';

const DependencyGroupSchema = z.object({
  id: z.string(),
  capBps: z.bigint(),
  adapters: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)),
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
});

export type Config = z.infer<typeof ConfigSchema>;
export type DependencyGroup = z.infer<typeof DependencyGroupSchema>;

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
  };

  cachedConfig = ConfigSchema.parse(raw);
  return cachedConfig;
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
