import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubwalletService } from '../wallet/subwallet.service';
import { SigningService } from '../wallet/signing.service';
import { CompoundYieldAdapter } from './compound-yield-adapter';
import { AuditService } from '../audit/audit.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { toFarmingEventDto } from '../common/serialize';

@Injectable()
export class FarmingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subwallets: SubwalletService,
    private readonly adapter: CompoundYieldAdapter,
    private readonly signing: SigningService,
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
    private readonly audit: AuditService,
  ) {}

  async createSubwallet(userId: string, ownerMainWallet: string) {
    const sw = await this.subwallets.provision(userId, { allowedProgramIds: [], allowedDestinations: [] } as any);
    const allow = await this.adapter.policyAllowlist(sw.pubkey, ownerMainWallet);
    await this.prisma.farmingSubwallet.update({
      where: { id: sw.id },
      data: { ownerMainWallet, policyJson: { allowedProgramIds: allow.programIds, allowedDestinations: allow.destinations } as any },
    });
    await this.audit.record({ actor: `user:${userId}`, action: 'farming.subwallet.create', target: sw.pubkey });
    return { subwalletId: sw.id, address: sw.pubkey };
  }

  private async active(userId: string) {
    const sw = await this.prisma.farmingSubwallet.findFirst({ where: { userId, status: 'active' } });
    if (!sw) throw new NotFoundException('No active farming subwallet');
    return sw;
  }

  /** Sends the adapter's calls in order via the isolated SigningService; returns the last tx hash. */
  private async sendCalls(subwalletId: string, calls: { to: string; data?: string; value?: bigint | string | number }[]): Promise<string> {
    let last = '';
    for (const call of calls) {
      last = await this.signing.signAndSend(subwalletId, call);
    }
    return last;
  }

  async depositSubwallet(sw: { id: string; pubkey: string }, amountBase: bigint) {
    const calls = await this.adapter.buildDeposit(sw.pubkey, amountBase);
    const txHash = await this.sendCalls(sw.id, calls);
    await this.prisma.farmingEvent.create({ data: { subwalletId: sw.id, kind: 'deposit', amount: amountBase, txSignature: txHash } });
    return { txSignature: txHash };
  }

  async refreshSubwallet(sw: { id: string; pubkey: string }) {
    const pos = await this.adapter.getPosition(sw.pubkey);
    await this.prisma.farmingSubwallet.update({
      where: { id: sw.id },
      data: { principalLamports: pos.principalLamports, currentValueLamports: pos.currentValueLamports, lastRefreshedAt: new Date() },
    });
    return pos;
  }

  deposit(userId: string, amountBase: bigint) { return this.active(userId).then((sw) => this.depositSubwallet(sw, amountBase)); }

  async withdraw(userId: string, amount: bigint | 'all') {
    const sw = await this.active(userId);
    const calls = await this.adapter.buildWithdraw(sw.pubkey, sw.ownerMainWallet!, amount);
    const txHash = await this.sendCalls(sw.id, calls);
    await this.prisma.farmingEvent.create({ data: { subwalletId: sw.id, kind: 'withdraw', amount: amount === 'all' ? 0n : amount, txSignature: txHash } });
    return { txSignature: txHash };
  }

  async getPosition(userId: string) {
    const sw = await this.active(userId);
    const pos = await this.refreshSubwallet(sw);
    return { address: sw.pubkey, principalLamports: pos.principalLamports.toString(), currentValueLamports: pos.currentValueLamports.toString(), cTokenAmount: pos.cTokenAmount.toString() };
  }

  async listHistory(userId: string) {
    const events = await this.prisma.farmingEvent.findMany({
      where: { subwallet: { userId } }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    // amount is a Prisma BigInt column — JSON can't encode BigInt, so serialize before returning.
    return toFarmingEventDto(events);
  }
}
