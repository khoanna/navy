import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { buildPayInvoiceTx } from '../onchain/payments-client';
import { orderIdToInvoiceId } from './invoice-id';

@Injectable()
export class RelayerService {
  private issued = new Map<string, Buffer>();

  constructor(@Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain) {}

  async buildPaymentTx(
    order: { id: string; amount: bigint; expiresAt: Date },
    merchantAuthority: PublicKey,
    payer: PublicKey,
  ): Promise<string> {
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
    this.issued.set(order.id, tx.serializeMessage());
    return tx.serialize({ requireAllSignatures: false }).toString('base64');
  }

  messagesMatch(a: Transaction, b: Transaction): boolean {
    return a.serializeMessage().equals(b.serializeMessage());
  }

  async verifyAndSubmit(
    orderId: string,
    signedTxB64: string,
  ): Promise<{ signature: string; payer: string; err: unknown }> {
    const expected = this.issued.get(orderId);
    if (!expected) throw new BadRequestException('No issued transaction for this order');
    const tx = Transaction.from(Buffer.from(signedTxB64, 'base64'));
    if (!tx.serializeMessage().equals(expected)) throw new BadRequestException('Submitted transaction does not match issued');
    // The real payer is the signer that isn't the relayer (gasless two-signer model).
    const relayer = this.chain.relayer.publicKey;
    const payerSig = tx.signatures.find((s) => !s.publicKey.equals(relayer) && s.signature != null);
    if (!payerSig) throw new BadRequestException('Submitted transaction is missing the payer signature');
    const payer = payerSig.publicKey.toBase58();
    const sig = await this.chain.connection.sendRawTransaction(tx.serialize());
    // confirmTransaction resolves once the tx lands; value.err says whether it SUCCEEDED.
    const conf = await this.chain.connection.confirmTransaction(sig, 'confirmed');
    // The issued message is single-use: consume it so it can't be re-submitted and so
    // the in-memory map doesn't grow unbounded (server-restart risk is documented).
    this.issued.delete(orderId);
    return { signature: sig, payer, err: conf.value.err };
  }
}
