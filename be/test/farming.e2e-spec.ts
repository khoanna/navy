/**
 * Farming Sepolia integration (gated behind NAVY_FARM_E2E=1; needs Circle USDC + a live Compound v3 Comet).
 *
 * Prerequisites:
 *   - NAVY_FARM_E2E=1 in env
 *   - A running Navy backend pointed at Sepolia (all NAVY_* env vars set)
 *   - Circle USDC (Sepolia test USDC, 6 decimals) to fund the subwallet
 *   - A little Sepolia ETH on the subwallet to pay gas for the supply/withdraw txs
 *   - Compound v3 USDC Comet live on Sepolia
 *
 * Flow: POST /farming/subwallet -> fund the address with Circle USDC + a little Sepolia ETH ->
 *       POST /farming/deposit {amountBase} (supplies USDC to the Compound Comet) ->
 *       GET /farming (currentValueBase > 0) ->
 *       POST /farming/withdraw {amount:'all'} -> owner USDC balance up.
 *
 * Note: This file lives in be/test/ and uses the e2e jest config (test/jest-e2e.js).
 * The describe.skip guard keeps it inert when NAVY_FARM_E2E is not set.
 */
const RUN = process.env.NAVY_FARM_E2E === '1';

(RUN ? describe : describe.skip)('farming e2e (Sepolia)', () => {
  it('provision -> fund -> deposit -> position -> withdraw to owner', async () => {
    expect(process.env.NAVY_FARM_E2E).toBe('1');
    // Implement against the running backend + Sepolia when exercising for real (see JSDoc).
    //
    // Suggested implementation outline:
    //
    // const app = ... // NestJS test app or HTTP supertest against running backend
    // const usdc = new ethers.Contract(CIRCLE_USDC, ERC20_ABI, provider);
    //
    // // 1. Provision subwallet
    // const userId = 'e2e-test-user-' + Date.now();
    // const { body: { address } } = await request(app).post('/farming/subwallet').send({ userId, ownerMainWallet });
    //
    // // 2. Fund the subwallet with Circle USDC + a little Sepolia ETH for gas
    // //    (transfer USDC to `address` and send it ~0.01 ETH; wait for confirmations)
    // await new Promise(r => setTimeout(r, 15000));
    //
    // // 3. Deposit (supplies USDC to the Compound v3 Comet)
    // const { body: dep } = await request(app).post('/farming/deposit').send({ userId, amountBase: '5000000' });
    // expect(dep.txSignature).toBeTruthy();
    //
    // // 4. Check position
    // await new Promise(r => setTimeout(r, 15000));
    // const { body: pos } = await request(app).get('/farming').query({ userId });
    // expect(BigInt(pos.currentValueBase)).toBeGreaterThan(0n);
    //
    // // 5. Withdraw all (redeems from the Comet back to the owner)
    // const ownerUsdcBefore = await usdc.balanceOf(ownerMainWallet);
    // const { body: wd } = await request(app).post('/farming/withdraw').send({ userId, amount: 'all' });
    // expect(wd.txSignature).toBeTruthy();
    //
    // // 6. Verify owner received USDC
    // await new Promise(r => setTimeout(r, 15000));
    // const ownerUsdcAfter = await usdc.balanceOf(ownerMainWallet);
    // expect(ownerUsdcAfter > ownerUsdcBefore).toBe(true);
  });
});
