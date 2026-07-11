import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import { PrivyService } from '../wallet/privy.service';
import { DelegatedFundingService } from './delegated-funding.service';
import { FarmingService } from './farming.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';
import { computeFundAmount, type FundingBounds } from './funding.util';

@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
    private readonly privy: PrivyService,
    private readonly funding: DelegatedFundingService,
    private readonly farming: FarmingService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    @Inject(FARM_FUNDING_BOUNDS) private readonly bounds: FundingBounds,
  ) {}

  async status(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    const available = !!this.cfg.privyAuthorizationKey;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return { available, enabled: !!user?.farmDelegationEnabledAt };
  }

  async enable(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    if (!this.cfg.privyAuthorizationKey) throw new ServiceUnavailableException('Delegated signing not configured');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const dw = await this.privy.getDelegatedWallet(user.privyDid);
    if (!dw) throw new BadRequestException('Wallet is not delegated');
    await this.prisma.user.update({
      where: { id: userId },
      data: { farmDelegationWalletId: dw.walletId ?? null, farmDelegationEnabledAt: new Date() },
    });
    return { available: true, enabled: true };
  }

  async disable(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { farmDelegationWalletId: null, farmDelegationEnabledAt: null },
    });
    return { available: !!this.cfg.privyAuthorizationKey, enabled: false };
  }

  async fundNow(userId: string): Promise<{ txSignature: string } | { skipped: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.farmDelegationEnabledAt) throw new BadRequestException('Auto-farm not enabled');
    if (!user.primaryWallet) throw new BadRequestException('No embedded wallet on file');
    let sw = await this.prisma.farmingSubwallet.findFirst({ where: { userId, status: 'active' } });
    if (!sw) {
      const created = await this.farming.createSubwallet(userId, user.primaryWallet);
      sw = await this.prisma.farmingSubwallet.findFirst({ where: { id: created.subwalletId } });
    }
    return this._fund(user, sw!);
  }

  async autoFundSubwallet(sw: { id: string; pubkey: string; userId: string }): Promise<{ txSignature: string } | { skipped: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: sw.userId } });
    if (!user?.farmDelegationEnabledAt || !user.primaryWallet || !this.cfg.privyAuthorizationKey) {
      return { skipped: 'not enabled' };
    }
    return this._fund(user, sw);
  }

  private async _fund(
    user: { id: string; privyDid: string; primaryWallet: string | null; farmDelegationWalletId: string | null },
    sw: { id: string; pubkey: string },
  ): Promise<{ txSignature: string } | { skipped: string }> {
    const balance = await this.chain.connection.getBalance(new PublicKey(user.primaryWallet!));
    const amount = computeFundAmount(BigInt(balance), this.bounds);
    if (amount === null) return { skipped: 'insufficient balance' };
    return this.funding.fundSubwalletFromUser({
      userId: user.id,
      privyDid: user.privyDid,
      walletId: user.farmDelegationWalletId ?? undefined,
      userAddress: user.primaryWallet!,
      subwalletPubkey: sw.pubkey,
      amountLamports: amount,
    });
  }
}
