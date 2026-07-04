import { createHash } from 'crypto';
import { Inject, Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { buildPayInvoiceTx } from '../onchain/payments-client';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import { orderIdToInvoiceId } from './invoice-id';

@Injectable()
export class RelayerService {
  constructor(
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
  ) {}

  /** Builds the relayer-fee-paid, relayer-partial-signed pay_invoice tx (server-authoritative). */
  private async buildTx(
    order: { id: string; amount: bigint; expiresAt: Date },
    merchantAuthority: PublicKey,
    payer: PublicKey,
  ): Promise<Transaction> {
    const payout = await getAssociatedTokenAddress(this.chain.usdcMint, merchantAuthority);
    const tx = await buildPayInvoiceTx(this.chain.program, {
      merchantAuthority,
      payout,
      treasury: this.chain.treasury,
      usdcMint: this.chain.usdcMint,
      invoiceId: orderIdToInvoiceId(order.id),
      amount: order.amount,
      expiry: Math.floor(order.expiresAt.getTime() / 1000),
      payer,
      relayer: this.chain.relayer.publicKey,
    });
    tx.recentBlockhash = (await this.chain.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this.chain.relayer.publicKey;
    tx.partialSign(this.chain.relayer);
    return tx;
  }

  async buildPaymentTx(
    order: { id: string; amount: bigint; expiresAt: Date },
    merchantAuthority: PublicKey,
    payer: PublicKey,
  ): Promise<string> {
    // Guardrail: the relayer is fee payer + Invoice-rent payer for every payment. If it's low on
    // SOL, fail fast + loudly (503) instead of issuing an unfundable tx that fails confusingly.
    const balance = await this.chain.connection.getBalance(this.chain.relayer.publicKey);
    if (balance < this.cfg.relayerMinBalanceLamports) {
      throw new ServiceUnavailableException('Payment relayer is temporarily unavailable');
    }
    const tx = await this.buildTx(order, merchantAuthority, payer);
    // Persist the issued message as a durable, single-use nonce on the order row so verify
    // survives restarts / works across instances (replaces the process-local Map).
    const issuedTxHash = createHash('sha256').update(tx.serializeMessage()).digest('hex');
    await this.prisma.order.update({
      where: { id: order.id },
      data: { issuedTxHash, issuedTxExpiresAt: order.expiresAt, issuedTxConsumedAt: null },
    });
    return tx.serialize({ requireAllSignatures: false }).toString('base64');
  }

  async verifyAndSubmit(
    orderId: string,
    signedTxB64: string,
  ): Promise<{ signature: string; payer: string; err: unknown }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order?.issuedTxHash) throw new BadRequestException('No issued transaction for this order');
    if (order.issuedTxConsumedAt) throw new BadRequestException('Transaction already submitted');
    if (order.issuedTxExpiresAt && order.issuedTxExpiresAt < new Date()) {
      throw new BadRequestException('Issued transaction expired');
    }
    const tx = Transaction.from(Buffer.from(signedTxB64, 'base64'));
    const submittedHash = createHash('sha256').update(tx.serializeMessage()).digest('hex');
    if (submittedHash !== order.issuedTxHash) {
      throw new BadRequestException('Submitted transaction does not match issued');
    }
    // The real payer is the signer that isn't the relayer (gasless two-signer model).
    const relayer = this.chain.relayer.publicKey;
    const payerSig = tx.signatures.find((s) => !s.publicKey.equals(relayer) && s.signature != null);
    if (!payerSig) throw new BadRequestException('Submitted transaction is missing the payer signature');
    const payer = payerSig.publicKey.toBase58();
    // Optimistic single-use consume: claim the message ATOMICALLY before sending so a concurrent
    // second submit is rejected here (not in the multi-second window after confirmTransaction).
    const consumed = await this.prisma.order.updateMany({
      where: { id: orderId, issuedTxConsumedAt: null },
      data: { issuedTxConsumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Transaction already submitted');
    const sig = await this.chain.connection.sendRawTransaction(tx.serialize());
    // confirmTransaction resolves once the tx lands; value.err says whether it SUCCEEDED.
    const conf = await this.chain.connection.confirmTransaction(sig, 'confirmed');
    return { signature: sig, payer, err: conf.value.err };
  }
}
