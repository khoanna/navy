import { Injectable } from '@nestjs/common';
import type { NavyEvm } from './evm.module';
import { merchantIdHex } from './payment-authorization';

export interface RegistrarMerchant { id: string; payoutAddress: string }

/** Admin (owner) on-chain merchant registry ops. Payout is the merchant's EVM address (no ATA). */
@Injectable()
export class EvmRegistrarService {
  constructor(private readonly chain: NavyEvm) {}

  async ensureRegisteredActive(m: RegistrarMerchant): Promise<string> {
    const id = merchantIdHex(m.id);
    const existing = await this.chain.paymentsAsOwner.merchants(id);
    if (!existing?.exists) {
      const tx = await this.chain.paymentsAsOwner.registerMerchant(id, m.payoutAddress);
      await tx.wait();
      return tx.hash;
    }
    const tx = await this.chain.paymentsAsOwner.setMerchantActive(id, true);
    await tx.wait();
    return tx.hash;
  }

  async deactivate(m: RegistrarMerchant): Promise<string> {
    const tx = await this.chain.paymentsAsOwner.setMerchantActive(merchantIdHex(m.id), false);
    await tx.wait();
    return tx.hash;
  }

  async setPayout(m: RegistrarMerchant): Promise<string> {
    const tx = await this.chain.paymentsAsOwner.setMerchantPayout(merchantIdHex(m.id), m.payoutAddress);
    await tx.wait();
    return tx.hash;
  }
}
