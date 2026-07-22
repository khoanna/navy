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

  /**
   * Recover transfers whose nonce was consumed but the confirming-write never landed
   * (a crash between the CAS-consume and the status:'confirming' write). Reads the USDC
   * EIP-3009 authorizationState to decide the true outcome. Mirrors the payments layer's
   * recoverConsumedOrders self-healing.
   */
  @Interval(45_000)
  async recoverConsumedTransfers() {
    const stuck = await this.prisma.transfer.findMany({
      where: { status: 'awaiting_signature', consumedAt: { not: null } },
      take: 25,
    });
    for (const t of stuck) {
      try {
        if (!t.nonce || !t.validBefore) continue; // ETH rows have no EIP-3009 auth to recover
        const used: boolean = await this.chain.usdc.authorizationState(t.fromAddress, t.nonce);
        if (used) {
          // The EIP-3009 authorization was consumed on-chain → the transfer succeeded.
          await this.prisma.transfer.update({ where: { id: t.id }, data: { status: 'confirmed' } });
        } else if (t.validBefore < new Date()) {
          // Never landed and can no longer be signed → dead.
          await this.prisma.transfer.update({ where: { id: t.id }, data: { status: 'failed', consumedAt: null } });
        } else {
          // Not yet on-chain and still valid → release the consume latch so the user can retry.
          await this.prisma.transfer.update({ where: { id: t.id }, data: { consumedAt: null } });
        }
      } catch (e) {
        this.log.warn(`recoverConsumedTransfers ${t.id}: ${(e as Error).message}`);
      }
    }
  }
}
