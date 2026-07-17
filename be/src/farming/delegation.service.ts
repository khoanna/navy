import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import { PrivyService } from '../wallet/privy.service';
import { DelegatedFundingService } from './delegated-funding.service';
import { FarmingService } from './farming.service';
import { AuditService } from '../audit/audit.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';
import { computeFundAmount, type FundingBounds } from './funding.util';

const usdcIface = new ethers.Interface(['function balanceOf(address owner) view returns (uint256)']);

@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
    private readonly privy: PrivyService,
    private readonly funding: DelegatedFundingService,
    private readonly farming: FarmingService,
    private readonly audit: AuditService,
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
    @Inject(FARM_FUNDING_BOUNDS) private readonly bounds: FundingBounds,
  ) {}

  private _usdc?: ethers.Contract;
  private get usdc(): ethers.Contract {
    return (this._usdc ??= new ethers.Contract(this.evm.usdcAddress, usdcIface, this.evm.provider));
  }

  /** The user's main-wallet USDC balance (base units), the source for auto-funding. */
  private async usdcBalance(address: string): Promise<bigint> {
    return (await this.usdc.balanceOf(address)) as bigint;
  }

  async status(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    const available = !!this.cfg.privyAuthorizationKey;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return { available, enabled: !!user?.farmDelegationEnabledAt };
  }

  async enable(userId: string): Promise<{ available: boolean; enabled: boolean }> {
    if (!this.cfg.privyAuthorizationKey) throw new ServiceUnavailableException('Delegated signing not configured');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const dw = await this.resolveDelegatedWithRetry(user.privyDid);
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
    if (!this.cfg.privyAuthorizationKey) throw new ServiceUnavailableException('Delegated signing not configured');
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

  private async resolveDelegatedWithRetry(privyDid: string): Promise<{ walletId?: string; address: string } | null> {
    const delays = [0, 600, 1500]; // ms; total ~2.1s
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
      const dw = await this.privy.getDelegatedWallet(privyDid);
      if (dw) return dw;
    }
    return null;
  }

  private async _fund(
    user: { id: string; privyDid: string; primaryWallet: string | null; farmDelegationWalletId: string | null },
    sw: { id: string; pubkey: string },
  ): Promise<{ txSignature: string } | { skipped: string }> {
    const balance = await this.usdcBalance(user.primaryWallet!);
    const amount = computeFundAmount(balance, this.bounds);
    if (amount === null) return { skipped: 'insufficient balance' };
    try {
      return await this.funding.fundSubwalletFromUser({
        userId: user.id,
        privyDid: user.privyDid,
        walletId: user.farmDelegationWalletId ?? undefined,
        userAddress: user.primaryWallet!,
        subwalletPubkey: sw.pubkey,
        amountBase: amount,
      });
    } catch (err) {
      // If delegated signing fails, check whether the wallet was un-delegated from the
      // Privy side. If so, clear the stale flags and surface a clear error.
      const stillDelegated = await this.privy.getDelegatedWallet(user.privyDid);
      if (stillDelegated === null) {
        this.logger.warn(`Clearing stale delegation for user ${user.id}: wallet no longer delegated`);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { farmDelegationWalletId: null, farmDelegationEnabledAt: null },
        });
        throw new BadRequestException('Wallet delegation was revoked; please re-enable auto-farm');
      }
      await this.audit.record({
        actor: `user:${user.id}`,
        action: 'farming.delegated.fund.error',
        metadata: { subwallet: sw.pubkey, error: (err as Error)?.message?.slice(0, 300) },
      });
      throw err;
    }
  }
}
