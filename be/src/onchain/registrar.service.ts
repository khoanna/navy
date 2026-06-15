import { Injectable } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import type { NavyOnchain } from './onchain.module';
import { configPda, merchantPda } from './payments-client';

export interface RegistrarMerchant { id: string; payoutAddress: string }

@Injectable()
export class RegistrarService {
  constructor(private readonly chain: NavyOnchain, private readonly registrar: Keypair) {}

  async ensureRegisteredActive(m: RegistrarMerchant): Promise<string> {
    const authority = new PublicKey(m.payoutAddress);
    const pda = merchantPda(this.chain.programId, authority);
    const existing = await this.chain.connection.getAccountInfo(pda);
    if (!existing) {
      const payout = await getAssociatedTokenAddress(this.chain.usdcMint, authority);
      return this.chain.program.methods
        .registerMerchant(payout)
        .accounts({ config: configPda(this.chain.programId), merchant: pda, merchantAuthority: authority, admin: this.registrar.publicKey })
        .signers([this.registrar])
        .rpc();
    }
    return this.setActive(authority, true);
  }

  async deactivate(m: RegistrarMerchant): Promise<string> {
    return this.setActive(new PublicKey(m.payoutAddress), false);
  }

  private setActive(authority: PublicKey, active: boolean): Promise<string> {
    return this.chain.program.methods
      .setMerchantActive(active)
      .accounts({ config: configPda(this.chain.programId), merchant: merchantPda(this.chain.programId, authority), admin: this.registrar.publicKey })
      .signers([this.registrar])
      .rpc();
  }
}
