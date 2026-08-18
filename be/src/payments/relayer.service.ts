import { ethers } from 'ethers';
import { Inject, Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import {
  buildAuthorizationTypedData,
  invoiceIdHexFromOrderId,
  authorizationDigest,
  type AuthorizationTypedData,
} from '../evm/payment-authorization';
import { assertRelayerBalance, recoverAndVerifySigner } from '../evm/eip3009-relay.util';

export interface AuthorizationResult {
  typedData: AuthorizationTypedData;
  invoice: { merchant: string; amount: string; reference?: string; expiresAt: Date };
}

@Injectable()
export class RelayerService {
  constructor(
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
  ) {}

  /** Build the EIP-3009 ReceiveWithAuthorization the wallet signs, and persist its digest as a durable single-use nonce. */
  async buildAuthorization(
    order: { id: string; amount: bigint; expiresAt: Date; reference?: string },
    merchantIdHex16: string,
    payer: string,
  ): Promise<AuthorizationResult> {
    // Guardrail: the relayer pays gas for every payInvoice. If it's low on ETH, fail fast (503).
    await assertRelayerBalance(this.chain.provider, this.chain.relayer.address, this.cfg.relayerMinBalanceWei);
    // Fetch the configuration-bound nonce from the contract. This includes the merchant payout,
    // treasury, feeBps, and version counters so changing any of those invalidates any
    // outstanding unsigned authorizations. On failure we surface a 503 so the order stays
    // "awaiting_payment" and can be retried without leaking a durable digest.
    const invoiceIdHex16 = invoiceIdHexFromOrderId(order.id);
    let nonce: string;
    try {
      nonce = await this.chain.payments.authorizationNonce(merchantIdHex16, invoiceIdHex16);
    } catch {
      throw new ServiceUnavailableException('authorization nonce unavailable');
    }
    // Validate bytes32 shape: must be 0x + 64 hex chars
    if (!/^0x[0-9a-f]{64}$/i.test(nonce)) {
      throw new ServiceUnavailableException('authorization nonce unavailable');
    }
    const validBefore = Math.floor(order.expiresAt.getTime() / 1000);
    const typedData = buildAuthorizationTypedData({
      domain: this.chain.usdcDomain,
      payer,
      to: this.chain.paymentsAddress,
      amount: order.amount,
      validAfter: 0,
      validBefore,
      nonce,
    });
    const issuedTxHash = authorizationDigest(typedData);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { issuedTxHash, issuedTxExpiresAt: order.expiresAt, issuedTxConsumedAt: null },
    });
    return { typedData, invoice: { merchant: '', amount: order.amount.toString(), reference: order.reference, expiresAt: order.expiresAt } };
  }

  /** Recover the payer from the signature, atomically consume the nonce, then relay payInvoice and pay gas. */
  async verifyAndSubmit(
    orderId: string,
    signature: string,
    expectedPayer: string,
  ): Promise<{ txHash: string; payer: string; err: unknown }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order?.issuedTxHash) throw new BadRequestException('No issued authorization for this order');
    if (order.issuedTxConsumedAt) throw new BadRequestException('Authorization already submitted');
    if (order.issuedTxExpiresAt && order.issuedTxExpiresAt < new Date()) {
      throw new BadRequestException('Issued authorization expired');
    }

    const { signer, sig } = recoverAndVerifySigner(order.issuedTxHash, signature, expectedPayer);

    // Optimistic single-use consume BEFORE submitting, so a concurrent second submit is rejected here.
    const consumed = await this.prisma.order.updateMany({
      where: { id: orderId, issuedTxConsumedAt: null },
      data: { issuedTxConsumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Authorization already submitted');

    // Reconstruct the exact payInvoice args from the order (the on-chain USDC.receiveWithAuthorization re-verifies the sig against these).
    const merchantIdHex16 = '0x' + order.merchantId.replace(/-/g, '').toLowerCase();
    const invoiceIdHex16 = invoiceIdHexFromOrderId(order.id);
    const validBefore = Math.floor(order.issuedTxExpiresAt!.getTime() / 1000);
    // EIP-3009: validAfter=0, validBefore from the issued authorization; nonce was the
    // contract's authorizationNonce (bound to the merchant payout/treasury/fee/version at signing time).
    const tx = await this.chain.payments.payInvoice(
      merchantIdHex16, invoiceIdHex16, order.amount, 0, validBefore, signer, sig.v, sig.r, sig.s,
    );
    // Crash-safety: persist the broadcast tx hash + `confirming` BEFORE awaiting the mine. A crash
    // between broadcast and this write would otherwise strand a paid order at `awaiting_payment`
    // (nonce consumed, no txHash) — invisible to sweepConfirming and wrongly expired by expireStale.
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'confirming', txSignature: tx.hash },
    });
    const receipt = await tx.wait();
    return { txHash: tx.hash, payer: signer, err: receipt && receipt.status === 1 ? null : 'reverted' };
  }
}
