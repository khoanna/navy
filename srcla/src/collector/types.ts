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

export interface CollectedSnapshot {
  blockNumber: number;
  blockHash: string;
  timestamp: Date;
  vault: VaultSnapshot;
  strategies: StrategySnapshot[];
}

export interface VaultSnapshot {
  totalAssets: bigint;
  synchronousLiquidity: bigint;
  idleBase: bigint;
  minIdleBps: bigint;
  paused: boolean;

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
  /** Reserve breakdown: admin (immutable floor) + dynamic (policy-calculated) */
  reserve?: {
    admin: bigint;
    dynamic: bigint;
  } | undefined;
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
  maxWithdrawable: bigint;
  supplyRate: bigint;
  utilization: bigint;
  cash: bigint;
  paused: boolean;
  configDigest: string;
}
