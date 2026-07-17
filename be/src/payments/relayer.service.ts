import { ethers } from 'ethers';
import { Inject, Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import {
  buildAuthorizationTypedData,
  invoiceIdHexFromOrderId,
  invoiceKey,
  authorizationDigest,
  type AuthorizationTypedData,
} from '../evm/payment-authorization';

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
    const balance = await this.chain.provider.getBalance(this.chain.relayer.address);
    if (balance < this.cfg.relayerMinBalanceWei) {
      throw new ServiceUnavailableException('Payment relayer is temporarily unavailable');
    }
    // EIP-3009 nonce is the deterministic on-chain invoice key (bytes32), not a token nonce.
    const nonce = invoiceKey(merchantIdHex16, invoiceIdHexFromOrderId(order.id));
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
    // The persisted digest is exactly what the wallet signed; recover the signer via raw ecrecover.
    let signer: string;
    try {
      signer = ethers.recoverAddress(order.issuedTxHash, signature);
    } catch {
      throw new BadRequestException('Invalid signature');
    }
    if (signer.toLowerCase() !== expectedPayer.toLowerCase()) {
      throw new BadRequestException('Signature does not match the authenticated payer');
    }
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
    const sig = ethers.Signature.from(signature);
    // EIP-3009: validAfter=0, validBefore from the issued authorization; the token derives the nonce (invoiceKey) itself.
    const tx = await this.chain.payments.payInvoice(
      merchantIdHex16, invoiceIdHex16, order.amount, 0, validBefore, signer, sig.v, sig.r, sig.s,
    );
    const receipt = await tx.wait();
    return { txHash: tx.hash, payer: signer, err: receipt && receipt.status === 1 ? null : 'reverted' };
  }
}
