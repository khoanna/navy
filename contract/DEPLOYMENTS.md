# NavyPayments — Deployments

## Ethereum Sepolia (testnet)

| | |
|---|---|
| **NavyPayments** | `0x89fEc56A75518680757aaBdd47Ba8ddFb6480bF3` |
| **USDC (Circle, EIP-2612 permit + EIP-3009)** | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| **Owner / admin** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **Relayer (allowlisted)** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **feeBps** | `100` (1%) |
| Chain ID | `11155111` |

**Unified on Circle's USDC.** Payments and farming both use Circle's canonical Sepolia USDC. Farming supplies it to **Compound III (Comet)** `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e` (whose `baseToken()` is this USDC). Get test USDC from **faucet.circle.com** (Ethereum Sepolia). Set `NAVY_PAYMENTS_ADDRESS` in `be/.env`.

`payInvoice` uses EIP-2612 `permit` + `transferFrom` (Circle USDC supports both permit and EIP-3009; permit is used). USDC EIP-712 domain: `name="USDC"`, `version="2"`.

_Superseded: `0xC3FE…672f` (EIP-3009/Circle), `0xdce5…0f20` (permit/Aave test USDC)._

### End-to-end proof (`be/scripts/evm-e2e.mjs`)
Fund payer with Circle USDC → payer signs an EIP-712 `Permit` → relayer submits `payInvoice` (gasless: `permit` + `transferFrom`) → **99/1 split** → `InvoicePaid` → replay rejected.
- plain-EOA payer: `0xd9eeab93ca6e8bf353a0b0ce0e79385578b511f269e4240c588d1e40d70958f4`
- former-7702 (now plain-EOA) payer `0xd5de…`: `0x7d1eb0d16f4bb1a6157063c4abfb4f18cec431a434f48fa03fc5047f88102076`

### Operational gotchas
- **EIP-7702 delegation can be revoked** — the owner account `0xd5de…` was a 7702 smart account; a self-sponsored type-4 tx delegating to the zero address cleared it back to a plain EOA (`getCode → 0x`), so it can now sign for Circle USDC (whose `SignatureChecker` routes signers-with-code to EIP-1271). Revocation tx: `0x477d13dd3cda8c799a157ff87236510a965098656b91380a98451baee86733c6`.
- **Circle USDC uses `SignatureChecker`** for both permit and EIP-3009 → the payer must be a plain EOA (or an EIP-1271 contract wallet). Plain EOAs work via ecrecover.
- **`forge script --slow`** is only needed against a 7702-delegated sender (gapped-nonce); a plain-EOA deployer doesn't need it.
