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
