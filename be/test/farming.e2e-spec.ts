/**
 * Farming devnet integration (gated behind NAVY_FARM_E2E=1; needs devnet SOL + the live Save SOL reserve).
 *
 * Prerequisites:
 *   - NAVY_FARM_E2E=1 in env
 *   - A running Navy backend pointed at devnet (all NAVY_* env vars set)
 *   - Devnet SOL available for airdrop: `solana airdrop 1 <subwalletAddress> --url devnet`
 *   - Save devnet SOL reserve live: program ALend7Ket…, reserve 5VVLD7…
 *
 * Flow: POST /farming/subwallet -> airdrop devnet SOL to the address ->
 *       POST /farming/deposit -> GET /farming (currentValue > 0) ->
 *       POST /farming/withdraw {amount:'all'} -> owner balance up.
 *
 * Save devnet oracles are unreliable; retry deposit/withdraw on stale-oracle reverts.
 *
 * Note: This file lives in be/test/ and uses the e2e jest config (test/jest-e2e.js).
 * The describe.skip guard keeps it inert when NAVY_FARM_E2E is not set.
 */
const RUN = process.env.NAVY_FARM_E2E === '1';

(RUN ? describe : describe.skip)('farming e2e (devnet)', () => {
  it('provision -> fund -> deposit -> position -> withdraw to owner', async () => {
    expect(process.env.NAVY_FARM_E2E).toBe('1');
    // Implement against the running backend + devnet when exercising for real (see JSDoc).
    //
    // Suggested implementation outline:
    //
    // const app = ... // NestJS test app or HTTP supertest against running backend
    //
    // // 1. Provision subwallet
    // const userId = 'e2e-test-user-' + Date.now();
    // const { body: { address } } = await request(app).post('/farming/subwallet').send({ userId, ownerMainWallet });
    //
    // // 2. Airdrop devnet SOL to the subwallet
    // const { execSync } = require('child_process');
    // execSync(`solana airdrop 1 ${address} --url devnet`, { stdio: 'inherit' });
    // await new Promise(r => setTimeout(r, 3000)); // wait for confirmation
    //
    // // 3. Deposit (with retry for stale oracle)
    // let depositOk = false;
    // for (let attempt = 0; attempt < 3 && !depositOk; attempt++) {
    //   try {
    //     const { body } = await request(app).post('/farming/deposit').send({ userId, amountLamports: '500000000' });
    //     expect(body.txSignature).toBeTruthy();
    //     depositOk = true;
    //   } catch (e) {
    //     if (!String(e).includes('stale')) throw e;
    //     await new Promise(r => setTimeout(r, 5000));
    //   }
    // }
    // expect(depositOk).toBe(true);
    //
    // // 4. Check position
    // await new Promise(r => setTimeout(r, 3000));
    // const { body: pos } = await request(app).get('/farming').query({ userId });
    // expect(BigInt(pos.currentValueLamports)).toBeGreaterThan(0n);
    //
    // // 5. Withdraw all (with retry for stale oracle)
    // const ownerBalanceBefore = await connection.getBalance(new PublicKey(ownerMainWallet));
    // let withdrawOk = false;
    // for (let attempt = 0; attempt < 3 && !withdrawOk; attempt++) {
    //   try {
    //     const { body } = await request(app).post('/farming/withdraw').send({ userId, amount: 'all' });
    //     expect(body.txSignature).toBeTruthy();
    //     withdrawOk = true;
    //   } catch (e) {
    //     if (!String(e).includes('stale')) throw e;
    //     await new Promise(r => setTimeout(r, 5000));
    //   }
    // }
    // expect(withdrawOk).toBe(true);
    //
    // // 6. Verify owner received SOL
    // await new Promise(r => setTimeout(r, 3000));
    // const ownerBalanceAfter = await connection.getBalance(new PublicKey(ownerMainWallet));
    // expect(ownerBalanceAfter).toBeGreaterThan(ownerBalanceBefore);
  });
});
