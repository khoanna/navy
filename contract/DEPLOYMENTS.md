# NavyPayments — Deployments

## Base SRCLA vault (mainnet)

Not yet deployed. See `docs/superpowers/specs/srcla-phase-07-ablation-design.md` for the deployment plan.
Production on Base requires: professional audit, timelock + owner→multisig, KMS/HSM keys, ERC-4337 paymaster,
MorphoAdapter live-verified Circle-USDC market — see `docs/PRODUCTION.md`.

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

## NavyVault — Plan 1 review follow-ups (tracked)

From the final security review of the contracts (branch `feat/navy-vault-rebalancing`). No Critical issues; the custody invariant (allocator can only move funds between owner-allowlisted adapters, never to an EOA; adapters return funds only to the vault) is verified correct. Follow-ups before this vault holds real money:

1. **`_ensureIdle` aggregate-loss semantics (mainnet gate).** The `maxLossBps` bound is enforced per-adapter-pull, not aggregated across the redemption. Under genuinely lossy withdrawals across multiple venues the total realized shortfall could exceed `maxLossBps` of the redeemed amount (socialized loss). Latent on testnet (Compound is not lossy in normal operation). Before mainnet: bound total realized loss across the `_ensureIdle` loop, or reprice `assets` after the pulls.
2. **SafeERC20 — intentionally NOT adopted.** The money layer uses bare `transfer`/`approve` on Circle USDC (which reverts on failure), matching the documented `NavyPayments` convention ("no SafeERC20 dependency"). The vault asset is fixed to Circle USDC at construction, so this is correct here. Recorded so it isn't "fixed" later by mistake.

## NavyVaultSRCLA deployment (Sepolia) — DEPLOYED 2026-07-28

- NavyVaultSRCLA: `0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE`
- CompoundAdapter: `0x24d4173e6b9734a52c20190a9c5681ef350D8fE2`
- owner / keeper(allocator) / relayer: `0xd5de8324D526A201672B30584e495C71BeBb3e9A` (single devnet key)
- asset: Circle USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`; Comet `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e`
- share token: name "Navy Vault USDC", version "1"; minIdleBps 1000, maxLossBps 50
- MorphoAdapter: not deployed (Morpho never registered on Sepolia; can revisit when a live Circle-USDC market exists)
- **Live E2E verified** (`be/scripts/vault-e2e.mjs`, real Sepolia): deposit 0x002f4c84…055a67 · deployToAdapter 0xb0b756c8…c43979 · permit+redeem 0x822faf33…e9466. Deposit→rebalance(Compound)→redeem-with-liquidity-pull all green.

## Base SRCLA vault — deployment package

**Not yet deployed.** The deployment package is ready; production deployment requires the gates listed at the top of this file.

### Deployment artifacts

| Artifact | Location |
|---|---|
| Deploy script | `script/DeployBaseSystem.s.sol` |
| Verifier | `script/VerifyBaseSystem.s.sol` |
| Conformance tests | `test/script/DeployBaseSystem.t.sol` |
| Verifier tests | `test/script/VerifyBaseSystem.t.sol` |
| Strategy config | `config/base-strategies.json` |
| Reward routes | `config/base-reward-routes.json` |
| Reward policies | `config/base-reward-policies.json` |

### Key addresses (Base mainnet)

| Contract | Address |
|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Aave V3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |
| Compound III Comet | `0xb125E6687d4313864e53df431d5425969c15Eb2F` |
| Moonwell mUSDC | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` |
| Moonwell Comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |
| Uniswap Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| Uniswap Router02 | `0x2626664C2603336E57b271C5c0b26F42121e30D0` |
| Chainlink Sequencer | `0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7` |
| Chainlink USDC/USD | `0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56` |
| Chainlink WETH/USD | `0x7105EC27F7f0ad0fec6FF5cAAc52d34B8cd6d10e` |

### Role separation

- **Admin** (multi-sig): gets `DEFAULT_ADMIN_ROLE` + `ADMIN_ROLE`
- **Allocator** (keeper bot): gets `ONLY ALLOCATOR_ROLE`
- Admin and allocator MUST be different addresses

### Adapter allocation weights

| Adapter | Target Weight | Max Slippage |
|---|---|---|
| Aave V3 | 40% | 100 bps |
| Compound III | 40% | 100 bps |
| Moonwell | 20% | 150 bps |

### Reward tokens

COMP and WELL routes are configured but inactive:
- COMP: rewards ended on Base
- WELL: rewards currently unfunded

### Test results

```
DeployBaseSystemTest:    27 passed
VerifyBaseSystemTest:    13 passed (USDC decimals check requires forked mainnet)
BaseDeploymentAcceptanceTest: 6 tests (requires running Anvil fork)
```

### Acceptance tests (Task 14)

```
forge test --match-path test/integration/BaseDeploymentAnvil.t.sol --fork-url http://127.0.0.1:8545
```

Run Anvil fork:
```bash
anvil --fork-url "$BASE_RPC_URL" --fork-block-number 49926094 --chain-id 8453 --port 8545
```

Acceptance test coverage:
- deposit/mint: verifies shares minted and balance tracking
- withdraw/redeem: verifies exact asset withdrawal
- pause: verifies deposits blocked, withdrawals allowed
- NAV conservation: verifies share price positive, assets >= idle

### Evidence package

Full verification evidence: `audit/RELEASE-EVIDENCE-2026-08-14.md`

Run conformance: `forge test --match-contract DeployBaseSystemTest`
Run verifier tests: `forge test --match-contract VerifyBaseSystemTest`
Verify deployment: `forge script script/VerifyBaseSystem.s.sol --fork-url $BASE_RPC_URL --sig "run(address,address,address,address,address,address,address)" <vault> <aave> <compound> <moonwell> <rewards> <admin> <allocator>`
