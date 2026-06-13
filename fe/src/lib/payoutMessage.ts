export interface PayoutMessageArgs {
  merchantId: string;
  address: string;
  nonce: string;
  issuedAt: string;
}

export function buildPayoutMessage(a: PayoutMessageArgs): string {
  return [
    'Navy payout authorization',
    `merchant: ${a.merchantId}`,
    `address: ${a.address}`,
    `nonce: ${a.nonce}`,
    `issuedAt: ${a.issuedAt}`,
  ].join('\n');
}
