import { ethers } from 'ethers';

/**
 * Vault code and configuration state for preflight validation
 */
export interface VaultCodeAndConfig {
  /** Current vault bytecode hash */
  vaultCodeHash: string;
  /** Expected vault bytecode hash (from plan or last known good) */
  expectedVaultCodeHash: string;
  /** Current configuration digest */
  configurationDigest: string;
  /** Expected configuration digest (from plan) */
  expectedConfigurationDigest: string;
  /** Current route status */
  routeStatus: 'active' | 'inactive' | 'stale';
}

/**
 * Preflight check parameters
 */
export interface PreflightParams {
  /** Target adapter address */
  adapter: string;
  /** Amount in base units (6 decimals for USDC) */
  amountBase: bigint;
  /** List of registered adapter addresses */
  registeredAdapters: string[];
  /** List of paused adapter addresses */
  pausedAdapters: string[];
  /** Current gas price in wei */
  gasPrice: bigint;
  /** Maximum acceptable gas price in wei */
  maxGasPrice: bigint;
  /** If true, allow zero amount for harvest operations */
  isHarvest?: boolean;
  /** Vault code and configuration state for validation */
  vaultCodeAndConfig?: VaultCodeAndConfig;
}

/**
 * Preflight check result
 */
export interface PreflightResult {
  /** Whether the action can proceed */
  valid: boolean;
  /** Reason if invalid */
  reason?: string;
  /** Additional metadata */
  metadata?: {
    adapterIndex?: number;
    gasPriceBps?: bigint;
    estimatedCost?: bigint;
  };
}

/**
 * Preflight errors
 */
export const PreflightError = {
  INVALID_ADAPTER: 'INVALID_ADAPTER',
  ZERO_AMOUNT: 'ZERO_AMOUNT',
  ADAPTER_PAUSED: 'ADAPTER_PAUSED',
  GAS_PRICE_TOO_HIGH: 'GAS_PRICE_TOO_HIGH',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  VAULT_CODE_CHANGED: 'VAULT_CODE_CHANGED',
  CONFIG_DIGEST_CHANGED: 'CONFIG_DIGEST_CHANGED',
  ROUTE_INACTIVE: 'ROUTE_INACTIVE',
  ROUTE_STALE: 'ROUTE_STALE',
  REWARD_STATE_CHANGED: 'REWARD_STATE_CHANGED',
} as const;

/**
 * Validate EVM address format
 */
function isValidAddress(address: string): boolean {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
}

/**
 * Normalize address to checksum format
 */
function normalizeAddress(address: string): string {
  try {
    return ethers.getAddress(address);
  } catch {
    return address;
  }
}

/**
 * Run pre-execution checks before submitting a transaction
 *
 * Checks performed:
 * - Adapter is registered
 * - Amount is positive (or harvest operation)
 * - Adapter is not paused
 * - Gas price is acceptable
 * - Vault code unchanged (if vaultCodeAndConfig provided)
 * - Configuration digest unchanged (if vaultCodeAndConfig provided)
 * - Route status is active (if vaultCodeAndConfig provided)
 *
 * @param params Preflight parameters
 * @returns Preflight result indicating if action can proceed
 */
export async function preflight(params: PreflightParams): Promise<PreflightResult> {
  // Validate adapter address format
  if (!isValidAddress(params.adapter)) {
    return {
      valid: false,
      reason: `${PreflightError.INVALID_ADDRESS}: ${params.adapter}`,
    };
  }

  const normalizedAdapter = normalizeAddress(params.adapter);

  // Check if adapter is registered
  const isRegistered = params.registeredAdapters.some(
    (addr) => normalizeAddress(addr) === normalizedAdapter
  );

  if (!isRegistered) {
    return {
      valid: false,
      reason: `${PreflightError.INVALID_ADAPTER}: ${params.adapter} not in registered adapters`,
    };
  }

  // Check amount (harvest can have zero amount)
  const isHarvest = params.isHarvest ?? false;
  if (params.amountBase === 0n && !isHarvest) {
    return {
      valid: false,
      reason: `${PreflightError.ZERO_AMOUNT}: amount must be greater than 0`,
    };
  }

  // Check if adapter is paused
  const isPaused = params.pausedAdapters.some(
    (addr) => normalizeAddress(addr) === normalizedAdapter
  );

  if (isPaused) {
    return {
      valid: false,
      reason: `${PreflightError.ADAPTER_PAUSED}: ${params.adapter}`,
    };
  }

  // Check gas price
  if (params.gasPrice > params.maxGasPrice) {
    const gasPriceGwei = Number(params.gasPrice) / 1e9;
    const maxGasPriceGwei = Number(params.maxGasPrice) / 1e9;
    return {
      valid: false,
      reason: `${PreflightError.GAS_PRICE_TOO_HIGH}: current=${gasPriceGwei.toFixed(2)} gwei, max=${maxGasPriceGwei.toFixed(2)} gwei`,
      metadata: {
        gasPriceBps: (params.gasPrice * 10000n) / params.maxGasPrice,
      },
    };
  }

  // Validate vault code and configuration state
  if (params.vaultCodeAndConfig) {
    const configValidation = validateVaultState(params.vaultCodeAndConfig);
    if (!configValidation.valid) {
      return configValidation;
    }
  }

  // All checks passed
  return {
    valid: true,
    metadata: {
      adapterIndex: params.registeredAdapters.findIndex(
        (addr) => normalizeAddress(addr) === normalizedAdapter
      ),
    },
  };
}

/**
 * Validate vault code and configuration state
 */
function validateVaultState(state: VaultCodeAndConfig): PreflightResult {
  // Check vault bytecode hash
  if (state.vaultCodeHash !== state.expectedVaultCodeHash) {
    return {
      valid: false,
      reason: `${PreflightError.VAULT_CODE_CHANGED}: vault code has changed since plan creation`,
    };
  }

  // Check configuration digest
  if (state.configurationDigest !== state.expectedConfigurationDigest) {
    return {
      valid: false,
      reason: `${PreflightError.CONFIG_DIGEST_CHANGED}: configuration has changed since plan creation`,
    };
  }

  // Check route status
  if (state.routeStatus === 'inactive') {
    return {
      valid: false,
      reason: `${PreflightError.ROUTE_INACTIVE}: reward route is not active`,
    };
  }

  if (state.routeStatus === 'stale') {
    return {
      valid: false,
      reason: `${PreflightError.ROUTE_STALE}: reward route data is stale`,
    };
  }

  return { valid: true };
}

/**
 * Create preflight params from vault state
 * Helper to build PreflightParams from common vault data
 */
export function createPreflightParams(params: {
  adapter: string;
  amountBase: bigint;
  registeredAdapters: string[];
  pausedAdapters: string[];
  gasPrice?: bigint;
  maxGasPrice?: bigint;
  isHarvest?: boolean;
  vaultCodeAndConfig?: VaultCodeAndConfig;
}): PreflightParams {
  const result: PreflightParams = {
    adapter: params.adapter,
    amountBase: params.amountBase,
    registeredAdapters: params.registeredAdapters,
    pausedAdapters: params.pausedAdapters,
    gasPrice: params.gasPrice ?? 50_000_000_000n, // 50 gwei default
    maxGasPrice: params.maxGasPrice ?? 200_000_000_000n, // 200 gwei default
  };
  if (params.isHarvest !== undefined) {
    result.isHarvest = params.isHarvest;
  }
  if (params.vaultCodeAndConfig !== undefined) {
    result.vaultCodeAndConfig = params.vaultCodeAndConfig;
  }
  return result;
}
