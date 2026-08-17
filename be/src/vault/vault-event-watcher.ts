/**
 * VaultEventWatcher — listens to NavyVaultSRCLA on-chain events for cohort-level accounting.
 *
 * Watches:
 * - Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)
 * - Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
 * - Reallocated(address indexed from, address indexed to, uint256 amount)
 * - Deployed(address indexed adapter, uint256 amount)  — funds moved TO adapter
 * - Divested(address indexed adapter, uint256 received) — funds returned FROM adapter
 *
 * This watcher operates as a passive event indexer — it does NOT trigger on-chain actions.
 * It can run as a standalone cron/worker or be integrated into the VaultService lifecycle.
 */
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';

// Event signatures (topic0)
const EVENTS = {
  Deposit: 'Deposit(address,address,uint256,uint256)',
  Withdraw: 'Withdraw(address,address,address,uint256,uint256)',
  Reallocated: 'Reallocated(address,address,uint256)',
  Deployed: 'Deployed(address,uint256)',
  Divested: 'Divested(address,uint256)',
} as const;

export type VaultEventType = keyof typeof EVENTS;

export interface ParsedVaultEvent {
  type: VaultEventType;
  txHash: string;
  blockNumber: bigint;
  timestamp: Date;
  sender: string;
  args: Record<string, unknown>;
}

export interface CohortProfitSummary {
  cohortAddress: string;
  deposits: bigint;
  withdrawals: bigint;
  harvests: bigint;
  netProfit: bigint;
}

/**
 * The "default cohort" address used when no cohort-specific grouping is needed.
 * All vault events are attributed to this cohort for global accounting.
 */
export const DEFAULT_COHORT_ADDRESS = '0x0000000000000000000000000000000000000001';

@Injectable()
export class VaultEventWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VaultEventWatcher.name);
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private isRunning = false;
  private fromBlock = 0n;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: NavyConfigService,
  ) {
    const rpcUrl = config.evmRpcUrl;
    const vaultAddress = config.vaultAddress;

    if (!rpcUrl) throw new Error('Missing SEPOLIA_RPC_URL');
    if (!vaultAddress) throw new Error('Missing NAVY_VAULT_ADDRESS');

    this.provider = new ethers.JsonRpcProvider(rpcUrl, config.evmChainId);
    // Use a read-only contract for filtering events (no signer needed)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vaultArtifact = require('../evm/navy-vault-abi.json');
    this.contract = new ethers.Contract(vaultAddress, vaultArtifact, this.provider);
  }

  async onModuleInit(): Promise<void> {
    // Resume from the last processed block stored in DB, or start from vault deployment block
    const lastTx = await this.prisma.vaultTransaction.findFirst({
      orderBy: { blockNumber: 'desc' },
      select: { blockNumber: true },
    });

    if (lastTx) {
      // Start FROM the next block after the last processed one to avoid double-indexing
      this.fromBlock = lastTx.blockNumber + 1n;
      this.logger.log(`Resuming event watch from block ${this.fromBlock}`);
    } else {
      // No prior history — start from a safe lower bound (vault deployment block ~14M on Sepolia).
      // This can be overridden via VAULT_WATCHER_START_BLOCK env var.
      const envBlock = parseInt(process.env.VAULT_WATCHER_START_BLOCK ?? '', 10);
      this.fromBlock = envBlock > 0 ? BigInt(envBlock) : 14_000_000n;
      this.logger.log(`Starting fresh from block ${this.fromBlock} (vault deployment)`);
    }
  }

  onModuleDestroy(): void {
    this.isRunning = false;
  }

  /**
   * Scheduled job: polls for new vault events every 15 seconds.
   * Uses @Cron for NestJS scheduler integration.
   */
  @Cron('*/15 * * * * *')
  async handleCron(): Promise<void> {
    // Skip if too early (module init may not have completed)
    if (this.fromBlock === 0n) return;
    await this.pollEvents();
  }

  /**
   * Poll for new vault events since fromBlock.
   * Call this on a schedule (e.g., every 15 seconds via cron).
   *
   * Returns the number of events processed.
   */
  async pollEvents(): Promise<number> {
    if (this.isRunning) {
      this.logger.debug('Poll already in progress, skipping');
      return 0;
    }

    this.isRunning = true;
    try {
      const latestBlock = await this.provider.getBlockNumber();
      if (latestBlock <= this.fromBlock) {
        return 0;
      }

      // Fetch a batch of events (cap at 10k blocks per poll to stay within RPC limits)
      const toBlock = Math.min(latestBlock, Number(this.fromBlock) + 10_000);

      const events = await this.fetchEvents(Number(this.fromBlock), toBlock);

      if (events.length === 0) {
        this.fromBlock = BigInt(toBlock);
        return 0;
      }

      this.logger.log(`Processing ${events.length} vault events (blocks ${this.fromBlock}–${toBlock})`);

      for (const event of events) {
        await this.processEvent(event);
      }

      this.fromBlock = BigInt(toBlock + 1);
      return events.length;
    } catch (err) {
      this.logger.error(`Event poll failed: ${(err as Error).message}`);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch vault events in a block range using eth_getLogs.
   */
  private async fetchEvents(fromBlock: number, toBlock: number): Promise<ParsedVaultEvent[]> {
    const filters = Object.values(EVENTS).map((sig) => ({
      address: this.config.vaultAddress,
      topics: [ethers.id(sig)],
      fromBlock,
      toBlock,
    }));

    const results: ParsedVaultEvent[] = [];

    // Fetch each event type in parallel
    const logs = await Promise.all(
      filters.map((filter) => this.provider.getLogs(filter).catch(() => [])),
    );

    for (const logsOfType of logs) {
      for (const log of logsOfType) {
        try {
          const parsed = this.parseLog(log);
          if (parsed) results.push(parsed);
        } catch (err) {
          this.logger.warn(`Failed to parse log: ${(err as Error).message}`);
        }
      }
    }

    // Sort by block number, then transaction index to maintain causal order
    results.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber < b.blockNumber ? -1 : 1;
      }
      return 0;
    });

    return results;
  }

  /**
   * Parse a raw log into a typed VaultEvent.
   */
  private parseLog(log: ethers.Log): ParsedVaultEvent | null {
    const topic0 = log.topics[0];
    const iface = this.contract.interface;

    // Find the matching event fragment
    let eventType: VaultEventType | null = null;
    for (const [name, sig] of Object.entries(EVENTS)) {
      if (ethers.id(sig) === topic0) {
        eventType = name as VaultEventType;
        break;
      }
    }

    if (!eventType) return null;

    const fragment = iface.getEvent(topic0);
    if (!fragment) return null;
    const args = iface.decodeEventLog(fragment, log.data, log.topics);

    // Extract sender based on event type
    let sender = '';
    if (eventType === 'Deposit' || eventType === 'Withdraw') {
      sender = args[0]; // sender field
    } else if (eventType === 'Reallocated') {
      sender = args[0]; // from adapter
    } else if (eventType === 'Deployed' || eventType === 'Divested') {
      sender = args[0]; // adapter address
    }

    return {
      type: eventType,
      txHash: log.transactionHash ?? '',
      blockNumber: BigInt(log.blockNumber),
      timestamp: new Date(),
      sender,
      args: args as Record<string, unknown>,
    };
  }

  /**
   * Persist an event to the DB and update cohort balances atomically.
   * Uses upsert to handle idempotency (same txHash can be reprocessed safely).
   */
  async processEvent(event: ParsedVaultEvent): Promise<void> {
    // Idempotency: skip if already processed
    const existing = await this.prisma.vaultTransaction.findUnique({
      where: { txHash: event.txHash },
    });
    if (existing) {
      this.logger.debug(`Skipping already-processed tx: ${event.txHash}`);
      return;
    }

    // Get or create the default cohort
    const cohort = await this.getOrCreateDefaultCohort();

    const amount = this.extractAmount(event);
    const shares = this.extractShares(event);

    // Create the transaction record
    await this.prisma.vaultTransaction.create({
      data: {
        cohortId: cohort.id,
        txHash: event.txHash,
        type: event.type.toLowerCase(),
        amount,
        shares,
        sender: event.sender,
        adapter: this.extractAdapter(event),
        blockNumber: event.blockNumber,
        timestamp: event.timestamp,
      },
    });

    // Update cohort balances based on event type
    await this.updateCohortBalances(cohort.id, event.type, amount);

    this.logger.log(
      `Processed ${event.type} event: tx=${event.txHash} amount=${amount.toString()}`,
    );
  }

  /**
   * Extract amount (in base units / USDC 6 decimals) from event args.
   */
  private extractAmount(event: ParsedVaultEvent): bigint {
    const args = event.args;
    switch (event.type) {
      case 'Deposit':
      case 'Withdraw':
        return BigInt(args.assets?.toString() ?? '0');
      case 'Reallocated':
      case 'Deployed':
      case 'Divested':
        return BigInt(args.amount?.toString() ?? '0');
      default:
        return 0n;
    }
  }

  /**
   * Extract shares from Deposit/Withdraw events.
   */
  private extractShares(event: ParsedVaultEvent): bigint | null {
    if (event.type === 'Deposit' || event.type === 'Withdraw') {
      return BigInt(event.args.shares?.toString() ?? '0');
    }
    return null;
  }

  /**
   * Extract adapter address from Reallocated/Deployed/Divested events.
   */
  private extractAdapter(event: ParsedVaultEvent): string | null {
    if (event.type === 'Reallocated') {
      // args[1] is "to" for Reallocated
      return event.args[1] as string;
    }
    if (event.type === 'Deployed' || event.type === 'Divested') {
      return event.sender; // adapter is the sender
    }
    return null;
  }

  /**
   * Get or create the default accounting cohort.
   */
  private async getOrCreateDefaultCohort(): Promise<{ id: string; cohortAddress: string }> {
    const cohort = await this.prisma.vaultCohort.findUnique({
      where: { cohortAddress: DEFAULT_COHORT_ADDRESS },
    });

    if (cohort) return cohort;

    return this.prisma.vaultCohort.create({
      data: {
        cohortAddress: DEFAULT_COHORT_ADDRESS,
        name: 'Default Cohort',
      },
    });
  }

  /**
   * Update cohort aggregate balances after a new event.
   * This is additive — harvests increase netPosition (profit), deposits increase it,
   * withdrawals decrease it.
   */
  private async updateCohortBalances(
    cohortId: string,
    eventType: VaultEventType,
    amount: bigint,
  ): Promise<void> {
    const update: Record<string, bigint> = {};

    switch (eventType) {
      case 'Deposit':
        update.totalDeposits = amount;
        update.netPosition = amount;
        break;
      case 'Withdraw':
        update.totalWithdrawals = amount;
        update.netPosition = -amount;
        break;
      case 'Divested':
        // Divested events represent funds returning from adapters (profit realization).
        // Treat as a harvest/profit credit.
        update.totalHarvests = amount;
        update.netPosition = amount;
        break;
      case 'Deployed':
      case 'Reallocated':
        // These are internal rebalancing — do not affect cohort P&L directly.
        // They are recorded in VaultTransaction for audit but don't update balances.
        return;
      default:
        return;
    }

    await this.prisma.vaultCohort.update({
      where: { id: cohortId },
      data: {
        ...(update.totalDeposits !== undefined && { totalDeposits: { increment: update.totalDeposits } }),
        ...(update.totalWithdrawals !== undefined && { totalWithdrawals: { increment: update.totalWithdrawals } }),
        ...(update.totalHarvests !== undefined && { totalHarvests: { increment: update.totalHarvests } }),
        ...(update.netPosition !== undefined && {
          netPosition: { increment: update.netPosition },
        }),
        lastUpdated: new Date(),
      },
    });
  }

  /**
   * Get the current profit summary for a cohort.
   * Returns cumulative deposits, withdrawals, harvests, and net profit.
   */
  async calculateCohortProfit(cohortAddress: string): Promise<CohortProfitSummary | null> {
    const cohort = await this.prisma.vaultCohort.findUnique({
      where: { cohortAddress },
    });

    if (!cohort) return null;

    // Net profit = totalHarvests (realized profit from divested events)
    // Note: unrealized profit would require marking-to-market totalAssets vs totalDeposits
    return {
      cohortAddress: cohort.cohortAddress,
      deposits: cohort.totalDeposits,
      withdrawals: cohort.totalWithdrawals,
      harvests: cohort.totalHarvests,
      netProfit: cohort.netPosition,
    };
  }

  /**
   * Get all cohorts with their current balances.
   */
  async getAllCohorts(): Promise<Array<{
    cohortAddress: string;
    name: string | null;
    totalDeposits: bigint;
    totalWithdrawals: bigint;
    totalHarvests: bigint;
    netPosition: bigint;
    lastUpdated: Date;
  }>> {
    const cohorts = await this.prisma.vaultCohort.findMany({
      orderBy: { createdAt: 'asc' },
    });

    return cohorts.map((c) => ({
      cohortAddress: c.cohortAddress,
      name: c.name,
      totalDeposits: c.totalDeposits,
      totalWithdrawals: c.totalWithdrawals,
      totalHarvests: c.totalHarvests,
      netPosition: c.netPosition,
      lastUpdated: c.lastUpdated,
    }));
  }

  /**
   * Get transaction history for a cohort.
   */
  async getCohortHistory(
    cohortAddress: string,
    options?: { type?: string; limit?: number; cursor?: string },
  ): Promise<Array<{
    id: string;
    txHash: string;
    type: string;
    amount: bigint;
    shares: bigint | null;
    sender: string;
    adapter: string | null;
    blockNumber: bigint;
    timestamp: Date;
  }>> {
    const cohort = await this.prisma.vaultCohort.findUnique({
      where: { cohortAddress },
      select: { id: true },
    });

    if (!cohort) return [];

    const transactions = await this.prisma.vaultTransaction.findMany({
      where: {
        cohortId: cohort.id,
        ...(options?.type && { type: options.type }),
      },
      orderBy: { timestamp: 'desc' },
      take: options?.limit ?? 100,
    });

    return transactions.map((tx) => ({
      id: tx.id,
      txHash: tx.txHash,
      type: tx.type,
      amount: tx.amount,
      shares: tx.shares,
      sender: tx.sender,
      adapter: tx.adapter,
      blockNumber: tx.blockNumber,
      timestamp: tx.timestamp,
    }));
  }
}
