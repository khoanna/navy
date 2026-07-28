# NavyVault — Rebalancing ERC-4626 Farming Vault

**Date:** 2026-07-28
**Status:** Design approved, pending spec review
**Supersedes (for farming):** `2026-07-11-delegated-farming-signing-design.md`, the farming portions of `2026-07-17-navy-evm-migration-design.md`

## Problem

Today farming is **per-user and single-protocol**. Each user has an isolated, AES-GCM-encrypted **subwallet** (`be/src/wallet`, `be/src/crypto`) that is itself `msg.sender`; a policy-gated `SigningService` supplies that subwallet's USDC to **Compound III (Comet)** only, and a cron scheduler auto-funds + deposits. There is **no rebalancing** — funds sit in one venue and accrue. Adding more venues under the current model means N isolated wallets each paying gas for every move, and no way to shift capital to the best yield.

We want a **pooled ERC-4626 vault** that holds all users' USDC, issues shares, and lets an **off-chain keeper rebalance the whole pool across multiple lending protocols in a single transaction**, choosing allocation by live on-chain APY under hard on-chain safety constraints.

## Protocol landscape (Sepolia, Circle native USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`)

Testnet reality: most lending protocols mint their **own** mock USDC and cannot share liquidity with Circle's native USDC without a swap. Verified findings:

| Protocol | On Sepolia | Accepts our Circle USDC | Verdict |
|---|---|---|---|
| **Compound III (Comet)** `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e` | Yes | Yes (already integrated; `baseToken()` == our USDC) | **Use** |
| **Morpho Blue** core `0xd011EE229E7459ba1ddd22631eF7bF528d424A14` | Yes | Yes — markets are permissionless & token-agnostic; a Circle-USDC market already exists on Sepolia (LTV Finance) | **Use (2nd venue)** |
| Aave v3 Pool `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` | Yes | **No** — uses its own mock USDC (`0x94a9…`); Pool only accepts its registered reserve | Skip (needs swap) |
| Fluid / Euler v2 / Spark / Yearn | No / unknown | No confirmed deploy accepting Circle USDC | Not viable |

**Conclusion:** the vault ships with **two live venues on Sepolia — Compound III and Morpho Blue** — but the adapter interface is N-protocol so more venues drop in without a vault change. The Morpho market for Circle USDC is either the existing permissionless market or one we create via `Morpho.createMarket(...)`; the exact `marketParams` are pinned during implementation and recorded in `contract/DEPLOYMENTS.md`.

Reading APY on-chain:
- **Compound:** `supplyRatePerYear = comet.getSupplyRate(comet.getUtilization()) * SECONDS_PER_YEAR` (rate is per-second, 1e18-scaled).
- **Morpho:** no single `getSupplyRate`. `borrowRate = IRM.borrowRateView(marketParams, market)` (per-second WAD); `supplyRate = borrowRate * utilization * (1 - fee)`; annualize `* SECONDS_PER_YEAR`. Utilization = `totalBorrowAssets / totalSupplyAssets` from `Morpho.market(id)`. **Least-standardized part of the build — requires a Sepolia-fork test.**

## Decisions (locked)

1. **Custody:** pooled ERC-4626. One `NavyVault` holds all USDC; users hold `navUSDC` shares = their proportional slice; the keeper rebalances the whole pool in one tx. The per-user farming subwallet is **removed**.
2. **Gasless entry/exit:** deposits via **relayer + EIP-3009** `ReceiveWithAuthorization` (reuses the payment rails); redemptions via **ERC-2612 permit on the share token** + relayer `redeem`. The end-user (plain EOA, USDC, no ETH) never pays gas.
3. **Rebalance trust:** a **constrained ALLOCATOR** role held by a backend keeper. It can *only* route funds between an owner-managed allowlist of adapters — never withdraw to an arbitrary address, never change the adapter set. `OWNER` (multisig at mainnet) manages adapters/targets. User deposit/redeem always work regardless of keeper state.
4. **Strategy:** **target-weight split with drift band**, gated by hysteresis + cooldown + gas-breakeven + a liquidity buffer, decided off-chain and enforced on-chain. See below.
5. **Replacement scope:** the pooled vault + keeper become the **only** farming custody. Delete the now-dead subwallet / `SigningService` / `PolicyValidator` / `crypto` / delegated-Privy-funding machinery (grep-gated so payments/transfer/agent are untouched).

## Strategy logic

Grounded in how production optimizers work (Yearn v3 debt allocator, Morpho/Gauntlet curation, Aera, Sommelier, Beefy). Universal pattern: **the optimizer is off-chain; the contract enforces only caps + allowlists + loss limits.**

| Knob | MVP value | Basis |
|---|---|---|
| Signal | net **supply APY** per venue, read on-chain each tick | both are USDC lending → comparable risk; raw supply APY ≈ risk-adjusted on testnet |
| Allocation | **target-weight split** across both venues (config `targetBps` per adapter; e.g. weighted toward higher APY, or fixed 50/50), rebalance toward targets on drift | Yearn `targetRatio`/`maxRatio`; diversifies |
| Drift band (hysteresis) | rebalance only if `|currentAlloc − target| > 500 bps` | Yearn `minimumChange` + tolerance-band theory (~20% of weight); tune from observed churn |
| Cooldown | ≥ **6h** between moves of the same capital; cron ticks hourly | Gauntlet ~daily cadence; prevents thrash |
| Gas-breakeven | require `Δapy × movedPrincipal × H > gasCost × safetyFactor` (H = cooldown horizon, safety ≈ 2–3); skip tick if base fee spikes | Beefy/Yield-Yak reward>gas rule, generalized; Yearn `maxAcceptableBaseFee` |
| Liquidity buffer | keep **5–15% idle** in the vault (`minIdle`) so redemptions don't force a same-block venue pull | Yearn `minimum_total_idle` |
| Per-venue cap | `capBps` per adapter enforced on-chain | Morpho supply caps; bounds concentration |

**Honesty note:** the exact `Δapy×P×H > gas×safety` formula and the 500-bps / 6h numbers are synthesized best-practice, not cited standards. They are sound starting points and MUST be tunable via config.

The decision function is a **framework-free plain-TS module** `decideRebalance(aprs, currentAlloc, config)` (like `deriveTxSummary` was), unit-tested independently of chain calls.

## Architecture

```
                    ┌─────────────────────────────────────┐
  User (EOA,        │            NavyVault.sol              │
  USDC, no ETH)     │        (ERC-4626 + ERC20Permit)      │
        │ signs     │  asset = Circle USDC                  │
        │ EIP-3009  │  shares = navUSDC (user holds)        │
        ▼           │  roles: OWNER, ALLOCATOR (keeper)     │
   Relayer ───────► │  depositWithAuthorization()  (gasless)│
   (pays gas)       │  redeem() via ERC20Permit    (gasless)│
                    │  reallocate(from,to,amt) ◄─ ALLOCATOR │
                    │  guardrails: adapter allowlist,       │
                    │   capBps, minIdle, maxLoss            │
                    └───────┬───────────────────┬───────────┘
                            │ IYieldAdapter      │
                   ┌────────▼─────────┐ ┌────────▼─────────┐
                   │ CompoundAdapter  │ │  MorphoAdapter   │
                   │ deposit/withdraw │ │ deposit/withdraw │
                   │ totalAssets      │ │ totalAssets      │
                   │ supplyRatePerYear│ │ supplyRatePerYear│
                   └──────────────────┘ └──────────────────┘
```

### On-chain (`contract/`, new)

- **`NavyVault.sol`** — ERC-4626 over Circle USDC. Shares = `navUSDC` (ERC20 + ERC20Permit, so redemptions are gasless). State: adapter allowlist, `targetBps`/`capBps` per adapter, `minIdle`, `maxLoss`. Roles: `OWNER` (adapters/targets/params), `ALLOCATOR` (rebalance only).
  - `depositWithAuthorization(user, assets, auth, sig)` — same pull-and-act pattern as `NavyPayments.payInvoice`: relayer submits, vault calls `usdc.receiveWithAuthorization(from=user → to=vault)`, mints shares to `user`, emits `Deposit`. Single-use nonce binds it.
  - Standard ERC-4626 `redeem(shares, receiver, owner)` — relayer path uses `navUSDC.permit` then `redeem`. If idle < needed, pulls shortfall from adapters respecting `maxLoss`.
  - `reallocate(fromAdapter, toAdapter, amount)` — `onlyAllocator`; reverts on non-allowlisted adapter, `capBps` breach, or dropping below `minIdle`. Emits `Reallocated`.
  - `addAdapter/removeAdapter/setTargets/setParams` — `onlyOwner`.
  - Hardening: inflation/donation guard (virtual shares / dead-shares on init), reentrancy guards on deposit/redeem/reallocate.
- **`IYieldAdapter.sol`** — `deposit(assets)`, `withdraw(assets, to)`, `totalAssets()`, `supplyRatePerYear()` (1e18-scaled, normalized).
- **`CompoundAdapter.sol`** — approve→`supply`, `withdraw`; `supplyRatePerYear` from Comet as above.
- **`MorphoAdapter.sol`** — supply/withdraw to the Circle-USDC Morpho market; `supplyRatePerYear` computed from the IRM. Pinned `marketParams`.
- Deploy/admin scripts (`script/`), ABI copied to `be/src/evm/` (runtime asset, `require`d).

### Off-chain (`be/`, new `be/src/vault/`)

BFF + keeper (payments/transfer/agent read-paths untouched):
- `GET /vault/deposit-authorization?amount=N` — builds EIP-3009 typed data, persists digest as durable single-use nonce (`VaultDeposit` `pending`).
- `POST /vault/deposit {signature}` — recover signer, assert `signer == req.user.walletAddress`, CAS-consume nonce, relayer submits `depositWithAuthorization`.
- `GET /vault/redeem-permit?shares=S` — ERC-2612 permit typed data for `navUSDC`.
- `POST /vault/redeem {signature}` — relayer calls `navUSDC.permit` then `vault.redeem`.
- `GET /vault/position` — user's shares → assets (via `convertToAssets`) + share of each venue.
- `GET /vault/apys` — per-adapter live APY.
- **`RebalancerService`** (cron, hourly) — reads adapter APYs, runs `decideRebalance`, applies threshold/cooldown/gas-breakeven/`minIdle`, calls `reallocate` from the keeper wallet. Idempotent (reads live allocation each tick). The **contract** is the hard guardrail; the keeper only optimizes.
- **`VaultWatcherService`** — decodes `Deposit`/`Withdraw`/`Reallocated`, reconciles DB; `recoverConsumedDeposits` sweep mirrors `ChainWatcherService.recoverConsumedOrders` for crash recovery.
- `NAVY_VAULT_ADDRESS`, `NAVY_KEEPER_PRIVATE_KEY` (or reuse owner), strategy config (`targetBps`, drift band, cooldown, safety factor, `minIdle`) via env.

### Data model (Prisma)

New:
- `VaultDeposit { id, userId, amountBase(BigInt), nonceDigest, status(pending|settled|failed), txHash, createdAt }`
- `VaultRedeem { id, userId, sharesBase(BigInt), txHash, status, createdAt }`
- `RebalanceEvent { id, fromAdapter, toAdapter, amountBase(BigInt), aprFrom, aprTo, txHash, createdAt }`

Removed: `FarmingSubwallet`, `FarmingEvent`.

(Money columns are `BigInt`; serialize to string before returning from Nest.)

### Surfaces

- **AI assistant:** repoint `build_farming_deposit` / `build_farming_withdraw` to the vault (deposit/redeem proposals); `get_farming_summary` returns the share position + live APYs. Read/propose-only contract unchanged.
- **expo-wallet / fe:** the farming screens call the new `/vault/*` endpoints; deposit/redeem sign EIP-3009 / permit typed data. (Detailed UI in the implementation plan.)

## Data flow

**Deposit:** `GET /vault/deposit-authorization` → user signs EIP-3009 (no gas) → `POST /vault/deposit {signature}` → recover + assert + CAS nonce → relayer `depositWithAuthorization` → vault pulls USDC, mints shares → `VaultWatcher` settles. Idle USDC waits for the next rebalance tick.

**Withdraw:** `GET /vault/redeem-permit` → user signs permit (no gas) → `POST /vault/redeem {signature}` → relayer `permit`+`redeem` → vault pulls shortfall from adapters if needed (respecting `maxLoss`), burns shares, sends USDC.

**Rebalance (hourly):** read APYs → `decideRebalance` → if drift>band AND cooldown passed AND gas-breakeven ok AND base fee under ceiling → `reallocate`. Contract enforces allowlist/cap/minIdle. Redeem/deposit never gated by the keeper.

## Error handling / self-healing

- Deposit relay reverts → `VaultDeposit` `failed`, nonce released, user retries.
- Keeper reallocate reverts → logged, no state change, retried next tick (idempotent).
- Crash between nonce-consume and confirm → `recoverConsumedDeposits` reconciles from on-chain share balance / events.
- Redemption when idle insufficient → vault pulls from adapters within `maxLoss`; if a venue is illiquid the redeem reverts rather than realizing a large loss (user retries a smaller amount or after the next rebalance restores idle).

## Security

- `reallocate` `onlyAllocator`, allowlisted-adapter-only, cannot send to an EOA, reverts on `capBps`/`minIdle` breach — the **contract replaces the off-chain `PolicyValidator`** for farming.
- `addAdapter/removeAdapter/setTargets/setParams` `onlyOwner`; owner→multisig is the mainnet gate.
- Keeper key is hot but **bounded**: worst case churns allocation between two safe venues; cannot exfiltrate funds. Stronger than today's decrypt-in-memory subwallet keys.
- ERC-4626 inflation/donation guard; reentrancy guards.
- Deposit fully bound by EIP-3009 (wrong amount/payer/expiry → USDC's own EIP-712 verification reverts), same as payments.

## Testing

- **Foundry:** unit + fuzz on share math; invariants for `capBps`/`minIdle`/`maxLoss`; `reallocate` access control; EIP-3009 deposit binding; inflation-attack test; **Sepolia-fork tests against real Comet + Morpho**.
- **be:** unit tests for `decideRebalance` (framework-free), gas-breakeven math, watcher reconciliation.
- **Live proof:** `be/scripts/vault-e2e.mjs` — deposit → rebalance → redeem on Sepolia against the deployed vault + funded relayer/keeper.

## Removal (grep-gated)

Delete after confirming no non-farming consumer imports them:
- `be/src/wallet/*` (subwallet, signing, policy.validator, tx-summary, delegated-policy.validator)
- old `be/src/farming/*` (compound-yield-adapter, yield-adapter, delegation.service, delegated-funding.service, funding.util, scheduler, farming.bounds)
- `be/src/crypto/*` (only if solely used by subwallets)
- delegated-Privy funding wiring
- Prisma `FarmingSubwallet`, `FarmingEvent` (migration)

Payments (`be/src/payments`, `be/src/evm`), transfer (`be/src/transfer`), auth, products, and the AI assistant read-paths are untouched.

## Out of scope / mainnet gates

- KMS/HSM for the keeper key, owner→multisig, professional audit, ERC-4337 paymaster (deposit relay stays relayer-pays-gas on testnet) — per `docs/PRODUCTION.md`.
- Risk-adjusted APY discounting per venue (testnet uses raw supply APY).
- Additional venues beyond Compound/Morpho (adapter interface supports them; none else viable on Sepolia today).

## Open items to pin during implementation

1. Exact Morpho Sepolia `marketParams` for the Circle-USDC market (reuse existing vs `createMarket`); record in `contract/DEPLOYMENTS.md`.
2. Whether the keeper reuses `NAVY_OWNER_PRIVATE_KEY` or a dedicated `NAVY_KEEPER_PRIVATE_KEY` (recommend dedicated, smaller blast radius).
3. Initial `targetBps` policy (fixed 50/50 vs APY-weighted) and the concrete drift-band / cooldown / safety-factor defaults.
