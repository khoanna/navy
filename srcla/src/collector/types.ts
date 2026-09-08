export interface CollectorConfig {
  vaultAddress: string;
  strategyAddresses: {
    aave: string;
    compound: string;
    moonwell: string;
  };
  usdcAddress: string;
  chainRpcUrl?: string;
  chainId?: number;
  /** RewardAccountant contract address for reward state */
  rewardAccountantAddress?: string | undefined;
  /** RewardExecutor contract address for route status */
  rewardExecutorAddress?: string | undefined;
  /**
   * Known dependency group IDs for the vault.
   * The vault's getDependencyGroup(bytes32 groupId) returns (capBps, absoluteCap, members[]).
   * Configure this list based on the deployed vault's group configuration.
   */
  dependencyGroupIds?: string[] | undefined;
  /**
   * Known reward token addresses to check for staleness.
   * The collector will check tokenCache for each address via RewardAccountant.
   */
  rewardTokenAddresses?: string[] | undefined;
}

/** Which protocol sits behind a strategy adapter. */
export type VenueKind = 'aave' | 'compound' | 'moonwell';

/**
 * The protocol-level state read through an adapter's venue handle.
 * Every field here used to be a hardcoded constant in `collectStrategy`
 * (`utilization: 0n, cash: 0n, paused: false`).
 */
export interface VenueState {
  /** Utilization, WAD (1e18) scaled. */
  utilizationWad: bigint;
  /** Underlying the venue can pay out right now, in asset base units. */
  cash: bigint;
  /** Outstanding borrows, in asset base units. */
  borrows: bigint;
  /** Protocol reserves, in asset base units (0 where the venue does not expose a comparable figure). */
  reserves: bigint;
  /** True when the venue will not currently accept a deposit. */
  paused: boolean;
}

export interface CollectedSnapshot {
  blockNumber: number;
  blockHash: string;
  timestamp: Date;
  vault: VaultSnapshot;
  strategies: StrategySnapshot[];
  /**
   * True when at least one CONFIGURED venue could not be read at this block.
   * Paper §12 row 1 requires "Mark snapshot incomplete; do not decide" — a
   * failed venue read used to be logged and dropped, leaving the kernel to
   * allocate across whatever subset happened to answer, with no way for any
   * consumer to tell that a market was missing rather than absent.
   */
  incomplete: boolean;
  /** Names of the configured venues whose reads failed. */
  missingMarkets: string[];
}

export interface VaultSnapshot {
  totalAssets: bigint;
  synchronousLiquidity: bigint;
  idleBase: bigint;
  minIdleBps: bigint;
  paused: boolean;
  /**
   * Reserve breakdown: admin (immutable floor, `NavyVaultSRCLA.adminReserve`)
   * + dynamic (policy-calculated, `NavyVaultSRCLA.dynamicReserve`). BOTH are
   * `public` state vars on the deployed vault (contract/src/NavyVaultSRCLA.sol),
   * not reward-plumbing-dependent — always read as part of the CORE vault
   * snapshot (collectVault), not gated behind reward-contract configuration.
   * A genuinely zero value here means the collector actually read 0 from
   * chain, never "the collector didn't try": whole-branch review, HIGH 5 —
   * an earlier revision only populated this when a reward accountant/executor
   * address happened to be configured (which src/index.ts never sets), so it
   * silently read as 0n in production regardless of the real on-chain
   * reserve, and the vault's own `requiredIdle() = max(adminReserve,
   * dynamicReserve)` floor could be materially higher than what the kernel
   * sized a plan against.
   */
  reserve: {
    admin: bigint;
    dynamic: bigint;
  };

  // Extended fields for production vault policy alignment
  /** Absolute caps from vault configuration */
  absoluteCaps?: {
    totalCap: bigint;
    perUserCap: bigint;
    minDeposit: bigint;
  } | undefined;
  /** Dependency group exposure and caps */
  groups?: Array<{
    id: string;
    exposure: bigint;
    cap: bigint;
  }> | undefined;
  /** Reward cache timestamp (Unix seconds) */
  rewardCacheTimestamp?: bigint;
  /** Cached reward value in base units */
  rewardCacheValue?: bigint;
  /** Whether rewards are ready to be harvested */
  rewardReady?: boolean;
  /** Keccak256 hash of reward policy configuration */
  rewardPolicyDigest?: string;
  /** Keccak256 hash of approved route configuration */
  routeDigest?: string;
  /** Current route status from RewardExecutor */
  routeStatus?: 'active' | 'inactive' | 'stale';
  /** Current sequencer round number (Unix timestamp or sequential) */
  sequencerRound?: bigint;
  /** Per-feed round data with staleness flags */
  feedRounds?: Array<{
    feed: string;
    round: bigint;
    staleness: boolean;
  }> | undefined;
}

export interface StrategySnapshot {
  address: string;
  name: string;
  totalAssets: bigint;
  /** Adapter `maxWithdrawable()` = min(our position, venue cash). Zero for a
   *  venue the vault has not entered - which is why it must NOT be reused as
   *  deployable headroom. */
  maxWithdrawable: bigint;
  /**
   * Adapter `maxDeployable()`: live supply headroom, INDEPENDENT of the
   * vault's current position. `2^256-1` where the protocol's base supply is
   * genuinely uncapped (Compound III when not paused, Aave/Moonwell with no
   * supply cap set), 0 when minting is paused or frozen.
   *
   * Previously not read at all: `runtime/decision-driver.ts` reused
   * `maxWithdrawable` for `MarketObservation.maxDeployableBase`, which is
   * `min(position, cash)` and therefore 0 for an empty venue - so
   * `admit.ts`'s CAP_ZERO rule rejected any venue the vault had not already
   * entered. That is the deployable half of the cold-start deadlock in
   * readiness audit NEW-11; the exitable half (phi reading the same value)
   * was fixed earlier by pointing `maxWithdrawableBase` at venue cash.
   */
  maxDeployable: bigint;
  /** Annualized supply rate, WAD (1e18) scaled — adapter `supplyRatePerYear()`. */
  supplyRate: bigint;
  /** Utilization, WAD (1e18) scaled. */
  utilization: bigint;
  /** Underlying the venue can pay out right now, in asset base units. */
  cash: bigint;
  /** Outstanding borrows at the venue, in asset base units. */
  borrows: bigint;
  /** Venue reserves, in asset base units (0 where the protocol exposes no comparable figure). */
  reserves: bigint;
  /** True when the venue will not currently accept a deposit. */
  paused: boolean;
  configDigest: string;
  /** Effective cap after cold-start constraints (optional) */
  effectiveCap?: bigint;
}
