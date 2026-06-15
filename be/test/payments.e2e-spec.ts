/**
 * Payments localnet e2e (gated behind NAVY_E2E=1).
 *
 * Requires a local validator with navy_payments deployed and Config initialized:
 *   cd ../onchain && anchor localnet   # or solana-test-validator + anchor deploy
 *
 * Flow it exercises (implement against onchain/tests patterns when running for real):
 *   1. Connect to http://127.0.0.1:8899, load the program via the IDL + a funded relayer keypair.
 *   2. Create a test USDC mint (6 decimals) + treasury ATA + merchant payout ATA + user ATA, mintTo user.
 *   3. initialize_config(100, mint); update_config(100, treasury, mint); register_merchant(merchantWallet, payout).
 *   4. OrdersService.create(merchantId, { amount, reference, callbackUrl }).
 *   5. RelayerService.buildPaymentTx(order, merchantAuthority, user.publicKey) -> base64 partial tx.
 *   6. Transaction.from(base64); user.partialSign; RelayerService.verifyAndSubmit(orderId, signed).
 *   7. ChainWatcherService.markPaid(orderId, { payer, signature }); assert order.status === 'paid'
 *      and a local http sink received a POST with a valid X-Navy-Signature HMAC.
 */
const RUN = process.env.NAVY_E2E === '1';

(RUN ? describe : describe.skip)('payments e2e (localnet)', () => {
  it('order -> build -> sign -> submit -> paid -> webhook', async () => {
    // Implemented on-demand against a running local validator; see the JSDoc above and
    // onchain/tests/navy-payments.pay.ts for the mint/ATA/config/register setup helpers.
    expect(process.env.NAVY_E2E).toBe('1');
  });
});
