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

    // Core vault state
    const [totalAssets, syncLiquidity, minIdleBps, pausedResult] = await Promise.all([
      this.callVault(vault, 'totalAssets()', blockNumber),
      this.callVault(vault, 'synchronousLiquidity()', blockNumber),
      this.callVault(vault, 'minIdleBps()', blockNumber),
      this.callVault(vault, 'paused()', blockNumber),
    ]);

    // Get idle = vault USDC balance
    const idleBase = await this.client.getBalance(vault);

    // Build base snapshot
    const snapshot: VaultSnapshot = {
      totalAssets,
      synchronousLiquidity: syncLiquidity,
      idleBase,
      minIdleBps,
      paused: pausedResult !== 0n,
    };

    // Collect production vault fields if reward contracts are configured
    if (this.config.rewardAccountantAddress || this.config.rewardExecutorAddress) {
      try {
        const extendedFields = await this.collectExtendedVaultFields(blockNumber);
        Object.assign(snapshot, extendedFields);
      } catch (error) {
        console.warn('Failed to collect extended vault fields:', error);
      }
    }

    return snapshot;
  }

  /**
   * Collect extended production vault fields:
   * - Absolute caps (totalCap, perUserCap, minDeposit)
   * - Dependency group exposure and caps
   * - Reserve breakdown (admin/dynamic)
   * - Reward cache state
   * - Route status
   * - Oracle quality (sequencer/feed rounds)
   */
  private async collectExtendedVaultFields(blockNumber: number): Promise<Partial<VaultSnapshot>> {
    const extended: Partial<VaultSnapshot> = {};

    // Fetch all extended data in parallel where possible
    const promises: Promise<void>[] = [];

    // Collect reward accountant data
    if (this.config.rewardAccountantAddress) {
      promises.push(
        this.collectRewardState(blockNumber).then((rewardData) => {
          Object.assign(extended, rewardData);
        })
      );
    }

    // Collect reward executor route status
    if (this.config.rewardExecutorAddress) {
      promises.push(
        this.collectRouteStatus(blockNumber).then((routeData) => {
          Object.assign(extended, routeData);
        })
      );
    }

    // Collect vault policy data (absolute caps, groups)
    promises.push(
      this.collectVaultPolicy(blockNumber).then((policyData) => {
        Object.assign(extended, policyData);
      })
    );

    await Promise.all(promises);

    return extended;
  }

  /**
   * Collect reward state from RewardAccountant
   */
  private async collectRewardState(blockNumber: number): Promise<Partial<VaultSnapshot>> {
    const accountant = this.config.rewardAccountantAddress;
    if (!accountant) return {};

    try {
      const [cacheTimestamp, cacheValue, ready, configDigest] = await Promise.all([
        this.callReward(accountant, 'lastRefreshTime()', blockNumber),
        this.callReward(accountant, 'cachedRewardAssets()', blockNumber),
        this.callRewardBool(accountant, 'issuanceReady()', blockNumber),
        this.callRewardDigest(accountant, 'configurationDigest()', blockNumber),
      ]);

      return {
        rewardCacheTimestamp: cacheTimestamp,
        rewardCacheValue: cacheValue,
        rewardReady: ready,
        rewardPolicyDigest: configDigest,
      };
    } catch (error) {
      console.warn('Failed to collect reward state:', error);
      return {};
    }
  }

  /**
   * Collect route status from RewardExecutor
   */
  private async collectRouteStatus(blockNumber: number): Promise<Partial<VaultSnapshot>> {
    const executor = this.config.rewardExecutorAddress;
    if (!executor) return {};

    try {
      // Get first route ID to check status
      const routeIds = (await this.callRewardExecutor('getRouteIds()', blockNumber)) as string[];

      if (!routeIds || routeIds.length === 0) {
        return { routeStatus: 'inactive' };
      }

      // Get route details for first route (simplified - could check all)
      const firstRouteId = routeIds[0];
      const routeApproved = await this.callRewardExecutor(
        `isRouteApproved(${firstRouteId})`,
        blockNumber
      );

      return {
        routeStatus: routeApproved ? 'active' : 'inactive',
      };
    } catch (error) {
      console.warn('Failed to collect route status:', error);
      return { routeStatus: 'stale' };
    }
  }

  /**
   * Collect vault policy data: absolute caps and dependency groups
   */
  private async collectVaultPolicy(blockNumber: number): Promise<Partial<VaultSnapshot>> {
    const vault = this.config.vaultAddress;

    try {
      // Try to get absolute caps if available
      let absoluteCaps: { totalCap: bigint; perUserCap: bigint; minDeposit: bigint } | undefined;

      try {
        const [totalCap, perUserCap, minDeposit] = await Promise.all([
          this.callVault(vault, 'absoluteTotalCap()', blockNumber).catch(() => 0n),
          this.callVault(vault, 'absolutePerUserCap()', blockNumber).catch(() => 0n),
          this.callVault(vault, 'minDeposit()', blockNumber).catch(() => 0n),
        ]);

        if (totalCap > 0n) {
          absoluteCaps = { totalCap, perUserCap, minDeposit };
        }
      } catch {
        // absolute caps not available on this vault version
      }

      // Try to get dependency groups if available
      let groups: { id: string; exposure: bigint; cap: bigint }[] | undefined;

      try {
        const groupCount = await this.callVault(vault, 'dependencyGroupCount()', blockNumber);
        if (groupCount > 0n) {
          groups = [];
          for (let i = 0; i < Number(groupCount); i++) {
            const groupData = await this.callVault(
              vault,
              `dependencyGroups(${i})`,
              blockNumber
            );
            // Parse group data - format depends on contract implementation
            // Simplified: assume first 64 bits are exposure, second 64 are cap
            const exposure = (groupData >> 64n) & ((1n << 64n) - 1n);
            const cap = groupData & ((1n << 64n) - 1n);
            groups.push({
              id: `group-${i}`,
              exposure,
              cap,
            });
          }
        }
      } catch {
        // dependency groups not available
      }

      // Try to get reserve breakdown if available
      let reserve: { admin: bigint; dynamic: bigint } | undefined;

      try {
        const [adminReserve, dynamicReserve] = await Promise.all([
          this.callVault(vault, 'adminReserve()', blockNumber).catch(() => 0n),
          this.callVault(vault, 'dynamicReserve()', blockNumber).catch(() => 0n),
        ]);

        if (adminReserve > 0n || dynamicReserve > 0n) {
          reserve = { admin: adminReserve, dynamic: dynamicReserve };
        }
      } catch {
        // reserve breakdown not available
      }

      return {
        absoluteCaps,
        groups,
        reserve,
      };
    } catch (error) {
      console.warn('Failed to collect vault policy:', error);
      return {};
    }
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

  private async callReward(
    address: string,
    sig: string,
    blockNumber: number
  ): Promise<bigint> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(address, data, blockNumber);
    return result === '0x' ? 0n : ethers.toBigInt(result);
  }

  private async callRewardBool(
    address: string,
    sig: string,
    blockNumber: number
  ): Promise<boolean> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(address, data, blockNumber);
    if (result === '0x' || result === '0x0') return false;
    if (result === '0x1') return true;
    return ethers.toBigInt(result) !== 0n;
  }

  private async callRewardDigest(
    address: string,
    sig: string,
    blockNumber: number
  ): Promise<string> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(address, data, blockNumber);
    return result === '0x'
      ? '0x' + '0'.repeat(64)
      : '0x' + result.slice(2).padStart(64, '0');
  }

  private async callRewardExecutor(sig: string, blockNumber: number): Promise<unknown> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(
      this.config.rewardExecutorAddress!,
      data,
      blockNumber
    );
    // Return raw result for complex types
    return result;
  }
}
