import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { FarmingService } from './farming.service';
import { AuditService } from '../audit/audit.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { DelegationService } from './delegation.service';

export interface FarmBounds { rentBuffer: number; minDeposit: number; maxDeposit: number; }
export const FARM_BOUNDS = Symbol('FARM_BOUNDS');

@Injectable()
export class FarmingAgentScheduler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farming: FarmingService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly audit: AuditService,
    @Inject(FARM_BOUNDS) private readonly bounds: FarmBounds,
    private readonly delegation: DelegationService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() { await this.tickOnce(); }

  async tickOnce(): Promise<void> {
    const subs = await this.prisma.farmingSubwallet.findMany({ where: { status: 'active' } });
    for (const sw of subs) {
      try {
        const idle = await this.chain.connection.getBalance(new PublicKey(sw.pubkey));
        if (idle < this.bounds.minDeposit) {
          await this.delegation.autoFundSubwallet({ id: sw.id, pubkey: sw.pubkey, userId: sw.userId });
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
