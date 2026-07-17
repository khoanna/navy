import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { FarmingService } from './farming.service';
import { AuditService } from '../audit/audit.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { FARM_USDC } from './aave-yield-adapter';
import { DelegationService } from './delegation.service';

// Bounds are USDC base units (6 dec) post-migration; `rentBuffer` is retained under
// its original name and now means the USDC dust to leave un-deposited.
export interface FarmBounds { rentBuffer: number; minDeposit: number; maxDeposit: number; }
export const FARM_BOUNDS = Symbol('FARM_BOUNDS');

const usdcIface = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);

@Injectable()
export class FarmingAgentScheduler {
  private readonly usdc: ethers.Contract;

  constructor(
    private readonly prisma: PrismaService,
    private readonly farming: FarmingService,
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
    private readonly audit: AuditService,
    @Inject(FARM_BOUNDS) private readonly bounds: FarmBounds,
    private readonly delegation: DelegationService,
  ) {
    this.usdc = new ethers.Contract(FARM_USDC, usdcIface, this.evm.provider);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() { await this.tickOnce(); }

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
