import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BN, Program } from '@coral-xyz/anchor';

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}

export function merchantPda(programId: PublicKey, merchantAuthority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), merchantAuthority.toBuffer()],
    programId,
  )[0];
}

export function invoicePda(
  programId: PublicKey,
  merchantAuthority: PublicKey,
  invoiceId: number[],
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), merchantAuthority.toBuffer(), Buffer.from(invoiceId)],
    programId,
  )[0];
}

export interface BuildPayParams {
  merchantAuthority: PublicKey;
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
      merchant: merchantPda(pid, p.merchantAuthority),
      invoice: invoicePda(pid, p.merchantAuthority, p.invoiceId),
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
