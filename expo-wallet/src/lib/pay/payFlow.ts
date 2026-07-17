import { Eip712TypedData, NavyPayClient } from './navyPayClient';

export interface PayInvoiceArgs {
  orderId: string;
  /** Navy USER access token — the backend derives the payer from it (both pay calls require it). */
  navyAccessToken: string;
  client: NavyPayClient;
  /**
   * Sign the EIP-712 typed data with the embedded EVM wallet (eth_signTypedData_v4)
   * and return the 65-byte 0x signature.
   */
  signTypedData: (typedData: Eip712TypedData) => Promise<string>;
  /**
   * The wallet address we intend to sign with. Asserted to equal the typed-data
   * `message.from`, so we never sign an authorization built for a different payer.
   */
  expectedSigner?: string;
}

/** Fetch the payment-authorization typed data, sign it, submit the signature. */
export async function payInvoice(a: PayInvoiceArgs): Promise<{ txHash: string; status: string }> {
  const { typedData } = await a.client.getPaymentAuthorization(a.orderId, a.navyAccessToken);
  if (a.expectedSigner) {
    const from = typedData.message.from;
    if (typeof from !== 'string' || from.toLowerCase() !== a.expectedSigner.toLowerCase()) {
      throw new Error('This invoice was built for a different wallet');
    }
  }
  const signature = await a.signTypedData(typedData);
  return a.client.submitSignature(a.orderId, signature, a.navyAccessToken);
}
