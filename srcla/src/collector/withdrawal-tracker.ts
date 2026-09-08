import { Filter } from 'ethers';
import { ChainClient } from '../chain/client.js';
import { VAULT_EVENTS_IFACE, WITHDRAW_TOPIC } from '../chain/contract-abis.js';
import { PrismaClient } from '@prisma/client';

/**
 * A finalized ERC-4626 `Withdraw` from the vault.
 */
export interface WithdrawalEvent {
  blockHash: string;
  timestamp: Date;
  /**
   * The account whose shares were burned (the ERC-4626 `owner`), NOT the
   * caller. Under Navy's gasless redeem the caller is always the relayer, so
   * `sender` would identify the relayer on every single event and carry no
   * information at all. Persisted into the `WithdrawalEvent.sender` column,
   * which predates this distinction.
   */
  owner: string;
  /** The ERC-4626 `sender` — whoever called `withdraw`/`redeem`. */
  caller: string;
  /** The ERC-4626 `receiver` — where the assets were sent. */
  receiver: string;
  assets: bigint;
  shares: bigint;
  /** Position of the log within its block, used as the deduplication key. */
  logIndex: number;
  regimeId?: string;
}

/**
 * Withdrawal log from ethers provider
 */
interface WithdrawalLog {
  address: string;
  topics: string[];
  data: string;
  blockHash: string;
  blockNumber: number;
  /** Position of this log within its block — part of the dedup key. */
  logIndex: number;
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
    // Paper §7.3/§10.1: observations must come from FINALIZED blocks. This
    // read `getBlockNumber()` (the chain head), so a reorg could retract a
    // withdrawal that had already been folded into the reserve quantile.
    const finalized = await this.chainClient.getFinalizedBlock();
    const currentBlock = Number(finalized.number);

    if (fromBlock >= currentBlock) {
      return [];
    }

    // Build filter for the vault's ERC-4626 Withdraw events
    const filter: Filter = {
      address: this.vaultAddress,
      topics: [WITHDRAW_TOPIC],
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
        logIndex: log.index,
        timestamp: blockTimestamps.get(log.blockNumber),
      };
      const event = this.parseWithdrawalLog(parsedLog);
      if (event) {
        events.push(event);
        // Store in database
        await this.storeWithdrawalEvent(event);
      }
    }

    console.log(`[WithdrawalTracker] Collected ${events.length} withdrawal events from finalized blocks ${fromBlock + 1}-${currentBlock}`);
    return events;
  }

  /**
   * Get historical withdrawal amounts for quantile calculation.
   * Returns assets amounts for withdrawals within the specified window.
   */
  async getWithdrawalHistory(
    windowDays: number,
    nowSeconds: number,
    owner?: string
  ): Promise<bigint[]> {
    // Previously `where: { sender: marketId }` against `new Date()`. The
    // column holds a withdrawing ACCOUNT, never a market id, so the filter
    // matched nothing for every caller; and anchoring the window on wall
    // clock rather than on the caller's origin time makes the result
    // non-reproducible from a snapshot. Both are fixed here.
    const cutoff = new Date((nowSeconds - windowDays * 86_400) * 1000);

    const events = await this.prisma.withdrawalEvent.findMany({
      where: {
        ...(owner ? { sender: owner } : {}),
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
   * Parse an ERC-4626 `Withdraw` log into a WithdrawalEvent.
   *
   * `Withdraw(address indexed sender, address indexed receiver,
   *           address indexed owner, uint256 assets, uint256 shares)` —
   * THREE indexed parameters, so `assets` and `shares` are the only two words
   * in `data`. The previous implementation assumed the (nonexistent)
   * `Withdrawal(address indexed sender, uint256, uint256)` shape and read
   * `topics[1]` as the withdrawing account; under this real event `topics[1]`
   * is the caller and `topics[3]` is the owner.
   *
   * Decoded by name through the interface rather than by slicing words, so a
   * future parameter change cannot silently shift which value is read.
   */
  private parseWithdrawalLog(log: WithdrawalLog): WithdrawalEvent | null {
    try {
      const decoded = VAULT_EVENTS_IFACE.decodeEventLog('Withdraw', log.data, log.topics);

      // Get timestamp from the pre-fetched block data
      const timestamp = log.timestamp ? new Date(log.timestamp * 1000) : new Date();

      return {
        blockHash: log.blockHash,
        timestamp,
        logIndex: log.logIndex,
        caller: decoded.getValue('sender') as string,
        receiver: decoded.getValue('receiver') as string,
        owner: decoded.getValue('owner') as string,
        assets: decoded.getValue('assets') as bigint,
        shares: decoded.getValue('shares') as bigint,
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
        // The `sender` COLUMN carries the ERC-4626 `owner` — see the doc on
        // WithdrawalEvent.owner. Renaming the column needs a migration.
        sender: event.owner,
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
   * Deduplication key. (blockHash, logIndex) is the only pair that uniquely
   * identifies a log; the previous key was a 32-bit string hash of
   * (blockHash, account, assets, shares), which collapsed two identical
   * withdrawals by the same account in the same block into one row and
   * therefore under-counted withdrawal demand exactly when it spikes.
   */
  private hashEventKey(event: WithdrawalEvent): string {
    return `we_${event.blockHash}_${event.logIndex}`;
  }
}
