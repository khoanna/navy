# NavyPayments (EVM)

EIP-3009 (`receiveWithAuthorization`) gasless invoice payments on Ethereum Sepolia. Replaces the Anchor `navy_payments` program. The payment token is Circle's Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`), which implements EIP-3009. The authorization nonce is `keccak256(merchantId, invoiceId)`, so the payer's signature binds the merchant + invoice + amount + expiry (a property EIP-2612 `permit` cannot provide), and `receiveWithAuthorization` requires `msg.sender == to` so only this contract can redeem it. See `docs/superpowers/specs/2026-07-17-navy-evm-migration-design.md`.

## Build & test

```bash
forge build
forge test                 # unit + fuzz; fork test auto-skips
SEPOLIA_RPC_URL=<rpc> forge test   # also runs the real Circle-USDC receiveWithAuthorization fork test
forge fmt                  # format
```

## Base SRCLA vault

The farming redesign is a separate Base-native ERC-4626 system over Circle native USDC. The immutable core accepts
only Base chain ID `8453` and Circle USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Users submit ordinary
ERC-4626 transactions and pay their own gas. There is no farming relayer, gasless deposit, or relayed redemption.

Put deployment values in an uncommitted `contract/.env`:

```bash
BASE_RPC_URL=<Base JSON-RPC URL>
BASE_ADMIN_PRIVATE_KEY=<deployment/admin key; never commit>
SRCLA_ALLOCATOR_ADDRESS=<distinct allocator EOA used by /srcla>
BASE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

Deploy only the immutable vault core:

```bash
source .env
forge script script/DeployBaseVault.s.sol:DeployBaseVault \
  --rpc-url "$BASE_RPC_URL" --broadcast --verify
```

The command prints the vault address, asset, admin, and allocator. Record the address in `DEPLOYMENTS.md` and set
`BASE_VAULT_ADDRESS` before administration. Strategies and the shared reward executor are deployed by their own
plans; their changeable addresses are outputs, not constants embedded in this script. The old `DeployVault` target
is a deprecated alias of this Base-only core deployment.

Owner operations use one explicit action per transaction:

```bash
BASE_VAULT_ADDRESS=<deployed vault>
BASE_VAULT_ADMIN_ACTION=SET_PAUSED
BASE_VAULT_PAUSED=true
forge script script/AdminBaseVault.s.sol:AdminBaseVault \
  --rpc-url "$BASE_RPC_URL" --broadcast
```

Supported `BASE_VAULT_ADMIN_ACTION` values and their additional environment variables are:

| Action | Required values |
|---|---|
| `ADD_ADAPTER` | `BASE_STRATEGY_ADDRESS` |
| `SET_ADAPTER_STATUS` | `BASE_STRATEGY_ADDRESS`, `BASE_ADAPTER_STATUS` (`1` active, `2` disabled, `3` impaired, `4` removed) |
| `SET_ADAPTER_LIMITS` | `BASE_STRATEGY_ADDRESS`, `BASE_ADAPTER_CAP_BPS`, `BASE_ADAPTER_ABSOLUTE_CAP`, `BASE_ADAPTER_MAX_LOSS_BPS`, `BASE_ADAPTER_ACCOUNTING_CAP` |
| `SET_DEPENDENCY_CAP` | `BASE_DEPENDENCY_ID`, `BASE_DEPENDENCY_CAP_BPS`, `BASE_DEPENDENCY_ABSOLUTE_CAP` |
| `SET_ADAPTER_DEPENDENCIES` | `BASE_STRATEGY_ADDRESS`, comma-separated `BASE_DEPENDENCY_IDS` |
| `SET_ADMIN_IDLE_FLOOR` | `BASE_ADMIN_IDLE_FLOOR` (USDC base units) |
| `SET_REWARD_ACCOUNTANT` | `BASE_REWARD_ACCOUNTANT_ADDRESS` |
| `SET_WITHDRAWAL_ORDER` | comma-separated `BASE_WITHDRAWAL_ORDER` |
| `SET_PAUSED` | `BASE_VAULT_PAUSED` |
| `SET_ALLOCATOR` | `SRCLA_ALLOCATOR_ADDRESS` |
| `TRANSFER_OWNERSHIP` | `BASE_NEW_ADMIN_ADDRESS` (the recipient must call `acceptOwnership`) |
| `RECORD_IMPAIRMENT` | `BASE_STRATEGY_ADDRESS`, `BASE_ADAPTER_IMPAIRMENT_AMOUNT` |

The admin script rejects the wrong chain, a non-USDC vault, a missing contract, or a key that is not the current
vault owner before broadcasting. Adapter, reward, route, cap, and dependency values must come from the pinned
manifests and conformance checks delivered by the strategy and reward-executor plans.

## Deploy to Sepolia

1. `cp .env.example .env` and fill `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `NAVY_TREASURY_ADDRESS`, `NAVY_OWNER_ADDRESS`, `NAVY_RELAYER_ADDRESS` (set `NAVY_USDC_ADDRESS` = Circle Sepolia USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`).
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
