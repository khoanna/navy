import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BN, Program } from '@coral-xyz/anchor';

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}

/** Derive the 16-byte on-chain merchant_id from a merchant DB uuid (v4). */
export function merchantIdFromUuid(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`invalid uuid: ${uuid}`);
  return Array.from(Buffer.from(hex, 'hex'));
}

export function merchantPda(programId: PublicKey, merchantId: number[] | Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), Buffer.from(merchantId)],
    programId,
  )[0];
}

export function invoicePda(
  programId: PublicKey,
  merchantId: number[] | Buffer,
  invoiceId: number[],
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), Buffer.from(merchantId), Buffer.from(invoiceId)],
    programId,
  )[0];
}

export interface BuildPayParams {
  merchantId: number[];
  payout: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
  invoiceId: number[];
  amount: bigint;
  expiry: number;
  payer: PublicKey;
  relayer: PublicKey;
}

export async function buildPayInvoiceTx(program: Program, p: BuildPayParams): Promise<Transaction> {
  const pid = program.programId;
  const payerToken = await getAssociatedTokenAddress(p.usdcMint, p.payer);
  const ix = await program.methods
    .payInvoice(p.invoiceId, new BN(p.amount.toString()), new BN(p.expiry))
    .accounts({
      config: configPda(pid),
      merchant: merchantPda(pid, p.merchantId),
      invoice: invoicePda(pid, p.merchantId, p.invoiceId),
      payerToken,
      merchantPayout: p.payout,
      treasury: p.treasury,
      usdcMint: p.usdcMint,
      payer: p.payer,
      relayer: p.relayer,
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = p.relayer;
  return tx;
}
