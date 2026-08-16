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
   * - Route status and digest
   * - Oracle quality (sequencer/feed rounds)
   */
  private async collectExtendedVaultFields(blockNumber: number): Promise<Partial<VaultSnapshot>> {
    const extended: Partial<VaultSnapshot> = {};

    // Fetch all extended data in parallel where possible
    const promises: Promise<void>[] = [];

    // Collect reward accountant data (cache state + oracle quality)
    if (this.config.rewardAccountantAddress) {
      promises.push(
        this.collectRewardState(blockNumber).then((rewardData) => {
          Object.assign(extended, rewardData);
        })
      );
      // Collect oracle state (sequencer/feed rounds) if configured with token addresses
      if (this.config.rewardTokenAddresses && this.config.rewardTokenAddresses.length > 0) {
        promises.push(
          this.collectOracleState(blockNumber).then((oracleData) => {
            Object.assign(extended, oracleData);
          })
        );
      }
    }

    // Collect reward executor route status + digest
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
   * Collect route status and digest from RewardExecutor
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

      // Also try to get the route digest from the routes mapping
      let routeDigest: string | undefined;
      try {
        const routeData = await this.callRewardExecutorWithTuple(
          `routes(${firstRouteId})`,
          blockNumber,
          // Expected return: (inputToken, outputToken, rewardFeed, usdcFeed, maxInput,
          // minOutputBps, maxPriceImpactBps, maxDailyNotional, lowerBound, upperBound,
          // activationBlockHash, routeDigest)
          12
        );
        if (routeData && routeData.length >= 12) {
          // routeDigest is at index 11 (last field in the struct)
          routeDigest = routeData[11];
        }
      } catch {
        // route digest not available
      }

      return {
        routeStatus: routeApproved ? 'active' : 'inactive',
        ...(routeDigest && { routeDigest }),
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
        // These methods may not exist on all vault versions
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

      // Collect dependency groups using configured group IDs
      // The vault's getDependencyGroup(bytes32 groupId) returns (capBps, absoluteCap, members[])
      let groups: { id: string; exposure: bigint; cap: bigint }[] | undefined;

      if (this.config.dependencyGroupIds && this.config.dependencyGroupIds.length > 0) {
        try {
          const groupPromises = this.config.dependencyGroupIds.map(async (groupId) => {
            const groupData = await this.callVaultWithTuple(
              vault,
              `getDependencyGroup(${groupId})`,
              blockNumber,
              3 // (capBps: uint16, absoluteCap: uint256, members: address[])
            );

            if (groupData && groupData.length >= 3) {
              const absoluteCap = BigInt(groupData[1] as string || '0');

              // Calculate exposure from member adapter balances
              let exposure = 0n;
              const members = groupData[2] as string[] | undefined;
              if (members && Array.isArray(members)) {
                for (const member of members) {
                  const balance = await this.callVault(vault, `strategyAssets(${member})`, blockNumber).catch(() => 0n);
                  exposure += balance;
                }
              }

              return {
                id: groupId,
                exposure,
                cap: absoluteCap,
              };
            }
            return null;
          });

          const groupResults = await Promise.all(groupPromises);
          const validGroups = groupResults.filter((g): g is NonNullable<typeof g> => g !== null);

          if (validGroups.length > 0) {
            groups = validGroups;
          }
        } catch {
          // dependency groups not available
        }
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

  /**
   * Call a vault method that returns a tuple and parse the result.
   * For simplicity, we parse statically based on expected field count.
   * Dynamic types (arrays) are returned as-is from the raw result.
   */
  private async callVaultWithTuple(
    address: string,
    sig: string,
    blockNumber: number,
    _fieldCount: number
  ): Promise<(string | string[])[] | null> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(address, data, blockNumber);

    if (result === '0x' || result.length < 64) {
      return null;
    }

    // Parse statically - each 32-byte word is a field
    // For the vault's getDependencyGroup: (uint16 capBps, uint256 absoluteCap, address[] members)
    // - capBps is at offset 0 (padded to 32 bytes)
    // - absoluteCap is at offset 1 (32 bytes)
    // - members is at offset 2 (offset pointer to dynamic array data)
    // - members array elements start at the offset specified in offset 2

    const resultWords: string[] = [];
    for (let i = 0; i < result.length - 2; i += 64) {
      resultWords.push(result.slice(i + 2, i + 66));
    }

    if (resultWords.length === 0) {
      return null;
    }

    // For getDependencyGroup: 3 fields
    // Field 0: capBps (uint16, 2 bytes from end of first word)
    const capBpsHex = resultWords[0]!.slice(-4); // Last 4 hex chars = 2 bytes
    const capBps = parseInt(capBpsHex, 16);

    // Field 1: absoluteCap (uint256, full second word)
    const absoluteCap = ethers.toBigInt('0x' + resultWords[1]!);

    // Field 2: members array (offset pointer to dynamic data)
    const membersOffset = Number(ethers.toBigInt('0x' + resultWords[2]!)) / 32;
    let members: string[] = [];

    if (membersOffset > 0 && membersOffset < resultWords.length) {
      // Length of the dynamic array
      const lengthWord = resultWords[membersOffset];
      if (lengthWord) {
        const arrayLength = Number(ethers.toBigInt('0x' + lengthWord));
        // Read array elements starting from membersOffset + 1
        for (let i = 0; i < arrayLength; i++) {
          const elementOffset = membersOffset + 1 + i;
          if (elementOffset < resultWords.length) {
            const elementWord = resultWords[elementOffset];
            if (elementWord) {
              // Address is last 20 bytes (40 hex chars) of the word
              const address = '0x' + elementWord.slice(-40);
              members.push(address);
            }
          }
        }
      }
    }

    return [capBps.toString(), absoluteCap.toString(), members];
  }

  /**
   * Call a reward executor method that returns a tuple and parse the result.
   */
  private async callRewardExecutorWithTuple(
    sig: string,
    blockNumber: number,
    fieldCount: number
  ): Promise<string[] | null> {
    const fn = sig.slice(0, sig.indexOf('('));
    const data = ethers.id(fn + '()').slice(0, 10);
    const result = await this.client.call(
      this.config.rewardExecutorAddress!,
      data,
      blockNumber
    );

    if (result === '0x' || result.length < 64) {
      return null;
    }

    // Parse each 32-byte word as a field
    const resultWords: string[] = [];
    for (let i = 0; i < result.length - 2; i += 64) {
      resultWords.push(result.slice(i + 2, i + 66));
    }

    if (resultWords.length === 0) {
      return null;
    }

    // For simple tuple parsing, return words as-is
    // Dynamic types (arrays, strings) would need special handling
    return resultWords.slice(0, fieldCount);
  }

  /**
   * Collect oracle state: sequencer round and feed rounds with staleness.
   * Checks each configured reward token for staleness via tokenCache.
   */
  private async collectOracleState(blockNumber: number): Promise<Partial<VaultSnapshot>> {
    const accountant = this.config.rewardAccountantAddress;
    if (!accountant || !this.config.rewardTokenAddresses) {
      return {};
    }

    try {
      const feedRounds: Array<{ feed: string; round: bigint; staleness: boolean }> = [];

      // Get the USDC/USD feed from the reward accountant
      let sequencerRound: bigint | undefined;
      try {
        // The sequencerFeed is configured in the RewardExecutor, not directly in RewardAccountant
        // For now, we use lastRefreshTime as a proxy for "oracle freshness"
        // In a full implementation, we'd call the sequencerFeed directly for round data
        const lastRefresh = await this.callReward(accountant, 'lastRefreshTime()', blockNumber);
        sequencerRound = lastRefresh;
      } catch {
        // sequencer data not available
      }

      // Check each configured reward token for staleness
      for (const tokenAddress of this.config.rewardTokenAddresses) {
        try {
          const tokenCache = await this.callRewardTokenCache(accountant, tokenAddress, blockNumber);
          if (tokenCache) {
            feedRounds.push({
              feed: tokenAddress,
              round: tokenCache.lastUpdated,
              staleness: tokenCache.isStale,
            });
          }
        } catch {
          // Token cache not available
        }
      }

      return {
        sequencerRound,
        feedRounds: feedRounds.length > 0 ? feedRounds : undefined,
      } as Partial<VaultSnapshot>;
    } catch (error) {
      console.warn('Failed to collect oracle state:', error);
      return {};
    }
  }

  private async callRewardTokenCache(
    address: string,
    tokenAddress: string,
    blockNumber: number
  ): Promise<{ value: bigint; lastUpdated: bigint; isStale: boolean } | null> {
    const fn = 'tokenCache';
    // Encode the token address as a function parameter
    const paddedToken = tokenAddress.toLowerCase().replace('0x', '').padStart(64, '0');
    const data = ethers.id(fn + '(address)').slice(0, 10) + paddedToken;

    const result = await this.client.call(address, data, blockNumber);

    if (result === '0x' || result.length < 192) {
      // Need at least 3 * 32 bytes for (value, lastUpdated, isMaterial)
      return null;
    }

    // Parse the result
    // Word 0: value (uint256)
    // Word 1: lastUpdated (uint256)
    // Word 2: isMaterial (bool) - indicates if this token contributes to total value
    const value = ethers.toBigInt('0x' + result.slice(2, 66));
    const lastUpdated = ethers.toBigInt('0x' + result.slice(66, 130));

    // Check staleness based on maxAge from tokenPolicies (if available)
    // For simplicity, we consider stale if lastUpdated is 0 or very old
    const now = BigInt(Math.floor(Date.now() / 1000));
    const isStale = lastUpdated === 0n || (now - lastUpdated > 3600n); // Stale if > 1 hour old

    return { value, lastUpdated, isStale };
  }
}
