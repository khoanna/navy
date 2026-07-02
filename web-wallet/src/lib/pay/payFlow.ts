import { Transaction } from '@solana/web3.js';
import { NavyPayClient } from './navyPayClient';

export interface PayInvoiceArgs {
  orderId: string;
  payer: string;
  client: NavyPayClient;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/** Fetch the relayer-partial-signed tx, add the user signature, submit it. */
export async function payInvoice(a: PayInvoiceArgs): Promise<{ txSignature: string; status: string }> {
  const { tx } = await a.client.getPaymentTx(a.orderId, a.payer);
  const txBytes = Uint8Array.from(atob(tx), (c) => c.charCodeAt(0));
  const unsigned = Transaction.from(txBytes);
  const signed = await a.signTransaction(unsigned);
  const signedBytes = signed.serialize({ requireAllSignatures: false });
  const signedB64 = btoa(String.fromCharCode(...signedBytes));
  return a.client.submitSignedTx(a.orderId, signedB64);
}
