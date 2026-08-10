import { ethers } from 'ethers';
import { ChainClient } from '../chain/client.js';
import { CollectorConfig, CollectedSnapshot, StrategySnapshot, VaultSnapshot } from './types.js';

export class SnapshotCollector {
  private client: ChainClient;
  private config: CollectorConfig;

  constructor(client: ChainClient, config: CollectorConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Collect snapshot from current finalized block
   */
  async collect(): Promise<CollectedSnapshot | null> {
    const block = await this.client.getFinalizedBlock();

    if (!block || !block.hash) {
      throw new Error('No finalized block available');
    }

    const blockNumber = Number(block.number);
    const vaultSnapshot = await this.collectVault(blockNumber);
    const strategySnapshots = await this.collectStrategies(blockNumber);

    return {
      blockNumber,
      blockHash: block.hash,
      timestamp: new Date(Number(block.timestamp) * 1000),
      vault: vaultSnapshot,
      strategies: strategySnapshots,
    };
  }

  private async collectVault(blockNumber: number): Promise<VaultSnapshot> {
    const vault = this.config.vaultAddress;

    const [totalAssets, syncLiquidity, minIdleBps, pausedResult] = await Promise.all([
      this.callVault(vault, 'totalAssets()', blockNumber),
      this.callVault(vault, 'synchronousLiquidity()', blockNumber),
      this.callVault(vault, 'minIdleBps()', blockNumber),
      this.callVault(vault, 'paused()', blockNumber),
    ]);

    // Get idle = vault USDC balance
    const idleBase = await this.client.getBalance(vault);

    return {
      totalAssets,
      synchronousLiquidity: syncLiquidity,
      idleBase,
      minIdleBps,
      paused: pausedResult !== 0n,
    };
  }

  private async collectStrategies(blockNumber: number): Promise<StrategySnapshot[]> {
    const snapshots: StrategySnapshot[] = [];

    const strategies: [string, string][] = [
      ['Aave', this.config.strategyAddresses.aave],
      ['Compound', this.config.strategyAddresses.compound],
      ['Moonwell', this.config.strategyAddresses.moonwell],
    ];

    for (const [name, address] of strategies) {
      if (!address) continue;

      try {
        const snapshot = await this.collectStrategy(name, address, blockNumber);
        snapshots.push(snapshot);
      } catch (error) {
        console.error(`Failed to collect ${name} strategy:`, error);
      }
    }

    return snapshots;
  }

  private async collectStrategy(
    name: string,
    address: string,
    blockNumber: number
  ): Promise<StrategySnapshot> {
    const [totalAssets, maxWithdraw, configDigestResult] = await Promise.all([
      this.callStrategy(address, 'totalAssets()', blockNumber),
      this.callStrategy(address, 'maxWithdrawable()', blockNumber),
      this.callStrategy(address, 'configurationDigest()', blockNumber),
    ]);

    // Convert bytes32 bigint result to hex string
    const configDigest = '0x' + configDigestResult.toString(16).padStart(64, '0');

    return {
      address,
      name,
      totalAssets,
      maxWithdrawable: maxWithdraw,
      supplyRate: 0n, // Would need protocol-specific calls
      utilization: 0n,
      cash: 0n,
      paused: false,
      configDigest,
    };
  }

  private async callVault(
    address: string,
    sig: string,
    blockNumber: number
  ): Promise<bigint> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(address, data, blockNumber);
    return result === '0x' ? 0n : ethers.toBigInt(result);
  }

  private async callStrategy(
    address: string,
    sig: string,
    blockNumber: number
  ): Promise<bigint> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(address, data, blockNumber);
    return result === '0x' ? 0n : ethers.toBigInt(result);
  }
}
