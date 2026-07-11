import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { PrivyService } from '../wallet/privy.service';
import { DelegatedPolicyValidator } from '../wallet/delegated-policy.validator';
import { deriveTxSummary } from '../wallet/tx-summary';
import { AuditService } from '../audit/audit.service';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';
import type { FundingBounds } from './funding.util';

@Injectable()
export class DelegatedFundingService {
  constructor(
    private readonly privy: PrivyService,
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly audit: AuditService,
    private readonly policy: DelegatedPolicyValidator,
    @Inject(FARM_FUNDING_BOUNDS) private readonly bounds: FundingBounds,
  ) {}

  async fundSubwalletFromUser(args: {
    userId: string;
    privyDid: string;
    walletId?: string;
    userAddress: string;
    subwalletPubkey: string;
    amountLamports: bigint;
  }): Promise<{ txSignature: string }> {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(args.userAddress),
        toPubkey: new PublicKey(args.subwalletPubkey),
        lamports: args.amountLamports,
      }),
    );
    tx.feePayer = this.chain.relayer.publicKey;
    tx.recentBlockhash = (await this.chain.connection.getLatestBlockhash()).blockhash;

    const verdict = this.policy.check(deriveTxSummary(tx), {
      subwallet: args.subwalletPubkey,
      minLamports: this.bounds.fundMin,
      maxLamports: this.bounds.fundMax,
    });
    if (!verdict.ok) {
      await this.audit.record({
        actor: `user:${args.userId}`,
        action: 'farming.delegated.fund.denied',
        metadata: { reason: verdict.reason },
      });
      throw new ForbiddenException(`Delegated funding denied: ${verdict.reason}`);
    }

    tx.partialSign(this.chain.relayer);
    const idempotencyKey = `fund:${args.subwalletPubkey}:${Math.floor(Date.now() / 60000)}`;
    const signed = await this.privy.signDelegatedTransaction({
      walletId: args.walletId,
      address: args.userAddress,
      tx,
      idempotencyKey,
    });

    const raw = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
    const sig = await this.chain.connection.sendRawTransaction(raw);
    await this.chain.connection.confirmTransaction(sig, 'confirmed');
    await this.audit.record({
      actor: `user:${args.userId}`,
      action: 'farming.delegated.fund',
      target: args.subwalletPubkey,
      metadata: { amount: args.amountLamports.toString(), signature: sig },
    });
    return { txSignature: sig };
  }
}
