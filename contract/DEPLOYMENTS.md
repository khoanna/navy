# NavyPayments — Deployments

## Ethereum Sepolia (testnet)

| | |
|---|---|
| **NavyPayments** | `0xC3FE1f88cA721e241f77f2E58dF6E5Da4DA0672f` |
| **USDC (Circle, EIP-3009)** | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| **Owner / admin** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **Relayer (allowlisted)** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **feeBps** | `100` (1%) |
| Chain ID | `11155111` |

Set `NAVY_PAYMENTS_ADDRESS` in `be/.env` to the address above.

### End-to-end proof (`be/scripts/evm-e2e.mjs`)
Register merchant → payer signs EIP-712 `ReceiveWithAuthorization` → relayer submits `payInvoice` (gasless) → **99/1 split verified** (495000 merchant / 5000 treasury on a 0.5 USDC invoice) → `InvoicePaid` emitted → replay rejected.
- payInvoice tx: `0x29d9ed5ebf732e67e10b612c8687aed2b311d579bb7c35922faa62d1f3205aca`

### Operational gotchas learned during deploy
- **EIP-7702 smart accounts can't be the *payer*.** Circle USDC (`FiatTokenV2_2`) treats a signer that *has code* as a contract and requires an EIP-1271 signature, so a raw-key ECDSA signature from a 7702-delegated EOA is rejected with `FiatTokenV2: invalid signature`. The **payer must be a plain EOA** (empty `getCode`). The owner/relayer may be smart accounts (they only *send* txs).
- **`forge script` against a 7702 account needs `--slow`.** Some RPCs reject queued/gapped nonces from delegated accounts (`gapped-nonce tx from delegated accounts`); `--slow` submits sequentially, waiting for each tx to mine.
- **USDC EIP-712 domain on Sepolia:** `name = "USDC"`, `version = "2"` (verified on-chain via `name()`/`version()`).
