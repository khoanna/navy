import { ethers } from 'ethers';

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
  return result;
}
