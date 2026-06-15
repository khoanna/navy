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
