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
  /**
   * Aave V3's own two rate-model bounds, mirroring
   * `prisma/schema.prisma`'s `irmOptimalUtilizationRay`/
   * `irmMaxUtilizationRay` columns. Aave-only by construction: the archive
   * writes them from `DefaultReserveInterestRateStrategy`
   * (`collector/archive/calls.ts`), and Compound/Moonwell rows carry NULL.
   *
   * Aave's remaining coefficients ride in the kinked-linear fields above
   * under a documented aliasing the backfill collector established:
   * `irmBaseRateWad` = base variable borrow rate, `irmKinkRay` = the optimal
   * usage ratio (identical to `irmOptimalUtilizationRay`),
   * `irmSlopeLowWad` = variableRateSlope1, `irmSlopeHighWad` =
   * variableRateSlope2. `evaluation/kernel/decision-input.ts` un-aliases
   * them into `MarketObservation.aaveIrmParams`.
   */
  irmOptimalUtilizationRay?: bigint;
  irmMaxUtilizationRay?: bigint;
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