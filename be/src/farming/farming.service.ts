import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { SubwalletService } from '../wallet/subwallet.service';
import { SigningService } from '../wallet/signing.service';
import { SaveYieldAdapter } from './save-yield-adapter';
import { AuditService } from '../audit/audit.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';

@Injectable()
export class FarmingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subwallets: SubwalletService,
    private readonly adapter: SaveYieldAdapter,
    private readonly signing: SigningService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly audit: AuditService,
  ) {}

  async createSubwallet(userId: string, ownerMainWallet: string) {
    const sw = await this.subwallets.provision(userId, { allowedProgramIds: [], allowedDestinations: [] } as any);
    const allow = await this.adapter.policyAllowlist(new PublicKey(sw.pubkey), new PublicKey(ownerMainWallet));
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

  async depositSubwallet(sw: { id: string; pubkey: string }, amountLamports: bigint) {
    const tx = await this.adapter.buildDeposit(new PublicKey(sw.pubkey), amountLamports);
    const signed = await this.signing.signTransaction(sw.id, tx);
    const sig = await this.submit(signed);
    await this.prisma.farmingEvent.create({ data: { subwalletId: sw.id, kind: 'deposit', amount: amountLamports, txSignature: sig } });
    return { txSignature: sig };
  }

  async refreshSubwallet(sw: { id: string; pubkey: string }) {
    const pos = await this.adapter.getPosition(new PublicKey(sw.pubkey));
    await this.prisma.farmingSubwallet.update({
      where: { id: sw.id },
      data: { principalLamports: pos.principalLamports, currentValueLamports: pos.currentValueLamports, lastRefreshedAt: new Date() },
    });
    return pos;
  }

  deposit(userId: string, amountLamports: bigint) { return this.active(userId).then((sw) => this.depositSubwallet(sw, amountLamports)); }

  async withdraw(userId: string, amount: bigint | 'all') {
    const sw = await this.active(userId);
    const tx = await this.adapter.buildWithdraw(new PublicKey(sw.pubkey), new PublicKey(sw.ownerMainWallet!), amount);
    const signed = await this.signing.signTransaction(sw.id, tx);
    const sig = await this.submit(signed);
    await this.prisma.farmingEvent.create({ data: { subwalletId: sw.id, kind: 'withdraw', amount: amount === 'all' ? 0n : amount, txSignature: sig } });
    return { txSignature: sig };
  }

  async getPosition(userId: string) {
    const sw = await this.active(userId);
    const pos = await this.refreshSubwallet(sw);
    return { address: sw.pubkey, principalLamports: pos.principalLamports.toString(), currentValueLamports: pos.currentValueLamports.toString(), cTokenAmount: pos.cTokenAmount.toString() };
  }

  listHistory(userId: string) {
    return this.prisma.farmingEvent.findMany({ where: { subwallet: { userId } }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  private async submit(signed: { serialize(opts?: unknown): Buffer }): Promise<string> {
    const raw = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
    const sig = await this.chain.connection.sendRawTransaction(raw);
    await this.chain.connection.confirmTransaction(sig, 'confirmed');
    return sig;
  }
}
