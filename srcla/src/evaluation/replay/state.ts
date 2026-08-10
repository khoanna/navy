/**
 * Vault replay state types
 */
import { WAD } from '../../protocols/math.js';

export interface VaultState {
  totalAssets: bigint;
  totalShares: bigint;
  idleBase: bigint;
  strategyBalances: Map<string, bigint>;
  cohorts: Map<string, Cohort>;
}

export interface Cohort {
  id: string;
  shares: bigint;
  depositTimestamp: Date;
}

export interface ExecutionCost {
  gasUsed: bigint;
  gasPrice: bigint;
  l1Fee: bigint;
  swapCost: bigint;
  totalCostBase: bigint;
}

/**
 * Create initial vault state
 */
export function createInitialState(initialDeposit: bigint): VaultState {
  return {
    totalAssets: initialDeposit,
    totalShares: initialDeposit, // 1:1 at start
    idleBase: initialDeposit,
    strategyBalances: new Map(),
    cohorts: new Map(),
  };
}

/**
 * Get share price (totalAssets / totalShares) in WAD scale
 */
export function sharePrice(state: VaultState): bigint {
  if (state.totalShares === 0n) return WAD;
  return (state.totalAssets * WAD) / state.totalShares;
}

/**
 * Serialize vault state for JSON export
 */
export function serializeState(state: VaultState): Record<string, unknown> {
  return {
    totalAssets: state.totalAssets.toString(),
    totalShares: state.totalShares.toString(),
    idleBase: state.idleBase.toString(),
    strategyBalances: Object.fromEntries(
      Array.from(state.strategyBalances.entries()).map(([k, v]) => [k, v.toString()]),
    ),
    cohorts: Array.from(state.cohorts.values()).map((c) => ({
      id: c.id,
      shares: c.shares.toString(),
      depositTimestamp: c.depositTimestamp.toISOString(),
    })),
  };
}
