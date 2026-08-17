import { ethers, Filter } from 'ethers';
import { ChainClient } from '../chain/client.js';
import { PrismaClient } from '@prisma/client';

/**
 * Withdrawal event from the vault
 */
export interface WithdrawalEvent {
  blockHash: string;
  timestamp: Date;
  sender: string;
  assets: bigint;
  shares: bigint;
  regimeId?: string;
}

/**
 * Withdrawal event signature: Withdrawal(address indexed sender, uint256 assets, uint256 shares)
 */
const WITHDRAWAL_TOPIC = ethers.id('Withdrawal(address,uint256,uint256)');

/**
 * Withdrawal log from ethers provider
 */
interface WithdrawalLog {
  address: string;
  topics: string[];
  data: string;
  blockHash: string;
  blockNumber: number;
  timestamp: number | undefined;
}

/**
 * WithdrawalTracker collects withdrawal events from the vault for quantile reserve calculation.
 *
 * The SRCLA reserve calculation uses:
 * quantileReserve = percentile(withdrawals, 95th)
 *
 * This tracker fetches Withdrawal events from the vault contract and persists them to the database.
 */
export class WithdrawalTracker {
  constructor(
    private readonly chainClient: ChainClient,
    private readonly vaultAddress: string,
    private readonly prisma: PrismaClient
  ) {}

  /**
   * Collect withdrawal events since the given block number.
   * Parses Withdrawal events from the vault contract and stores them in the database.
   */
  async collectSince(fromBlock: number): Promise<WithdrawalEvent[]> {
    const currentBlock = await this.chainClient.getBlockNumber();

    if (fromBlock >= currentBlock) {
      return [];
    }

    // Build filter for Withdrawal events from the vault
    const filter: Filter = {
      address: this.vaultAddress,
      topics: [WITHDRAWAL_TOPIC],
      fromBlock: fromBlock + 1,
      toBlock: currentBlock,
    };

    const logs = await this.chainClient.getLogs(filter);

    if (logs.length === 0) {
      return [];
    }

    // Fetch block timestamps for the logs
    const blockTimestamps = new Map<number, number>();
    for (const log of logs) {
      if (!blockTimestamps.has(log.blockNumber)) {
        const block = await this.chainClient.getBlock(log.blockNumber);
        if (block) {
          blockTimestamps.set(log.blockNumber, Number(block.timestamp));
        }
      }
    }

    const events: WithdrawalEvent[] = [];

    for (const log of logs) {
      const parsedLog: WithdrawalLog = {
        address: log.address,
        topics: [...log.topics],
        data: log.data,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        timestamp: blockTimestamps.get(log.blockNumber),
      };
      const event = this.parseWithdrawalLog(parsedLog);
      if (event) {
        events.push(event);
        // Store in database
        await this.storeWithdrawalEvent(event);
      }
    }

    console.log(`[WithdrawalTracker] Collected ${events.length} withdrawal events from blocks ${fromBlock + 1}-${currentBlock}`);
    return events;
  }

  /**
   * Get historical withdrawal amounts for quantile calculation.
   * Returns assets amounts for withdrawals within the specified window.
   */
  async getWithdrawalHistory(marketId: string, windowDays: number): Promise<bigint[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const events = await this.prisma.withdrawalEvent.findMany({
      where: {
        sender: marketId,
        timestamp: {
          gte: cutoff,
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
    });

    return events.map((e) => BigInt(e.assets));
  }

  /**
   * Get the last processed block number from the database.
   * Returns 0 if no events have been processed yet.
   */
  async getLastProcessedBlock(): Promise<number> {
    const lastEvent = await this.prisma.withdrawalEvent.findFirst({
      orderBy: {
        timestamp: 'desc',
      },
    });

    if (!lastEvent) {
      return 0;
    }

    // Get block number from block hash by querying the chain block table
    const chainBlock = await this.prisma.chainBlock.findUnique({
      where: {
        blockHash: lastEvent.blockHash,
      },
    });

    if (chainBlock) {
      return Number(chainBlock.blockNumber);
    }

    return 0;
  }

  /**
   * Parse a Withdrawal log entry into a WithdrawalEvent.
   * The log data layout:
   * - topic[1]: sender address (indexed)
   * - data[0]: assets (uint256)
   * - data[1]: shares (uint256)
   */
  private parseWithdrawalLog(log: WithdrawalLog): WithdrawalEvent | null {
    if (!log.data || log.data === '0x') {
      return null;
    }

    try {
      // Parse the log data
      // After the 3 topics (event signature + indexed sender), the data contains:
      // - assets (uint256) at offset 0
      // - shares (uint256) at offset 32
      const data = log.data.slice(2); // Remove '0x' prefix
      const words: string[] = [];

      for (let i = 0; i < data.length; i += 64) {
        words.push(data.slice(i, i + 64) as string);
      }

      if (words.length < 2) {
        return null;
      }

      // Parse assets and shares (uint256 values)
      const assets = ethers.toBigInt('0x' + words[0]);
      const shares = ethers.toBigInt('0x' + words[1]);

      // Get sender from topic (indexed parameter)
      // topic[0] = event signature hash
      // topic[1] = sender address (indexed)
      const senderTopic = log.topics[1];
      if (!senderTopic) {
        return null;
      }

      // Extract address from topic (last 20 bytes / 40 hex chars)
      const sender = '0x' + senderTopic.slice(-40);

      // Get timestamp from the pre-fetched block data
      const timestamp = log.timestamp ? new Date(log.timestamp * 1000) : new Date();

      return {
        blockHash: log.blockHash,
        timestamp,
        sender,
        assets,
        shares,
      };
    } catch (error) {
      console.error('[WithdrawalTracker] Failed to parse withdrawal log:', error);
      return null;
    }
  }

  /**
   * Store a withdrawal event in the database.
   * Uses upsert to handle potential duplicates (same blockHash + sender + assets).
   */
  private async storeWithdrawalEvent(event: WithdrawalEvent): Promise<void> {
    // Create a unique key for deduplication based on blockHash and a hash of the event data
    const eventKey = this.hashEventKey(event);

    await this.prisma.withdrawalEvent.upsert({
      where: {
        id: eventKey, // Use hash as id for deduplication
      },
      create: {
        id: eventKey,
        blockHash: event.blockHash,
        timestamp: event.timestamp,
        sender: event.sender,
        assets: event.assets.toString(),
        shares: event.shares.toString(),
        regimeId: event.regimeId ?? null,
      },
      update: {
        // No update needed for duplicate events
      },
    });
  }

  /**
   * Generate a unique key for event deduplication.
   */
  private hashEventKey(event: WithdrawalEvent): string {
    const data = `${event.blockHash}-${event.sender}-${event.assets}-${event.shares}`;
    // Simple deterministic ID based on event data
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'we_' + Math.abs(hash).toString(36) + '_' + event.blockHash.slice(0, 8);
  }
}
