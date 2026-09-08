import { ethers } from 'ethers';
import { ChainClient } from '../chain/client.js';
import {
  ADAPTER_IFACE,
  AAVE_POOL_IFACE,
  COMET_IFACE,
  ERC20_IFACE,
  MTOKEN_IFACE,
  REWARD_ACCOUNTANT_IFACE,
  REWARD_EXECUTOR_IFACE,
  VAULT_IFACE,
  aaveReserveIsBlocked,
  cometBorrowsFromUtilization,
  decodeAaveReserveFlags,
  utilizationWad,
} from '../chain/contract-abis.js';
import {
  CollectorConfig,
  CollectedSnapshot,
  StrategySnapshot,
  VaultSnapshot,
  VenueKind,
  VenueState,
} from './types.js';

/**
 * The three venues, in the fixed order the collector reports them.
 * `name` is the marketId every downstream table keys on; `venue` selects the
 * protocol-specific reads in `collectVenueState`.
 */
const VENUES: ReadonlyArray<{ name: string; venue: VenueKind; key: keyof CollectorConfig['strategyAddresses'] }> = [
  { name: 'Aave', venue: 'aave', key: 'aave' },
  { name: 'Compound', venue: 'compound', key: 'compound' },
  { name: 'Moonwell', venue: 'moonwell', key: 'moonwell' },
];

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
    const { strategies, failures } = await this.collectStrategies(blockNumber);

    return {
      blockNumber,
      blockHash: block.hash,
      timestamp: new Date(Number(block.timestamp) * 1000),
      vault: vaultSnapshot,
      strategies,
      // Paper §12 row 1: a snapshot that could not read a configured venue is
      // INCOMPLETE and must not be decided on. Before this flag existed a
      // failed venue read was logged and dropped, and the kernel happily
      // allocated across whatever subset happened to answer.
      incomplete: failures.length > 0,
      missingMarkets: failures,
    };
  }

  private async collectVault(blockNumber: number): Promise<VaultSnapshot> {
    const vault = this.config.vaultAddress;

    // Core vault state. adminReserve()/dynamicReserve() are `public` state
    // vars on every deployed NavyVaultSRCLA (contract/src/NavyVaultSRCLA.sol)
    // -- unlike absoluteCaps/dependency groups/reward state below, they are
    // NOT reward-plumbing-dependent and NOT optional on some vault version,
    // so they belong here, unconditionally, alongside totalAssets/paused/etc,
    // and a failed read propagates like any of those do (a refusal, not a
    // silent 0n) rather than being swallowed by collectExtendedVaultFields's
    // reward-address gate (whole-branch review, HIGH 5).
    const [totalAssets, syncLiquidity, minIdleBps, paused, adminReserve, dynamicReserve, idleBase] =
      await Promise.all([
        this.readUint(VAULT_IFACE, vault, 'totalAssets', [], blockNumber),
        this.readUint(VAULT_IFACE, vault, 'synchronousLiquidity', [], blockNumber),
        this.readUint(VAULT_IFACE, vault, 'minIdleBps', [], blockNumber),
        this.readBool(VAULT_IFACE, vault, 'paused', [], blockNumber),
        this.readUint(VAULT_IFACE, vault, 'adminReserve', [], blockNumber),
        this.readUint(VAULT_IFACE, vault, 'dynamicReserve', [], blockNumber),
        // Idle is the vault's undeployed USDC, i.e. the ERC-20 balance of the
        // vault's own asset. This used to call ChainClient.getBalance(vault),
        // which is `eth_getBalance` -- the vault's NATIVE ETH balance, in wei.
        // That is a different token and a different scale; it is only ever
        // nonzero if someone sends ETH to the vault, so `idleBase` (a 6-dp
        // USDC figure feeding DecisionInput.vault.idleBase) read 0 in normal
        // operation and would have read wei-scaled nonsense otherwise.
        this.readUint(ERC20_IFACE, this.config.usdcAddress, 'balanceOf', [vault], blockNumber),
      ]);

    // Build base snapshot
    const snapshot: VaultSnapshot = {
      totalAssets,
      synchronousLiquidity: syncLiquidity,
      idleBase,
      minIdleBps,
      paused,
      reserve: { admin: adminReserve, dynamic: dynamicReserve },
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
        this.readUint(REWARD_ACCOUNTANT_IFACE, accountant, 'lastRefreshTime', [], blockNumber),
        this.readUint(REWARD_ACCOUNTANT_IFACE, accountant, 'cachedRewardAssets', [], blockNumber),
        this.readBool(REWARD_ACCOUNTANT_IFACE, accountant, 'issuanceReady', [], blockNumber),
        this.readBytes32(REWARD_ACCOUNTANT_IFACE, accountant, 'configurationDigest', [], blockNumber),
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
   * Collect route status and digest from RewardExecutor.
   *
   * Every call here takes an argument, and every one of them used to be sent
   * as `ethers.id(name + '()')` with no calldata -- the selector of a function
   * that does not exist. `getRouteIds()`'s raw hex return was then cast to
   * `string[]` and indexed, yielding the character "0" as the "route id".
   * All three now encode and decode through REWARD_EXECUTOR_IFACE, and the
   * digest is read as `route.routeDigest` by name rather than as a positional
   * word (srcla read index 11, `upperBound`; the current layout has
   * `routeDigest` at 13, and any future field would move it again).
   */
  private async collectRouteStatus(blockNumber: number): Promise<Partial<VaultSnapshot>> {
    const executor = this.config.rewardExecutorAddress;
    if (!executor) return {};

    try {
      const decoded = await this.read(REWARD_EXECUTOR_IFACE, executor, 'getRouteIds', [], blockNumber);
      const routeIds = decoded[0] as ReadonlyArray<string>;

      if (!routeIds || routeIds.length === 0) {
        return { routeStatus: 'inactive' };
      }

      // Route details for the first route (representative; the executor keeps
      // one route per reward token and they are approved/revoked together).
      const firstRouteId = routeIds[0]!;
      const routeApproved = await this.readBool(
        REWARD_EXECUTOR_IFACE,
        executor,
        'isRouteApproved',
        [firstRouteId],
        blockNumber
      );

      let routeDigest: string | undefined;
      try {
        const routeResult = await this.read(
          REWARD_EXECUTOR_IFACE,
          executor,
          'getRoute',
          [firstRouteId],
          blockNumber
        );
        const digest = (routeResult[0] as ethers.Result).getValue('routeDigest') as string;
        if (typeof digest === 'string') routeDigest = digest;
      } catch (error) {
        console.warn('Failed to read route digest:', error);
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
        // These methods do not exist on NavyVaultSRCLA and are expected to
        // revert there; they are probed for forward compatibility with a
        // vault version that does expose them.
        const [totalCap, perUserCap, minDeposit] = await Promise.all([
          this.readUint(VAULT_IFACE, vault, 'absoluteTotalCap', [], blockNumber).catch(() => 0n),
          this.readUint(VAULT_IFACE, vault, 'absolutePerUserCap', [], blockNumber).catch(() => 0n),
          this.readUint(VAULT_IFACE, vault, 'minDeposit', [], blockNumber).catch(() => 0n),
        ]);

        if (totalCap > 0n) {
          absoluteCaps = { totalCap, perUserCap, minDeposit };
        }
      } catch {
        // absolute caps not available on this vault version
      }

      // Collect dependency groups using configured group IDs.
      //
      // NavyVaultSRCLA.getDependencyGroup(bytes32) returns
      // (uint16 capBps, uint256 absoluteCap, address[] members), and each
      // member's exposure is `strategyAssets(address)`. BOTH used to be sent
      // as argument-stripped selectors with empty calldata, so both reverted:
      // `groups` was always undefined and, had it not been, every member's
      // exposure would have been the `.catch(() => 0n)` fallback. Dependency
      // exposure has therefore read 0 in every snapshot ever collected.
      let groups: { id: string; exposure: bigint; cap: bigint }[] | undefined;

      if (this.config.dependencyGroupIds && this.config.dependencyGroupIds.length > 0) {
        try {
          const groupPromises = this.config.dependencyGroupIds.map(async (groupId) => {
            const groupData = await this.read(
              VAULT_IFACE,
              vault,
              'getDependencyGroup',
              [groupId],
              blockNumber
            );

            const absoluteCap = groupData.getValue('absoluteCap') as bigint;
            const members = groupData.getValue('members') as ReadonlyArray<string>;

            let exposure = 0n;
            for (const member of members) {
              exposure += await this.readUint(
                VAULT_IFACE,
                vault,
                'strategyAssets',
                [member],
                blockNumber
              );
            }

            return { id: groupId, exposure, cap: absoluteCap };
          });

          const groupResults = await Promise.all(groupPromises);
          if (groupResults.length > 0) {
            groups = groupResults;
          }
        } catch (error) {
          console.warn('Failed to collect dependency groups:', error);
        }
      }

      // Reserve breakdown (admin/dynamic) is now read unconditionally as
      // part of the CORE vault snapshot in collectVault -- see its comment
      // (whole-branch review, HIGH 5). Deliberately not duplicated here:
      // this method's result is merged into the snapshot via
      // `Object.assign`, and a second, reward-gated read that came back
      // `undefined` (e.g. both values legitimately 0) would silently
      // clobber the already-collected core value.

      return {
        absoluteCaps,
        groups,
      };
    } catch (error) {
      console.warn('Failed to collect vault policy:', error);
      return {};
    }
  }

  private async collectStrategies(
    blockNumber: number
  ): Promise<{ strategies: StrategySnapshot[]; failures: string[] }> {
    const strategies: StrategySnapshot[] = [];
    const failures: string[] = [];

    for (const { name, venue, key } of VENUES) {
      const address = this.config.strategyAddresses[key];
      if (!address) continue;

      try {
        strategies.push(await this.collectStrategy(name, venue, address, blockNumber));
      } catch (error) {
        // Paper §12: do not silently drop. The caller marks the snapshot
        // incomplete and the decision driver refuses to decide on it.
        console.error(`Failed to collect ${name} strategy:`, error);
        failures.push(name);
      }
    }

    return { strategies, failures };
  }

  private async collectStrategy(
    name: string,
    venue: VenueKind,
    address: string,
    blockNumber: number
  ): Promise<StrategySnapshot> {
    const [totalAssets, maxWithdraw, maxDeploy, configDigest, supplyRate] = await Promise.all([
      this.readUint(ADAPTER_IFACE, address, 'totalAssets', [], blockNumber),
      this.readUint(ADAPTER_IFACE, address, 'maxWithdrawable', [], blockNumber),
      // Deployable headroom is a DIFFERENT quantity from withdrawable exit
      // capacity: `maxWithdrawable()` is min(position, cash) and is 0 for a
      // venue the vault has not entered, so reusing it as headroom made
      // admit.ts's CAP_ZERO reject every empty venue (audit NEW-11).
      this.readUint(ADAPTER_IFACE, address, 'maxDeployable', [], blockNumber),
      this.readBytes32(ADAPTER_IFACE, address, 'configurationDigest', [], blockNumber),
      // WAD-scaled annualized supply rate; every adapter implements this
      // (CompoundAdapter.sol:98, AaveV3Adapter.sol:96, MoonwellAdapter.sol:136).
      // Previously hardcoded 0n with the comment "Would need protocol-specific
      // calls" -- so every forecast, capacity curve and admission decision in
      // the live service was computed from a zero rate.
      this.readUint(ADAPTER_IFACE, address, 'supplyRatePerYear', [], blockNumber),
    ]);

    const venueState = await this.collectVenueState(venue, address, blockNumber);

    return {
      address,
      name,
      totalAssets,
      maxWithdrawable: maxWithdraw,
      maxDeployable: maxDeploy,
      supplyRate,
      utilization: venueState.utilizationWad,
      cash: venueState.cash,
      borrows: venueState.borrows,
      reserves: venueState.reserves,
      paused: venueState.paused,
      configDigest,
    };
  }

  /**
   * Read the protocol-level state behind an adapter: how much underlying the
   * venue can pay out right now (`cash`), how utilized it is, its borrow and
   * reserve totals, and whether it will currently accept a deposit.
   *
   * These four were `supplyRate: 0n, utilization: 0n, cash: 0n, paused: false`
   * -- asserted, not read. `paused: false` in particular made §12's
   * "market paused -> block deployment" rule unreachable by construction.
   */
  private async collectVenueState(
    venue: VenueKind,
    adapter: string,
    blockNumber: number
  ): Promise<VenueState> {
    const usdc = this.config.usdcAddress;

    if (venue === 'compound') {
      const comet = await this.readAddress(ADAPTER_IFACE, adapter, 'comet', [], blockNumber);
      const [utilization, suppliedTotal, cash, paused] = await Promise.all([
        // Comet reports utilization already WAD-scaled; CompoundAdapter feeds
        // this exact value to comet.getSupplyRate (CompoundAdapter.sol:99-100).
        this.readUint(COMET_IFACE, comet, 'getUtilization', [], blockNumber),
        this.readUint(ERC20_IFACE, comet, 'totalSupply', [], blockNumber),
        // Comet's payable liquidity is the underlying it actually holds --
        // the same quantity CompoundAdapter.maxWithdrawable caps against
        // (CompoundAdapter.sol:114).
        this.readUint(ERC20_IFACE, usdc, 'balanceOf', [comet], blockNumber),
        this.readBool(COMET_IFACE, comet, 'isSupplyPaused', [], blockNumber),
      ]);
      return {
        // Reported as Comet reports it, not recomputed: this is the exact
        // input its own interest-rate model uses.
        utilizationWad: utilization,
        cash,
        borrows: cometBorrowsFromUtilization(suppliedTotal, utilization),
        // Comet's protocol reserves are `getReserves()`, which is not part of
        // contract/src/interfaces/IComet.sol. Left at 0 rather than guessed;
        // it is only used as a subtrahend in the simulator's utilization
        // denominator, where 0 is the conservative choice.
        reserves: 0n,
        paused,
      };
    }

    if (venue === 'aave') {
      const [aToken, pool] = await Promise.all([
        this.readAddress(ADAPTER_IFACE, adapter, 'aToken', [], blockNumber),
        this.readAddress(ADAPTER_IFACE, adapter, 'aavePool', [], blockNumber),
      ]);
      const [cash, reserveData] = await Promise.all([
        // AaveV3Adapter.maxWithdrawable (AaveV3Adapter.sol:123) uses exactly
        // this figure as the venue's same-transaction liquidity.
        this.readUint(ERC20_IFACE, usdc, 'balanceOf', [aToken], blockNumber),
        this.read(AAVE_POOL_IFACE, pool, 'getReserveData', [usdc], blockNumber),
      ]);
      const reserve = reserveData[0] as ethers.Result;
      const configuration = reserve.getValue('configuration') as ethers.Result;
      const flags = decodeAaveReserveFlags(configuration.getValue('data') as bigint);
      // Exact variable debt, read off the reserve's own debt token, rather
      // than inferred as (aToken supply - cash), which would silently absorb
      // accruedToTreasury, unbacked and any donation to the aToken.
      const borrows = await this.readUint(
        ERC20_IFACE,
        reserve.getValue('variableDebtTokenAddress') as string,
        'totalSupply',
        [],
        blockNumber
      );
      return {
        // reserves = 0: Aave's `accruedToTreasury` is denominated in SCALED
        // aToken units, not underlying, so it is not interchangeable with the
        // Compound-style `reserves` this field means. Reporting it here would
        // put a wrongly-scaled number into the rate simulator.
        utilizationWad: utilizationWad(cash, borrows, 0n),
        cash,
        borrows,
        reserves: 0n,
        // Frozen and inactive reserves reject supply() exactly as a paused one
        // does; AaveV3Adapter.maxDeployable (AaveV3Adapter.sol:129-133) treats
        // all three identically.
        paused: aaveReserveIsBlocked(flags),
      };
    }

    const mToken = await this.readAddress(ADAPTER_IFACE, adapter, 'mToken', [], blockNumber);
    const [cash, borrows, reserves, paused] = await Promise.all([
      this.readUint(MTOKEN_IFACE, mToken, 'getCash', [], blockNumber),
      this.readUint(MTOKEN_IFACE, mToken, 'totalBorrows', [], blockNumber),
      this.readUint(MTOKEN_IFACE, mToken, 'totalReserves', [], blockNumber),
      // MoonwellAdapter.isMintPaused (MoonwellAdapter.sol:156) ->
      // comptroller.mintGuardianPaused(mToken).
      this.readBool(ADAPTER_IFACE, adapter, 'isMintPaused', [], blockNumber),
    ]);
    return {
      // Exactly the (cash, borrows, reserves) triple MoonwellAdapter hands to
      // IMInterestRateModel.getSupplyRate (MoonwellAdapter.sol:139-141).
      utilizationWad: utilizationWad(cash, borrows, reserves),
      cash,
      borrows,
      reserves,
      paused,
    };
  }

  /**
   * Encode `fn(args)` against `iface`, `eth_call` it at `blockNumber`, and
   * decode the return by that same fragment.
   *
   * This replaces four near-identical helpers that each built calldata as
   * `ethers.id(name + '()').slice(0, 10)` after stripping the argument list
   * off the signature they were handed. An empty return is a REFUSAL, not a
   * zero: a contract that does not implement the selector reverts, and a
   * `'0x'` return means the address is not what the caller thinks it is.
   */
  private async read(
    iface: ethers.Interface,
    address: string,
    fn: string,
    args: ReadonlyArray<unknown>,
    blockNumber: number
  ): Promise<ethers.Result> {
    const data = iface.encodeFunctionData(fn, args as unknown[]);
    const raw = await this.client.call(address, data, blockNumber);
    if (!raw || raw === '0x') {
      throw new Error(
        `empty return from ${fn}() at ${address} @${blockNumber}: no contract there, or it does not implement that selector`
      );
    }
    return iface.decodeFunctionResult(fn, raw);
  }

  private async readUint(
    iface: ethers.Interface,
    address: string,
    fn: string,
    args: ReadonlyArray<unknown>,
    blockNumber: number
  ): Promise<bigint> {
    return (await this.read(iface, address, fn, args, blockNumber))[0] as bigint;
  }

  private async readBool(
    iface: ethers.Interface,
    address: string,
    fn: string,
    args: ReadonlyArray<unknown>,
    blockNumber: number
  ): Promise<boolean> {
    return (await this.read(iface, address, fn, args, blockNumber))[0] as boolean;
  }

  private async readAddress(
    iface: ethers.Interface,
    address: string,
    fn: string,
    args: ReadonlyArray<unknown>,
    blockNumber: number
  ): Promise<string> {
    return (await this.read(iface, address, fn, args, blockNumber))[0] as string;
  }

  private async readBytes32(
    iface: ethers.Interface,
    address: string,
    fn: string,
    args: ReadonlyArray<unknown>,
    blockNumber: number
  ): Promise<string> {
    return (await this.read(iface, address, fn, args, blockNumber))[0] as string;
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
        sequencerRound = await this.readUint(
          REWARD_ACCOUNTANT_IFACE,
          accountant,
          'lastRefreshTime',
          [],
          blockNumber
        );
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
    const cache = await this.read(
      REWARD_ACCOUNTANT_IFACE,
      address,
      'tokenCache',
      [tokenAddress],
      blockNumber
    );

    const value = cache.getValue('value') as bigint;
    const lastUpdated = cache.getValue('lastUpdated') as bigint;

    // Check staleness based on maxAge from tokenPolicies (if available)
    // For simplicity, we consider stale if lastUpdated is 0 or very old
    const now = BigInt(Math.floor(Date.now() / 1000));
    const isStale = lastUpdated === 0n || now - lastUpdated > 3600n;

    return { value, lastUpdated, isStale };
  }
}
