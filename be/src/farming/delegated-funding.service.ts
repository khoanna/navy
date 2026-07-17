import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { PrivyService } from '../wallet/privy.service';
import { DelegatedPolicyValidator } from '../wallet/delegated-policy.validator';
import { deriveTxSummary, type EvmCall } from '../wallet/tx-summary';
import { AuditService } from '../audit/audit.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { FARM_FUNDING_BOUNDS } from './farming.bounds';
import type { FundingBounds } from './funding.util';

const usdcIface = new ethers.Interface(['function transfer(address to, uint256 value)']);

@Injectable()
export class DelegatedFundingService {
  constructor(
    private readonly privy: PrivyService,
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
    private readonly audit: AuditService,
    private readonly policy: DelegatedPolicyValidator,
    @Inject(FARM_FUNDING_BOUNDS) private readonly bounds: FundingBounds,
  ) {}

  /**
   * Move `amountBase` (USDC base units) from the user's delegated main wallet into
   * their farming subwallet via an ERC-20 transfer. The tx is built server-side, its
   * summary is derived from the ACTUAL calldata (never trusted from the caller) and
   * bounded by the DelegatedPolicyValidator, then Privy broadcasts it from the user's
   * delegated wallet.
   */
  async fundSubwalletFromUser(args: {
    userId: string;
    privyDid: string;
    walletId?: string;
    userAddress: string;
    subwalletPubkey: string;
    amountBase: bigint;
  }): Promise<{ txSignature: string }> {
    const call: EvmCall = {
      // Circle USDC (the unified farming + payment token).
      to: this.evm.usdcAddress,
      data: usdcIface.encodeFunctionData('transfer', [args.subwalletPubkey, args.amountBase]),
    };

    const verdict = this.policy.check(deriveTxSummary([call]), {
      subwallet: args.subwalletPubkey,
      minBase: this.bounds.fundMin,
      maxBase: this.bounds.fundMax,
    });
    if (!verdict.ok) {
      await this.audit.record({
        actor: `user:${args.userId}`,
        action: 'farming.delegated.fund.denied',
        metadata: { reason: verdict.reason },
      });
      throw new ForbiddenException(`Delegated funding denied: ${verdict.reason}`);
    }

    const idempotencyKey = `fund:${args.subwalletPubkey}:${Math.floor(Date.now() / 60000)}`;
    const { hash } = await this.privy.sendDelegatedTransaction({
      walletId: args.walletId,
      address: args.userAddress,
      to: call.to,
      data: call.data,
      chainId: this.evm.usdcDomain.chainId,
      idempotencyKey,
    });

    if (!hash) {
      await this.audit.record({ actor: `user:${args.userId}`, action: 'farming.delegated.fund.unsigned', metadata: { subwallet: args.subwalletPubkey } });
      throw new Error('Delegated signing did not return a transaction hash');
    }

    await this.audit.record({
      actor: `user:${args.userId}`,
      action: 'farming.delegated.fund',
      target: args.subwalletPubkey,
      metadata: { amount: args.amountBase.toString(), signature: hash },
    });
    return { txSignature: hash };
  }
}
