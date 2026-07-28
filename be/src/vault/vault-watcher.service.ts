import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';

@Injectable()
export class VaultWatcherService {
  private readonly logger = new Logger(VaultWatcherService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  @Interval(15000)
  async sweepConfirming() {
    await this.sweep('vaultDeposit');
    await this.sweep('vaultRedeem');
    await this.sweepRebalance();
  }

  private async sweep(model: 'vaultDeposit' | 'vaultRedeem') {
    const rows = await (this.prisma as any)[model].findMany({ where: { status: 'confirming' } });
    for (const row of rows) {
      if (!row.txHash) continue;
      const receipt = await this.chain.provider.getTransactionReceipt(row.txHash);
      if (!receipt) continue;
      const status = receipt.status === 1 ? 'confirmed' : 'failed';
      await (this.prisma as any)[model].update({ where: { id: row.id }, data: { status } });
      if (status === 'failed') this.logger.warn(`${model} ${row.id} reverted on-chain (tx ${row.txHash})`);
    }
  }

  private async sweepRebalance() {
    const rows = await this.prisma.rebalanceEvent.findMany({ where: { status: 'confirming' } });
    for (const row of rows) {
      if (!row.txHash) continue;
      const receipt = await this.chain.provider.getTransactionReceipt(row.txHash);
      if (!receipt) continue;
      await this.prisma.rebalanceEvent.update({ where: { id: row.id }, data: { status: receipt.status === 1 ? 'confirmed' : 'failed' } });
    }
  }

  @Interval(45000)
  async recoverConsumedDeposits() {
    const stranded = await this.prisma.vaultDeposit.findMany({
      where: { status: 'awaiting_signature', consumedAt: { not: null }, txHash: null },
    });
    for (const d of stranded) {
      try {
        const used: boolean = await this.chain.usdc.authorizationState(d.userAddress, d.nonce);
        if (used) {
          await this.prisma.vaultDeposit.update({ where: { id: d.id }, data: { status: 'confirming' } });
        } else if (d.validBefore && d.validBefore.getTime() < Date.now()) {
          await this.prisma.vaultDeposit.update({ where: { id: d.id }, data: { consumedAt: null, status: 'failed' } });
        }
      } catch (e) {
        this.logger.error('recoverConsumedDeposits: ' + (e as Error).message);
      }
    }
  }
}
