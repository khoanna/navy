# NavyPayments (EVM)

EIP-3009 gasless invoice payments on Ethereum Sepolia. Replaces the Anchor `navy_payments` program. See `docs/superpowers/specs/2026-07-17-navy-evm-migration-design.md`.

## Build & test

```bash
forge build
forge test                 # unit + fuzz; fork test auto-skips
SEPOLIA_RPC_URL=<rpc> forge test   # also runs the real-USDC fork test
forge fmt                  # format
```

## Deploy to Sepolia

1. `cp .env.example .env` and fill `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `NAVY_TREASURY_ADDRESS`, `NAVY_OWNER_ADDRESS`, `NAVY_RELAYER_ADDRESS` (keep `NAVY_USDC_ADDRESS` = Circle Sepolia USDC).
2. Fund the deployer and relayer EOAs with Sepolia ETH.
3. Deploy:
   ```bash
   source .env
   forge script script/Deploy.s.sol:Deploy --rpc-url sepolia --broadcast --verify
   ```
4. Record the printed `NavyPayments deployed at:` address → set it as `NAVY_PAYMENTS_ADDRESS` for the backend (Plan 2).
5. If the deployer is NOT the owner, have the owner call `setRelayer(relayerAddr, true)` before payments can be relayed.

## Admin ops (owner)

`registerMerchant(bytes16 merchantId, address payout)` is called by the backend on merchant approval; `merchantId` is the 16-byte id derived from the merchant DB uuid. Also: `setMerchantActive`, `setMerchantPayout`, `setConfig(feeBps, treasury)`, `setRelayer`.

## Mainnet gates

Professional audit; owner → multisig/timelock; relayer/owner keys → KMS/HSM. See spec §9.
