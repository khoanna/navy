import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { NavyConfigService } from '../config/config.service';
import { decideRebalance, type AdapterState, type RebalanceConfig, type Move } from './rebalance.logic';

@Injectable()
export class RebalancerService {
  private readonly logger = new Logger(RebalancerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick() {
    if (this.running) { this.logger.warn('rebalancer tick still running; skipping'); return; }
    this.running = true;
    try { await this.tickOnce(); }
    catch (e) { this.logger.error('rebalancer tick failed: ' + (e as Error).message); }
    finally { this.running = false; }
  }

  async tickOnce(): Promise<void> {
    const vault = this.chain.vault;
    const count: bigint = await vault.adapterCount();
    if (count === 0n) return;

    const adapters: AdapterState[] = [];
    for (let i = 0n; i < count; i++) {
      const addr: string = await vault.adapters(i);
      const info: any = await vault.adapterInfo(addr);
      const ad = new ethers.Contract(addr, this.chain.yieldAdapterAbi, this.chain.provider);
      const [apr, assets] = (await Promise.all([ad.supplyRatePerYear(), ad.totalAssets()])) as [bigint, bigint];
      adapters.push({ address: addr, targetBps: Number(info.targetBps ?? info[1]), aprE18: apr, assetsBase: assets });
    }
    const totalBase: bigint = await vault.totalAssets();
    const idleBase: bigint = await this.chain.usdc.balanceOf(await vault.getAddress());

    const config: RebalanceConfig = {
      driftBandBps: this.cfg.rebalanceDriftBandBps,
      minIdleBps: this.cfg.rebalanceMinIdleBps,
      gasCostBase: this.cfg.rebalanceGasCostBase,
      safetyFactor: this.cfg.rebalanceSafetyFactor,
      horizonSeconds: this.cfg.rebalanceHorizonSeconds,
    };
    const moves = decideRebalance({ adapters, idleBase, totalBase, config });
    for (const m of moves) {
      try { await this.execute(m); }
      catch (e) { this.logger.error(`move failed (${m.kind}): ${(e as Error).message}`); }
    }
  }

  private async execute(m: Move): Promise<void> {
    const v = this.chain.vaultAsKeeper;
    if (m.kind === 'deploy') {
      const tx = await v.deployToAdapter(m.toAdapter, m.amountBase);
      await this.prisma.rebalanceEvent.create({ data: {
        kind: 'deploy', toAdapter: m.toAdapter, amountBase: m.amountBase, aprToE18: m.aprToE18, txHash: tx.hash, status: 'confirming',
      }});
    } else {
      const tx = await v.reallocate(m.fromAdapter, m.toAdapter, m.amountBase);
      await this.prisma.rebalanceEvent.create({ data: {
        kind: 'reallocate', fromAdapter: m.fromAdapter, toAdapter: m.toAdapter, amountBase: m.amountBase,
        aprFromE18: m.aprFromE18, aprToE18: m.aprToE18, txHash: tx.hash, status: 'confirming',
      }});
    }
  }
}
