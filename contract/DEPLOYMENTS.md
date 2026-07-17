# NavyPayments — Deployments

## Ethereum Sepolia (testnet)

> **Stale — pending EIP-2612 re-deploy.** The row below records the prior EIP-3009 (Circle USDC) deployment. The contract has since migrated to EIP-2612 `permit` against Aave Sepolia USDC (`0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8`); a new address/tx will replace these once the controller redeploys.

| | |
|---|---|
| **NavyPayments** | `0xC3FE1f88cA721e241f77f2E58dF6E5Da4DA0672f` _(pre-migration)_ |
| **USDC (Aave, EIP-2612 permit)** | `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8` |
| **Owner / admin** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **Relayer (allowlisted)** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **feeBps** | `100` (1%) |
| Chain ID | `11155111` |

Set `NAVY_PAYMENTS_ADDRESS` in `be/.env` to the deployed address.

### End-to-end proof (`be/scripts/evm-e2e.mjs`)
Register merchant → payer signs an EIP-712 `Permit` (EIP-2612) → relayer submits `payInvoice` (gasless: `permit` + `transferFrom`) → **99/1 split verified** (495000 merchant / 5000 treasury on a 0.5 USDC invoice) → `InvoicePaid` emitted → replay rejected.
- pre-migration payInvoice tx (EIP-3009): `0x29d9ed5ebf732e67e10b612c8687aed2b311d579bb7c35922faa62d1f3205aca`

### Operational gotchas learned during deploy
- **EIP-2612 permit uses plain `ecrecover`.** Unlike Circle USDC's EIP-3009 path (which routes signers with code to EIP-1271), Aave USDC's `permit` recovers via ECDSA, so a 7702-delegated EOA *should* be able to sign — but the fork test keeps the "skip if payer has code" guard for safety.
- **`forge script` against a 7702 account needs `--slow`.** Some RPCs reject queued/gapped nonces from delegated accounts (`gapped-nonce tx from delegated accounts`); `--slow` submits sequentially, waiting for each tx to mine.
- **Aave USDC EIP-712 domain on Sepolia:** `name = "USDC"`, `version = "1"` (verified on-chain).
