import { Inject, Injectable } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { OrdersService } from '../payments/orders.service';
import { FarmingService } from '../farming/farming.service';
import { TransferService } from '../transfer/transfer.service';
import { UserService } from '../user/user.service';
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
        return { display: { kind: 'card' }, usdcBase: usdc.toString(), ethWei: ethWei.toString(), farming };
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
        const orders = list.map((o) => ({ amount: o.amount, createdAt: new Date(o.paidAt ?? Date.now()), status: o.status }));
        const series = spendingSeries(orders, period);
        return { display: { kind: 'chart', chartType: 'bar' }, ...series };
      },
      resolve_recipient: async (a) => {
        const r = await this.users.resolveUsername(String(a.recipient));
        if (r) return { display: { kind: 'card' }, ...r };
        return { display: { kind: 'card' }, address: null, note: 'not a known @username; treat as raw address if it is 0x…' };
      },
      build_transfer: async (a) => {
        const res = await this.transfers.buildAuthorization(userId, walletAddress, String(a.recipient), BigInt(String(a.amountBase)));
        return { display: { kind: 'action', action: 'transfer' }, ...res };
      },
      build_farming_deposit: async (a) => {
        return { display: { kind: 'action', action: 'farming_deposit' }, amountBase: String(a.amountBase) };
      },
      build_farming_withdraw: async (a) => {
        return { display: { kind: 'action', action: 'farming_withdraw' }, amount: String(a.amount) };
      },
    };
  }
}
