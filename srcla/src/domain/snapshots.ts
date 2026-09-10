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
  /**
   * Kinked-linear IRM parameters, mirroring `prisma/schema.prisma`'s
   * `MarketSnapshot.irm*` columns (paper §6.3-6.5). OPTIONAL and additive:
   * populated only where the backfill collector resolved a reading (all of
   * Compound/Aave/Moonwell in practice, per `collector/archive/calls.ts`),
   * absent for hand-built/synthetic snapshots and for any origin whose
   * protocol read failed. A consumer that needs the exact on-chain rate
   * model (`forecast/state-space.ts`) MUST treat an absent set as a refusal
   * signal, never substitute `DEFAULT_*_CONFIG` or fall back to a proxy.
   */
  irmBaseRateWad?: bigint;
  irmKinkRay?: bigint;
  irmSlopeLowWad?: bigint;
  irmSlopeHighWad?: bigint;
  /** Rate-model reserve cut, bps. Distinct from Aave's own `aaveReserveFactorBps`. */
  reserveFactorBps?: number;
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