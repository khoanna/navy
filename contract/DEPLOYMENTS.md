# NavyPayments — Deployments

## Base SRCLA vault (mainnet)

| | |
|---|---|
| Chain ID | `8453` |
| Asset | Circle native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| NavyVault | _Not deployed; record `DeployBaseVault` output here_ |
| Admin | _Derived from `BASE_ADMIN_PRIVATE_KEY` at deployment_ |
| Allocator | _Set from `SRCLA_ALLOCATOR_ADDRESS` at deployment_ |
| Strategies | _Outputs of the Base strategy deployment plan; not embedded in the core_ |
| RewardExecutor | _Output of the reward-executor deployment plan; not embedded in the core_ |

The Base vault core is immutable and has no relayer state. Deployment is rejected outside Base or for any asset
other than the canonical Circle USDC address. Newly deployed cores contain no admitted adapters and no reward
accountant; those addresses are recorded only after their pinned Base-fork conformance gates pass.

## Ethereum Sepolia (testnet)

| | |
|---|---|
| **NavyPayments** | `0xb135C49Ef6c0505F7fB55932F31A9E93eba6e907` |
| **USDC (Circle, EIP-2612 permit + EIP-3009)** | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| **Owner / admin** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **Relayer (allowlisted)** | `0xd5de8324D526A201672B30584e495C71BeBb3e9A` |
| **feeBps** | `100` (1%) |
| Chain ID | `11155111` |

**Unified on Circle's USDC.** Payments and farming both use Circle's canonical Sepolia USDC. Farming supplies it to **Compound III (Comet)** `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e` (whose `baseToken()` is this USDC). Get test USDC from **faucet.circle.com** (Ethereum Sepolia). Set `NAVY_PAYMENTS_ADDRESS` in `be/.env`.

`payInvoice` uses EIP-3009 `receiveWithAuthorization` (Circle USDC supports both permit and EIP-3009; EIP-3009 is used because its nonce = `keccak256(merchantId, invoiceId)` binds merchant + invoice + amount + payer + expiry into the signature, and `msg.sender == to` restricts redemption to this contract — a binding permit cannot provide). USDC EIP-712 domain: `name="USDC"`, `version="2"`.

_Superseded: `0x1639…844c` (EIP-3009/Circle, redeployed 2026-07-25), `0xC3FE…672f` (EIP-3009/Circle), `0xdce5…0f20` (permit/Aave test USDC)._

### End-to-end proof (`be/scripts/evm-e2e.mjs`)
Fund payer with Circle USDC → payer signs an EIP-712 `ReceiveWithAuthorization` (nonce = `keccak256(merchantId, invoiceId)`) → relayer submits `payInvoice` (gasless: `receiveWithAuthorization`) → **99/1 split** → `InvoicePaid` → replay rejected.
- plain-EOA payer: `0xd9eeab93ca6e8bf353a0b0ce0e79385578b511f269e4240c588d1e40d70958f4`
- former-7702 (now plain-EOA) payer `0xd5de…`: `0x7d1eb0d16f4bb1a6157063c4abfb4f18cec431a434f48fa03fc5047f88102076`

### Farming proof (`be/scripts/farming-e2e.mjs`)
Provision subwallet → fund with Circle USDC + Sepolia ETH → `approve` + Comet `supply` → `balanceOf` (position) → `withdrawTo(owner, USDC, balanceOf)`. Verified live against Compound III (Comet). Last withdraw tx: `0x4b6e2ce5b0f64c5706fad164505bbb930527fd010c620ae0ba995b4059c28d90`.

### Operational gotchas
- **Public-RPC `eth_estimateGas` can spuriously revert for Comet `withdraw`** (the `eth_call` + real execution succeed). Pass an explicit `gasLimit` for subwallet withdraw txs, or use a proper RPC (Alchemy/Infura) rather than a public endpoint.
- **EIP-7702 delegation can be revoked** — the owner account `0xd5de…` was a 7702 smart account; a self-sponsored type-4 tx delegating to the zero address cleared it back to a plain EOA (`getCode → 0x`), so it can now sign for Circle USDC (whose `SignatureChecker` routes signers-with-code to EIP-1271). Revocation tx: `0x477d13dd3cda8c799a157ff87236510a965098656b91380a98451baee86733c6`.
- **Circle USDC uses `SignatureChecker`** for both permit and EIP-3009 → the payer must be a plain EOA (or an EIP-1271 contract wallet). Plain EOAs work via ecrecover.
- **`forge script --slow`** is only needed against a 7702-delegated sender (gapped-nonce); a plain-EOA deployer doesn't need it.

## NavyVault / Morpho market (Sepolia)

- Morpho Blue: `0xd011EE229E7459ba1ddd22631eF7bF528d424A14`
- Circle USDC (loanToken): `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Market id: `<TO RESOLVE — run script/ResolveMorphoMarket.s.sol against a candidate id>`
- marketParams (loanToken / collateralToken / oracle / irm / lltv): `<TO RESOLVE>`
- Source: `<existing market url, or "created via createMarket in tx 0x…">`

> Resolve with: `MORPHO_ADDRESS=0xd011EE229E7459ba1ddd22631eF7bF528d424A14 MORPHO_MARKET_ID=<candidate> forge script script/ResolveMorphoMarket.s.sol --rpc-url sepolia`
> If no live Circle-USDC market exists, create one via Morpho.createMarket(marketParams) with loanToken = Circle USDC and record its id here.

## NavyVault — Plan 1 review follow-ups (tracked)

From the final security review of the contracts (branch `feat/navy-vault-rebalancing`). No Critical issues; the custody invariant (allocator can only move funds between owner-allowlisted adapters, never to an EOA; adapters return funds only to the vault) is verified correct. Follow-ups before this vault holds real money:

1. **Live-verify `MorphoAdapter` before registering it.** Its `deposit`/`withdraw`/`totalAssets`/`supplyRatePerYear` have never executed on-chain (no resolved Sepolia Circle-USDC market). Resolve the market (section above), set the `MORPHO_*` env vars, and run `forge test --match-contract MorphoAdapterForkTest` against a real RPC (Alchemy/Infura — public RPCs are flaky for this) until green. Do NOT `addAdapter(morpho, …)` in production before this passes. `CompoundAdapter` is already verified live.
2. **`_ensureIdle` aggregate-loss semantics (mainnet gate).** The `maxLossBps` bound is enforced per-adapter-pull, not aggregated across the redemption. Under genuinely lossy withdrawals across multiple venues the total realized shortfall could exceed `maxLossBps` of the redeemed amount (socialized loss). Latent on testnet (Compound/Morpho are not lossy in normal operation). Before mainnet: bound total realized loss across the `_ensureIdle` loop, or reprice `assets` after the pulls.
3. **SafeERC20 — intentionally NOT adopted.** The money layer uses bare `transfer`/`approve` on Circle USDC (which reverts on failure), matching the documented `NavyPayments` convention ("no SafeERC20 dependency"). The vault asset is fixed to Circle USDC at construction, so this is correct here. Recorded so it isn't "fixed" later by mistake.

## NavyVault deployment (Sepolia) — DEPLOYED 2026-07-28

- NavyVault: `0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE`
- CompoundAdapter: `0x24d4173e6b9734a52c20190a9c5681ef350D8fE2`
- owner / keeper(allocator) / relayer: `0xd5de8324D526A201672B30584e495C71BeBb3e9A` (single devnet key)
- asset: Circle USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`; Comet `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e`
- share token: name "Navy Vault USDC", version "1"; minIdleBps 1000, maxLossBps 50
- MorphoAdapter: not yet deployed (pending resolved market — do NOT register until live-fork-verified)
- **Live E2E verified** (`be/scripts/vault-e2e.mjs`, real Sepolia): deposit 0x002f4c84…055a67 · deployToAdapter 0xb0b756c8…c43979 · permit+redeem 0x822faf33…e9466. Deposit→rebalance(Compound)→redeem-with-liquidity-pull all green.
