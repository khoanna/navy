# NavyPayments — Deployments

## Ethereum Sepolia (testnet)

| | |
|---|---|
| **NavyPayments** | `0xdce57a75499c96d172a01263620B7e097BA70f20` |
| **USDC (Aave Sepolia, EIP-2612 permit)** | `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8` |
| **Owner / admin** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **Relayer (allowlisted)** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **feeBps** | `100` (1%) |
| Chain ID | `11155111` |

Payments and farming now use the **same** USDC (Aave's Sepolia test USDC) — no more two-token seam. Mint it via the Aave Faucet `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D` (`mint(token, to, amount)`, which owns the token). Set `NAVY_PAYMENTS_ADDRESS` in `be/.env` to the deployed address.

_(Prior EIP-3009 / Circle-USDC deployment was `0xC3FE1f88cA721e241f77f2E58dF6E5Da4DA0672f`; superseded.)_

### End-to-end proof (`be/scripts/evm-e2e.mjs`)
Faucet-mint Aave USDC → payer signs an EIP-712 `Permit` (EIP-2612) → relayer submits `payInvoice` (gasless: `permit` + `transferFrom`) → **99/1 split verified** → `InvoicePaid` emitted → replay rejected.
- payInvoice tx (plain-EOA payer): `0xcd2efa2ee8fa2eac44f150bc9a15bac848aed6f639db79005f48ffc37365bab1`
- payInvoice tx (7702 smart-account payer): `0x5638347a34d48353597bc3043715a87994516b7058524a3052271c1996f91573`

### Operational gotchas
- **EIP-2612 permit uses plain `ecrecover`** — so BOTH a plain EOA and a 7702-delegated smart account can be the payer (verified above). This is the key advantage over Circle USDC's EIP-3009, whose `SignatureChecker` routes signers-with-code to EIP-1271 and rejects a raw ECDSA sig.
- **`forge script` against a 7702 account needs `--slow`** — some RPCs reject queued/gapped nonces from delegated accounts; `--slow` submits sequentially.
- **Aave USDC EIP-712 domain on Sepolia:** `name = "USDC"`, `version = "1"` (verified on-chain; it has no `version()` getter, reconstructed vs `DOMAIN_SEPARATOR()`).
- **Aave USDC `mint` is owner-only** (owner = the Faucet); fund test accounts through the Faucet contract, not the token directly.
