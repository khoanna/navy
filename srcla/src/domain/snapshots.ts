import { BigIntFromString } from './zod-helpers.js';

/**
 * Market snapshot from chain
 */
export interface MarketSnapshot {
  marketId: string;
  blockHash: string;
  timestamp: Date;
  totalAssetsBase: bigint;
  idleBase: bigint;
  supplyRateE18: bigint;
  utilizationE18: bigint;
  cashBase: bigint;
  borrowsBase: bigint;
  reservesBase: bigint;
  capBps: number;
  paused: boolean;
  configDigest: string;
}

/**
 * Regime from on-chain configuration
 */
export interface ContractRegime {
  marketId: string;
  digest: string;
  activatedAt: Date;
}

/**
 * Snapshot with regime information
 */
export interface SnapshotWithRegime {
  snapshot: MarketSnapshot;
  regime: ContractRegime | null;
}
