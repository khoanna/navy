export interface CollectorConfig {
  vaultAddress: string;
  strategyAddresses: {
    aave: string;
    compound: string;
    moonwell: string;
  };
  usdcAddress: string;
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
