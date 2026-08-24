/**
 * Collector Orchestrator
 *
 * Orchestrates the complete data collection cycle:
 * - Vault snapshots
 * - Strategy snapshots
 * - Withdrawal events
 * - Chain blocks
 *
 * Integrates with the database for persistence.
 */
import { SnapshotCollector } from './snapshot-collector.js';
import { WithdrawalTracker } from './withdrawal-tracker.js';
import { ChainClient } from '../chain/client.js';
import { getPrisma } from '../db/client.js';
import {
  WithdrawalRepository,
} from '../db/repositories/index.js';
import type { CollectedSnapshot, VaultSnapshot, StrategySnapshot, CollectorConfig } from './types.js';

export interface CollectionCycleResult {
  success: boolean;
  blockNumber: number;
  blockHash: string;
  timestamp: Date;
  vaultSnapshot: VaultSnapshot | null;
  strategySnapshots: StrategySnapshot[];
  withdrawalEvents: number;
  errors: string[];
}

export interface OrchestratorConfig {
  vaultAddress: string;
  strategyAddresses: {
    aave?: string;
    compound?: string;
    moonwell?: string;
  };
  chainRpcUrl: string;
  chainId: number;
  rewardAccountantAddress?: string | undefined;
  rewardExecutorAddress?: string | undefined;
}

/**
 * Collector Orchestrator
 *
 * Runs the complete collection cycle and persists data to the database.
 */
export class CollectorOrchestrator {
  private snapshotCollector: SnapshotCollector;
  private withdrawalTracker: WithdrawalTracker;
  private chainClient: ChainClient;
  private withdrawalRepo: WithdrawalRepository;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;

    this.chainClient = new ChainClient({
      rpcUrl: config.chainRpcUrl,
      chainId: config.chainId,
    });

    const collectorConfig: CollectorConfig = {
      vaultAddress: config.vaultAddress,
      strategyAddresses: {
        aave: config.strategyAddresses.aave ?? '',
        compound: config.strategyAddresses.compound ?? '',
        moonwell: config.strategyAddresses.moonwell ?? '',
      },
      usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      rewardAccountantAddress: config.rewardAccountantAddress,
      rewardExecutorAddress: config.rewardExecutorAddress,
    };

    this.snapshotCollector = new SnapshotCollector(this.chainClient, collectorConfig);
    this.withdrawalTracker = new WithdrawalTracker(
      this.chainClient,
      config.vaultAddress,
      getPrisma()
    );

    const prisma = getPrisma();
    this.withdrawalRepo = new WithdrawalRepository(prisma);
  }

  /**
   * Run a complete collection cycle
   */
  async runCollectionCycle(): Promise<CollectionCycleResult> {
    const errors: string[] = [];
    let collectedSnapshot: CollectedSnapshot | null = null;

    try {
      // 1. Collect vault and strategy snapshots
      collectedSnapshot = await this.snapshotCollector.collect();

      if (collectedSnapshot) {
        // 2. Store chain block
        await this.storeChainBlock(collectedSnapshot);

        // 3. Store vault snapshot
        if (collectedSnapshot.vault) {
          await this.storeVaultSnapshot(collectedSnapshot);
        }

        // 4. Store strategy snapshots
        for (const strategy of collectedSnapshot.strategies) {
          await this.storeStrategySnapshot(strategy, collectedSnapshot);
        }
      }
    } catch (error) {
      errors.push(`Snapshot collection error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    let withdrawalCount = 0;
    try {
      // 5. Collect withdrawal events since last processed block
      const lastBlock = await this.withdrawalRepo.getLastProcessedBlock();
      const events = await this.withdrawalTracker.collectSince(lastBlock);
      withdrawalCount = events.length;
    } catch (error) {
      errors.push(`Withdrawal collection error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    return {
      success: errors.length === 0,
      blockNumber: collectedSnapshot?.blockNumber ?? 0,
      blockHash: collectedSnapshot?.blockHash ?? '',
      timestamp: collectedSnapshot?.timestamp ?? new Date(),
      vaultSnapshot: collectedSnapshot?.vault ?? null,
      strategySnapshots: collectedSnapshot?.strategies ?? [],
      withdrawalEvents: withdrawalCount,
      errors,
    };
  }

  /**
   * Store chain block record
   */
  private async storeChainBlock(snapshot: CollectedSnapshot): Promise<void> {
    const prisma = getPrisma();
    await prisma.chainBlock.upsert({
      where: { blockHash: snapshot.blockHash },
      create: {
        blockHash: snapshot.blockHash,
        chainId: this.config.chainId,
        blockNumber: BigInt(snapshot.blockNumber),
        timestamp: snapshot.timestamp,
      },
      update: {},
    });
  }

  /**
   * Store vault snapshot (as market snapshot with marketId = 'vault')
   */
  private async storeVaultSnapshot(snapshot: CollectedSnapshot): Promise<void> {
    const vault = snapshot.vault!;

    const prisma = getPrisma();
    await prisma.marketSnapshot.upsert({
      where: {
        marketId_blockHash: {
          marketId: 'vault',
          blockHash: snapshot.blockHash,
        },
      },
      create: {
        marketId: 'vault',
        blockHash: snapshot.blockHash,
        timestamp: snapshot.timestamp,
        totalAssetsBase: vault.totalAssets.toString(),
        idleBase: vault.idleBase.toString(),
        supplyRateE18: '0', // Vault doesn't have a supply rate
        utilizationE18: '0',
        cashBase: vault.idleBase.toString(),
        borrowsBase: '0',
        reservesBase: '0',
        capBps: 10000,
        paused: vault.paused,
        configDigest: 'vault',
      },
      update: {},
    });
  }

  /**
   * Store strategy snapshot as market snapshot
   */
  private async storeStrategySnapshot(
    strategy: StrategySnapshot,
    parentSnapshot: CollectedSnapshot
  ): Promise<void> {
    const prisma = getPrisma();
    await prisma.marketSnapshot.upsert({
      where: {
        marketId_blockHash: {
          marketId: strategy.address,
          blockHash: parentSnapshot.blockHash,
        },
      },
      create: {
        marketId: strategy.address,
        blockHash: parentSnapshot.blockHash,
        timestamp: parentSnapshot.timestamp,
        totalAssetsBase: strategy.totalAssets.toString(),
        idleBase: '0',
        supplyRateE18: strategy.supplyRate.toString(),
        utilizationE18: strategy.utilization.toString(),
        cashBase: strategy.cash.toString(),
        borrowsBase: '0',
        reservesBase: '0',
        capBps: 10000,
        paused: strategy.paused,
        configDigest: strategy.configDigest,
      },
      update: {},
    });
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{
    lastBlock: number;
    totalSnapshots: number;
    totalWithdrawals: number;
    lastCollection: Date | null;
  }> {
    const prisma = getPrisma();

    const [lastSnapshot, totalSnapshots, totalWithdrawals] = await Promise.all([
      prisma.marketSnapshot.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { blockHash: true },
      }),
      prisma.marketSnapshot.count(),
      prisma.withdrawalEvent.count(),
    ]);

    const lastWithdrawal = await prisma.withdrawalEvent.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    let lastBlock = 0;
    if (lastSnapshot) {
      const chainBlock = await prisma.chainBlock.findUnique({
        where: { blockHash: lastSnapshot.blockHash },
      });
      lastBlock = chainBlock ? Number(chainBlock.blockNumber) : 0;
    }

    return {
      lastBlock,
      totalSnapshots,
      totalWithdrawals,
      lastCollection: lastWithdrawal?.timestamp ?? null,
    };
  }

  /**
   * Close connections
   */
  close(): void {
    this.chainClient.close();
  }
}
