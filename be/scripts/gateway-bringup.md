# Gateway devnet bring-up

Prerequisites: Solana CLI, Anchor, a funded devnet keypair at ~/.config/solana/id.json.

1. Build + deploy the program to devnet:
   cd ../onchain && anchor build && anchor deploy --provider.cluster devnet
   (Note the deployed program id; it must match NAVY_PROGRAM_ID and the IDL address.)

2. Create a Navy treasury USDC ATA for the Circle devnet mint:
   spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --url devnet
   (Record the ATA address -> NAVY_TREASURY.)

3. Initialize on-chain Config:
   cd ../onchain && NAVY_FEE_BPS=100 NAVY_TREASURY=<treasuryAta> \
     NAVY_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
     ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
     pnpm exec ts-node scripts/admin.ts init-config

4. Register an approved merchant (merchant_authority = their payout wallet, payout = its USDC ATA for the Circle mint):
   pnpm exec ts-node scripts/admin.ts register-merchant <merchantWallet> <merchantUsdcAta>

5. Fund the relayer with devnet SOL:
   solana airdrop 2 <relayerPubkey> --url devnet

6. Set be/.env:
   NAVY_PROGRAM_ID, NAVY_USDC_MINT (Circle mint above), NAVY_TREASURY (step 2),
   NAVY_RELAYER_SECRET (relayer keypair secret as JSON byte array), NAVY_PAY_BASE_URL.

7. Test users obtain devnet USDC from https://faucet.circle.com (select Solana Devnet),
   and devnet SOL is NOT needed by users (gasless — the relayer pays).

8. Smoke: with the backend running, create an order (HMAC), GET /v1/orders/:id/payment-tx?payer=<userPubkey>,
   sign the returned tx with the user wallet, POST /v1/orders/:id/submit { signedTx }, then GET /v1/orders/:id
   and confirm status 'paid' and the webhook fired.

## Admin registrar (sub-project 4)
- NAVY_ADMIN_SECRET must be the program's admin authority keypair (the one that ran `init-config`), as a 64-byte JSON array. Fund it with devnet SOL (it pays rent for register_merchant): `solana airdrop 2 <registrarPubkey> --url devnet`.
- Approving a merchant in the admin UI calls register_merchant (or reactivates) on-chain automatically; rejecting deactivates.
- Integration check (localnet): with the program deployed + config initialized, set NAVY_ADMIN_SECRET to the config admin, create a merchant with a payoutAddress, POST /admin/merchants/:id/approve, then assert the on-chain Merchant PDA exists and active=true (mirror onchain/tests/navy-payments.merchant.ts).

## Farming agent (sub-project 7, devnet)
- Save (Solend) devnet SOL reserve: program ALend7Ket…, reserve 5VVLD7…. Farms native SOL (devnet-airdroppable); devnet pools do NOT use Circle USDC.
- Bounds: NAVY_FARM_RENT_BUFFER / NAVY_FARM_MIN_DEPOSIT / NAVY_FARM_MAX_DEPOSIT; the scheduler runs every 5 min.
- Smoke: POST /farming/subwallet → `solana airdrop 1 <subwalletAddress> --url devnet` → POST /farming/deposit (or wait for the cron) → GET /farming shows a growing value → POST /farming/withdraw {amount:'all'} returns SOL to the user's main wallet.
- Devnet oracle staleness can revert deposits/withdraws — the agent retries. MAINNET gates: KMS master key, security audit, KaminoYieldAdapter + reward harvest/compound, USDC farming.
