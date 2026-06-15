import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Transaction, Keypair, Connection } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { configPda, merchantPda, invoicePda } from './pdas';

export interface PayInvoiceParams {
  merchantAuthority: PublicKey;
  payout: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
  invoiceId: Uint8Array;   // 16 bytes
  amount: bigint;
  expiry: number;          // unix seconds
  payer: PublicKey;
  relayer: PublicKey;
}

export async function buildPayInvoiceTx(program: Program<any>, p: PayInvoiceParams): Promise<Transaction> {
  const pid = program.programId;
  const payerToken = await getAssociatedTokenAddress(p.usdcMint, p.payer);
  const ix = await program.methods
    .payInvoice([...p.invoiceId], new anchor.BN(p.amount.toString()), new anchor.BN(p.expiry))
    .accounts({
      config: configPda(pid), merchant: merchantPda(pid, p.merchantAuthority),
      invoice: invoicePda(pid, p.merchantAuthority, p.invoiceId),
      payerToken, merchantPayout: p.payout, treasury: p.treasury, usdcMint: p.usdcMint,
      payer: p.payer, relayer: p.relayer,
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = p.relayer;
  return tx;
}

export async function submitPayInvoice(connection: Connection, tx: Transaction, relayer: Keypair): Promise<string> {
  tx.partialSign(relayer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
