import { Injectable } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import type { NavyOnchain } from './onchain.module';
import { configPda, merchantPda, merchantIdFromUuid } from './payments-client';

export interface RegistrarMerchant { id: string; payoutAddress: string }

@Injectable()
export class RegistrarService {
  constructor(private readonly chain: NavyOnchain, private readonly registrar: Keypair) {}

  async ensureRegisteredActive(m: RegistrarMerchant): Promise<string> {
    const merchantId = merchantIdFromUuid(m.id);
    const pda = merchantPda(this.chain.programId, merchantId);
    const existing = await this.chain.connection.getAccountInfo(pda);
    if (!existing) {
      const authority = new PublicKey(m.payoutAddress);
      const payout = await getAssociatedTokenAddress(this.chain.usdcMint, authority);
      return this.chain.program.methods
        .registerMerchant(merchantId, payout)
        .accounts({ config: configPda(this.chain.programId), merchant: pda, admin: this.registrar.publicKey })
        .signers([this.registrar])
        .rpc();
    }
    return this.setActive(merchantId, true);
  }

  async deactivate(m: RegistrarMerchant): Promise<string> {
    return this.setActive(merchantIdFromUuid(m.id), false);
  }

  async setPayout(m: RegistrarMerchant): Promise<string> {
    const merchantId = merchantIdFromUuid(m.id);
    const authority = new PublicKey(m.payoutAddress);
    const payout = await getAssociatedTokenAddress(this.chain.usdcMint, authority);
    return this.chain.program.methods
      .setMerchantPayout(payout)
      .accounts({ config: configPda(this.chain.programId), merchant: merchantPda(this.chain.programId, merchantId), admin: this.registrar.publicKey })
      .signers([this.registrar])
      .rpc();
  }

  private setActive(merchantId: number[], active: boolean): Promise<string> {
    return this.chain.program.methods
      .setMerchantActive(active)
      .accounts({ config: configPda(this.chain.programId), merchant: merchantPda(this.chain.programId, merchantId), admin: this.registrar.publicKey })
      .signers([this.registrar])
      .rpc();
  }
}
