import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransferWatcherService {
  private readonly log = new Logger(TransferWatcherService.name);
  constructor(@Inject(NAVY_EVM) private readonly chain: NavyEvm, private readonly prisma: PrismaService) {}

  /** Reconcile any transfer stuck in 'confirming' (e.g. a crash after broadcast). */
  @Interval(30_000)
  async sweepConfirming() {
    const stuck = await this.prisma.transfer.findMany({ where: { status: 'confirming' }, take: 25 });
    for (const t of stuck) {
      if (!t.txHash) continue;
      try {
        const receipt = await this.chain.provider.getTransactionReceipt(t.txHash);
        if (!receipt) continue;
        const ok = receipt.status === 1;
        await this.prisma.transfer.update({
          where: { id: t.id },
          data: ok ? { status: 'confirmed' } : { status: 'failed', consumedAt: null },
        });
      } catch (e) {
        this.log.warn(`sweepConfirming ${t.id}: ${(e as Error).message}`);
      }
    }
  }
}
