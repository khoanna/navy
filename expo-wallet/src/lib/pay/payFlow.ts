import { Transaction } from '@solana/web3.js';
import { NavyPayClient } from './navyPayClient';

export interface PayInvoiceArgs {
  orderId: string;
  /** Navy USER access token — the backend derives the payer from it (both pay calls require it). */
  navyAccessToken: string;
  client: NavyPayClient;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  /**
   * The wallet address we intend to sign with. Asserted to be a required signer on the
   * server-built tx, so we never sign a tx built for a different payer than our wallet.
   */
  expectedSigner?: string;
}

/** Fetch the relayer-partial-signed tx, add the user signature, submit it. */
export async function payInvoice(a: PayInvoiceArgs): Promise<{ txSignature: string; status: string }> {
  const { tx } = await a.client.getPaymentTx(a.orderId, a.navyAccessToken);
  const txBytes = Uint8Array.from(atob(tx), (c) => c.charCodeAt(0));
  const unsigned = Transaction.from(txBytes);
  if (a.expectedSigner) {
    const signers = unsigned.signatures.map((s) => s.publicKey.toBase58());
    if (!signers.includes(a.expectedSigner)) {
      throw new Error('This invoice was built for a different wallet');
    }
  }
  const signed = await a.signTransaction(unsigned);
  const signedBytes = signed.serialize({ requireAllSignatures: false });
  const signedB64 = btoa(String.fromCharCode(...signedBytes));
  return a.client.submitSignedTx(a.orderId, signedB64, a.navyAccessToken);
}
