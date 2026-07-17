import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { FarmingService } from './farming.service';
import { AuditService } from '../audit/audit.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { DelegationService } from './delegation.service';

// Bounds are USDC base units (6 dec) post-migration; `rentBuffer` is retained under
// its original name and now means the USDC dust to leave un-deposited.
export interface FarmBounds { rentBuffer: number; minDeposit: number; maxDeposit: number; }
export const FARM_BOUNDS = Symbol('FARM_BOUNDS');

const usdcIface = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);

@Injectable()
export class FarmingAgentScheduler {
  private readonly logger = new Logger(FarmingAgentScheduler.name);
  private readonly usdc: ethers.Contract;
  // In-flight guard: a slow tick must not overlap the next cron fire, else a subwallet could be
  // double-funded / double-deposited before the first run's balance reads settle.
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly farming: FarmingService,
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
    private readonly audit: AuditService,
    @Inject(FARM_BOUNDS) private readonly bounds: FarmBounds,
    private readonly delegation: DelegationService,
  ) {
    // Circle USDC (the unified farming + payment token).
    this.usdc = new ethers.Contract(this.evm.usdcAddress, usdcIface, this.evm.provider);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    if (this.running) {
      this.logger.warn('farming tick still running; skipping this fire to avoid double-fund/deposit');
      return;
    }
    this.running = true;
    try {
      await this.tickOnce();
    } finally {
      this.running = false;
    }
  }

  private async usdcBalance(address: string): Promise<number> {
    const bal: bigint = await this.usdc.balanceOf(address);
    return Number(bal);
  }

  async tickOnce(): Promise<void> {
    const subs = await this.prisma.farmingSubwallet.findMany({ where: { status: 'active' } });
    for (const sw of subs) {
      try {
        let idle = await this.usdcBalance(sw.pubkey);
        if (idle < this.bounds.minDeposit) {
          const funded = await this.delegation.autoFundSubwallet({ id: sw.id, pubkey: sw.pubkey, userId: sw.userId });
          if (funded && 'txSignature' in funded) {
            idle = await this.usdcBalance(sw.pubkey);
          }
        }
        const depositable = idle - this.bounds.rentBuffer;
        if (depositable >= this.bounds.minDeposit) {
          const amount = BigInt(Math.min(depositable, this.bounds.maxDeposit));
          await this.farming.depositSubwallet(sw, amount);
        }
        await this.farming.refreshSubwallet(sw);
      } catch (e) {
        await this.audit.record({ actor: `subwallet:${sw.pubkey}`, action: 'farming.agent.skip', metadata: { error: (e as Error).message } });
      }
    }
  }
}
