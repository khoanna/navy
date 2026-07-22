import { Inject, Injectable } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { OrdersService } from '../payments/orders.service';
import { FarmingService } from '../farming/farming.service';
import { TransferService } from '../transfer/transfer.service';
import { UserService } from '../user/user.service';
import { PriceService } from '../market/price.service';
import { spendingSeries } from './analytics';
import type { ToolHandlers } from './types';

@Injectable()
export class AgentToolsService {
  constructor(
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
    private readonly orders: OrdersService,
    private readonly farming: FarmingService,
    private readonly transfers: TransferService,
    private readonly users: UserService,
    private readonly prices: PriceService,
  ) {}

  /** Build the handler map bound to one authenticated user. */
  forUser(userId: string, walletAddress: string): ToolHandlers {
    return {
      get_portfolio: async () => {
        const [ethWei, usdc] = await Promise.all([
          this.chain.provider.getBalance(walletAddress),
          this.chain.usdc.balanceOf(walletAddress) as Promise<bigint>,
        ]);
        let farming: any = null;
        try { farming = await this.farming.getPosition(userId); } catch { /* no subwallet yet */ }
        let ethUsd: number | null = null, totalUsd: number | null = null;
        try {
          ethUsd = await this.prices.ethUsd();
          if (ethUsd != null) {
            const usdcUsd = Number(usdc) / 1e6;
            const ethAmt = Number(ethWei) / 1e18;
            totalUsd = Math.round((usdcUsd + ethAmt * ethUsd) * 100) / 100;
          }
        } catch { /* prices unavailable — omit USD, never block the portfolio */ }
        return { display: { kind: 'card' }, usdcBase: usdc.toString(), ethWei: ethWei.toString(), farming, ethUsd, totalUsd };
      },
      get_payment_history: async (a) => {
        const limit = typeof a.limit === 'number' ? Math.min(a.limit, 50) : 20;
        const list = await this.orders.listForPayer(walletAddress, { take: limit, skip: 0 });
        return { display: { kind: 'card' }, orders: list };
      },
      get_farming_summary: async () => {
        let position: any = null;
        try { position = await this.farming.getPosition(userId); } catch { /* none */ }
        return { display: { kind: 'card' }, position };
      },
      get_spending_analytics: async (a) => {
        const period = (a.period as any) ?? 'day';
        const list: any[] = await this.orders.listForPayer(walletAddress, { take: 200, skip: 0 });
        const orders = list
          .filter((o) => o.paidAt)
          .map((o) => ({ amount: o.amount, createdAt: new Date(o.paidAt), status: o.status }));
        const series = spendingSeries(orders, period);
        return { display: { kind: 'chart', chartType: 'bar' }, ...series };
      },
      resolve_recipient: async (a) => {
        const r = await this.users.resolveUsername(String(a.recipient));
        if (r) return { display: { kind: 'card' }, ...r };
        return { display: { kind: 'card' }, address: null, note: 'not a known @username; treat as raw address if it is 0x…' };
      },
      build_transfer: async (a) => {
        const asset = a.asset === 'ETH' ? 'ETH' : 'USDC';
        if (asset === 'ETH') {
          const resolved = await this.transfers.resolve(String(a.recipient));
          const amountWei = BigInt(String(a.amountBase));
          const bal = await this.chain.provider.getBalance(walletAddress);
          // Reserve a little ETH for gas (matches the Send screen's ETH MAX reserve).
          const GAS_RESERVE_WEI = 300000000000000n; // ~0.0003 ETH
          if (bal < amountWei + GAS_RESERVE_WEI) return { error: 'Not enough ETH to cover that amount plus gas. Add ETH and try again.' };
          return { display: { kind: 'action', action: 'transfer' }, asset: 'ETH', to: resolved.address, amountWei: amountWei.toString(), recipient: resolved };
        }
        const res = await this.transfers.buildAuthorization(userId, walletAddress, String(a.recipient), BigInt(String(a.amountBase)));
        return { display: { kind: 'action', action: 'transfer' }, asset: 'USDC', ...res };
      },
      build_farming_deposit: async (a) => {
        return { display: { kind: 'action', action: 'farming_deposit' }, amountBase: String(a.amountBase) };
      },
      build_farming_withdraw: async (a) => {
        return { display: { kind: 'action', action: 'farming_withdraw' }, amount: String(a.amount) };
      },
      get_token_info: async (a) => {
        const info = await this.prices.tokenInfo(String(a.query ?? ''));
        if (!info) return { error: `Couldn't find a token matching "${String(a.query ?? '')}"` };
        return { display: { kind: 'token' }, ...info };
      },
      get_top_coins: async (a) => {
        const limit = typeof a.limit === 'number' ? a.limit : 10;
        const coins = await this.prices.topCoins(limit);
        return { display: { kind: 'card' }, coins };
      },
    };
  }
}
