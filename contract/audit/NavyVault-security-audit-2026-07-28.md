# NavyVault — Security Audit Report

**Target:** `contract/src/NavyVault.sol` (pooled ERC-4626 farming vault over Circle Sepolia USDC) and its yield adapters `CompoundAdapter.sol`, `MorphoAdapter.sol`, interfaces, and `DeployVault.s.sol`.
**Commit audited:** branch `feat/navy-vault-rebalancing`, pre-fix `0db67e4`; post-fix HEAD includes `d4245c9`, `5730084`, `5a708f9`.
**Date:** 2026-07-28
**Auditors:** internal multi-agent review — one attack-research pass + six specialized auditors (inflation/rounding, reentrancy/spec, access/custody, adapter integration, arithmetic/DoS, EIP-3009/signatures) + an independent fix-verification pass.
**Verdict:** No Critical findings. The core custody invariant (a keeper/allocator can never route funds to an arbitrary address) and the EIP-3009 deposit binding are correct. All High and actionable Medium findings have been **fixed and re-verified** (68 tests pass, `CompoundAdapter` verified live on Sepolia). Remaining items are centralization/ops decisions and a live-verification gate for `MorphoAdapter`, documented below.

> This vault holds pooled user funds. This report is an internal engineering audit, **not** a substitute for a professional third-party audit, which remains a mainnet gate (see `docs/PRODUCTION.md`).

---

## 1. Methodology

The review was grounded in the real history of ERC-4626 / lending-vault exploits and the standard audit checklists (Trail of Bits `crytic/properties`, OpenZeppelin ERC-4626 guidance, a16z `erc4626-tests`, Consensys best-practices, Code4rena/Spearbit common findings, SCSVS). Attack classes and named incidents used as pattern-match references: Sonne Finance / Hundred / Onyx (empty-market donation), Euler (missing-invariant self-liquidation), Harvest & Value DeFi & Elephant (share-price / oracle manipulation), Cream & Rari-Fei & Conic & Sentiment & Visor (classic / cross-function / read-only reentrancy), Beanstalk (flash-loan governance), Pickle (unallowlisted strategy). Full reference set in §9.

Each dimension was audited against the actual code (not the spec), findings were adversarially triaged for exploitability, fixes were implemented via TDD, and an independent verifier confirmed the fixes are correct and regression-free.

## 2. Severity definitions

| Severity | Meaning |
|---|---|
| Critical | Direct, unprivileged theft or permanent loss of user funds. |
| High | Fund loss/freeze under realistic conditions, or requiring a privileged-but-plausible trigger; pool-wide liveness DoS. |
| Medium | Conditional loss, silent accounting corruption, or a meaningful safety gap. |
| Low | Limited impact, requires unlikely conditions, or defense-in-depth. |
| Informational | No direct security impact; hygiene / documentation. |

## 3. Findings summary

| ID | Title | Severity | Status |
|---|---|---|---|
| H-01 | One reverting adapter bricks `totalAssets()` → all deposits/NAV, and adapter is unremovable | High | **Fixed** (A1/A2/A6) |
| H-02 | `maxLossBps=0` default + protocol floor-rounding can brick divest/redeem (`LossTooHigh`) | High | **Fixed** (A4/A5) |
| H-03 | Withdrawal illiquidity (Comet 100% utilization / Morpho no-cash) DoSes the shared redemption path | High | **Partially mitigated** (A6) + documented (§6.1) |
| M-01 | Owner centralization: no 2-step ownership, no pause, no exit window | Medium | **Partially fixed** (B2/B3); timelock documented (§6.2) |
| M-02 | `MorphoAdapter` constructor doesn't validate `loanToken==USDC` / `id==id(params)` → silent NAV corruption | Medium | **Fixed** (C) |
| M-03 | Empty-vault donation griefing: sub-threshold deposits mint 0 shares, taking victim USDC | Medium | **Fixed** (B1) + deploy seed recommended (§6.3) |
| M-04 | `maxWithdraw`/`maxRedeem` overstate withdrawable vs adapter illiquidity (ERC-4626 conformance) | Medium | **Documented** (§6.4) |
| M-05 | `MorphoAdapter` share/rate math unverified on-chain (no resolved market) | Medium | **Documented** — live-fork gate (§6.5) |
| L-01 | Uncapped `adapters[]` array (O(n) `totalAssets` in every deposit/redeem) | Low | **Fixed** (A3, `MAX_ADAPTERS=10`) |
| L-02 | `reallocate` / standard `deposit`/`mint` not reentrancy-guarded (defense-in-depth) | Low | **Fixed** (B4/B5) |
| L-03 | Bps loss tolerance is dimensionally wrong (floors to 0 for small pulls) vs fixed protocol dust | Low | **Fixed** (A4, absolute `LOSS_DUST`) |
| L-04 | Morpho `totalAssets` uses stored (un-accrued) totals → slightly understates position | Low | **Documented** (§6.6, conservative) |
| L-05 | `_ensureIdle` under-delivery surfaces as an opaque ERC-20 revert | Low | **Mitigated** (A6 try/catch) + documented |
| I-01 | Bare `approve`/`transfer` on USDC (no SafeERC20) | Informational | **Intentional** — matches `NavyPayments` convention (§6.7) |
| I-02 | Relayer is a liveness/censorship trust assumption for deposits | Informational | **Documented** (accepted) |
| I-03 | Deposit share-price subject to relayer/block ordering (no theft) | Informational | **Documented** (accepted) |

---

## 4. Detailed findings

### H-01 — One reverting adapter bricks the entire vault *(Fixed)*

**Before:** `totalAssets()` summed `IYieldAdapter(adapters[i]).totalAssets()` across all adapters with no error isolation. If a single adapter's `totalAssets()` reverted (underlying market paused/deprecated, adapter self-destructed, gas-heavy), then `previewDeposit` (every `depositWithAuthorization`), NAV reads, and `convertTo*` all reverted — **all deposits and NAV bricked pool-wide**. Worse, `removeAdapter` itself called `totalAssets()` for its emptiness check, so the broken adapter could **never be removed** → permanent brick. Parallel: the class of "one bad market bricks the vault" liveness failures; aggravated by the unbounded array (L-01).

**Fix (`d4245c9`):** `totalAssets()` wraps each adapter call in `try/catch`, contributing `0` on revert (conservative — understates NAV, never overstates). `_ensureIdle` (redemption liquidity pull) likewise `try/catch`es both the per-adapter `totalAssets()` read and the `withdraw` call, skipping a bad adapter. Added `forceRemoveAdapter(address)` (owner-only) that excises an adapter unconditionally via the shared internal `_removeAdapter`, so a bricked adapter can always be written off. `NavyVault.sol` `totalAssets`, `_ensureIdle`, `removeAdapter`, `forceRemoveAdapter`, `_removeAdapter`. Tests: `test_totalAssets_survivesRevertingAdapter`, `test_deposit_notBrickedByRevertingAdapter`, `test_forceRemoveAdapter_removesRevertingAdapter`.

**Verifier note:** treating a revert as `0` is only reachable via an owner-added adapter bricking (adding adapters is `onlyOwner`), so it is not an attacker-injectable share-mispricing vector; `_ensureIdle` skip is revert-safe (never over-sends — the final `super._withdraw` transfer reverts safely if idle is insufficient).

### H-02 — `maxLossBps=0` default + protocol floor rounding can brick divest/redeem *(Fixed)*

**Before:** The loss guard `received + (amount * maxLossBps)/10000 < amount` reverted `LossTooHigh` on any shortfall when `maxLossBps==0` (its storage default until `setParams` is called). Because bps of a small amount floors to `0`, the tolerance was `0` even for modest `maxLossBps`. Live Compound III credits `principal×index` and **floors ~2 base units** on supply (confirmed on Sepolia). A divest/redeem that pulls from a Comet position could therefore trip `LossTooHigh` (or under-deliver, causing an opaque downstream ERC-20 revert), bricking redemptions of deployed funds until the owner set a non-zero `maxLossBps`. A bps bound is dimensionally wrong for a **fixed-unit** protocol floor.

**Fix (`d4245c9`):** Introduced an absolute dust tolerance `LOSS_DUST = 10` base units (1e-5 USDC) and `_allowedLoss(amount) = max(LOSS_DUST, amount*maxLossBps/10000)`; both guard sites now use the underflow-safe `amount > received && amount - received > _allowedLoss(amount)`. Constructor now sets `maxLossBps = 50` (0.5%) so a freshly deployed vault is never in the zero-tolerance footgun. Test: `test_withdrawFromAdapter_toleratesDust` (2-unit withhold passes at `maxLossBps=0`; 100-unit still reverts).

**Verifier note:** the ≤10-unit tolerance is not a siphon vector — divest destinations are hardcoded to `address(this)` (the vault), so any dust left behind stays in the pool and can never reach the allocator/an EOA; economically negligible ($0.00001, dwarfed by gas).

### H-03 — Withdrawal illiquidity DoS *(Partially mitigated + documented)*

If a venue is fully utilized (Comet has no cash; Morpho market `totalSupply−totalBorrow < amount`), the adapter `withdraw` reverts. **Fixed portion:** after A6, a reverting adapter is skipped by `_ensureIdle` instead of bricking the whole redemption; the redeem then either services from other adapters/idle or reverts safely (user retries later) — one illiquid venue no longer bricks the others. **Residual (documented, §6.1):** there is still no *partial* "withdraw what's liquid" from a partially-liquid venue (the whole `pull` is attempted and, if it reverts, that venue is skipped entirely). True partial-withdraw is a Plan-2/mainnet enhancement. Parallel: Compound-style utilization-DoS on redemptions.

### M-01 — Owner centralization *(Partially fixed; timelock documented)*

The owner can drain the pool by adding a hostile adapter (`addAdapter` → `deployToAdapter`) or by `setParams(0,·)`; there was no ownership rotation, no pause, and no user exit window. This is inherent centralization, acceptable only under a hardened multisig. **Fixed:** added **2-step ownership** (`transferOwnership`/`acceptOwnership`, `pendingOwner`) for safe key rotation, and an **emergency pause** (`setPaused`) that blocks new risk (`depositWithAuthorization`, `deployToAdapter`, standard `deposit`/`mint`) while **always leaving user exits (`redeem`/`withdraw`) and divestment open**. **Documented (§6.2):** a timelock on `addAdapter`/`setParams` (so permissionless `redeem` gives users an exit window before a new adapter can receive funds) and owner→multisig remain mainnet gates. Tests: `test_transferOwnership_twoStep`, `test_acceptOwnership_onlyPending`, `test_setPaused_blocksDepositAndDeploy_allowsRedeem`.

### M-02 — `MorphoAdapter` unvalidated market wiring *(Fixed)*

**Before:** the constructor accepted `MarketParams` + `bytes32 id` with no check that `loanToken == USDC` or that `id` matched the params. A mismatched `id` makes `totalAssets()`/`supplyRatePerYear()` read a *different* market than `deposit()` supplies to → silent pool-wide NAV corruption. **Fix (`5a708f9`):** constructor reverts `LoanTokenMismatch` if `_params.loanToken != _usdc`, and `MarketIdMismatch` if `keccak256(abi.encode(_params)) != _id` — verified byte-equivalent to Morpho's `MarketParamsLib.id` (160-byte packed keccak). Tests: `MorphoAdapterConstructorTest` (3 cases).

### M-03 — Empty-vault donation griefing *(Fixed)*

`totalAssets()` includes raw `IERC20(asset()).balanceOf(this)`, so anyone can `transfer` USDC directly to the vault to inflate it without minting shares. With OZ virtual shares + `_decimalsOffset()==6`, the **profitable** inflation attack is fully neutralized (PoC: attacker nets −49,999.98 USDC on a 100k donation). The residual was **grief-only**: into an *empty* vault, a donation `D` makes any deposit `< D/1e6` USDC mint **0 shares**, silently taking the victim's USDC. **Fix (`5730084`):** `depositWithAuthorization` reverts `ZeroShares` when `previewDeposit(assets)==0` — **before** the USDC pull — converting silent fund-loss into a safe revert. **Recommended deploy step (§6.3):** seed a small first deposit to a burn address so `totalSupply` is never 0. Test: `test_depositWithAuthorization_revertsOnZeroShares`.

### M-04 — `maxWithdraw`/`maxRedeem` overstate withdrawable *(Documented)*

The vault does not override `maxWithdraw`/`maxRedeem`, so they return the holder's full balance even when adapters are illiquid and a `redeem` would revert — an ERC-4626 spec deviation that can surprise integrators. Not fixed in-code because an on-chain "liquid capacity" calculation across Comet/Morpho is error-prone and a *wrong* `maxRedeem` is worse than a documented deviation. See §6.4.

### M-05 — `MorphoAdapter` math unverified on-chain *(Documented — live gate)*

`CompoundAdapter` is verified live against real Sepolia Comet. `MorphoAdapter`'s `totalAssets` (`toAssetsDown` with virtual `1`/`1e6` — statically verified to match `SharesMathLib`) and `supplyRatePerYear` (`borrowRate×util×(1−fee)`, units verified) have **never executed on-chain** (no resolved Circle-USDC market). Do not register `MorphoAdapter` on a fund-holding vault before a Sepolia fork test passes. See §6.5.

### Low / Informational (summary)

- **L-01 Fixed** — `MAX_ADAPTERS = 10` cap in `addAdapter` bounds the `totalAssets` loop.
- **L-02 Fixed** — `reallocate` is now `nonReentrant` (via an internal-helper refactor to avoid nested-guard deadlock); standard `deposit`/`mint` overridden with `nonReentrant whenNotPaused`.
- **L-03 Fixed** — absolute `LOSS_DUST` (see H-02).
- **L-04 Documented** — Morpho stored-totals staleness is conservative (understates, never over) and self-heals on any market interaction (§6.6).
- **L-05 Mitigated** — `_ensureIdle` try/catch; a genuine shortfall still surfaces as a safe transfer revert.
- **I-01 Intentional** — bare USDC `transfer`/`approve` matches the documented `NavyPayments` convention (§6.7).
- **I-02 / I-03 Accepted** — relayer liveness/censorship and deposit ordering are inherent to the gasless-relayer design; no theft path (EIP-3009 binds payer==signer and value).

---

## 5. Fixes applied (commits)

- **`d4245c9` — Batch A (DoS/liveness):** adapter-revert isolation in `totalAssets`/`_ensureIdle`; `forceRemoveAdapter` + robust `removeAdapter`; `MAX_ADAPTERS=10`; absolute-dust loss guard `_allowedLoss`; `maxLossBps=50` default. +5 tests.
- **`5730084` — Batch B (deposit/access):** `ZeroShares` revert; 2-step ownership; emergency pause (exits always open); `reallocate`/`deposit`/`mint` reentrancy guards via internal-helper refactor. +5 tests.
- **`5a708f9` — Batch C (adapter wiring):** `MorphoAdapter` constructor validates `loanToken==USDC` and `id==id(params)`. +3 tests.
- Independent verification pass: **APPROVE** — fixes correct, custody invariant preserved, no regressions. Full suite: **68 passed / 1 intentional skip**; `CompoundAdapter` fork tests pass live.

---

## 6. Remaining items (documented — decisions / mainnet gates)

**6.1 Partial "withdraw-what's-liquid".** For a partially-liquid venue, add a liquidity-aware partial withdraw in each adapter (Comet: `min(amount, USDC.balanceOf(comet))`; Morpho: `min(amount, totalSupplyAssets−totalBorrowAssets)`) returning the actual amount, and let `_ensureIdle` continue for the shortfall. Current mitigation (skip the reverting venue) prevents cross-venue bricking but not intra-venue partial service. Plan-2/mainnet.

**6.2 Timelock + multisig.** Timelock `addAdapter`/`setParams` (24–48h) to give users a permissionless-redeem exit window; enforce owner = multisig at mainnet. Tracked in `docs/PRODUCTION.md`.

**6.3 Seed/dead shares on deploy.** After deploy, have the deployer make a small first deposit to a burn address so `totalSupply` is never 0 (belt-and-suspenders atop the `ZeroShares` revert). Add to the deploy runbook.

**6.4 `maxWithdraw`/`maxRedeem` conformance.** Either override to cap at currently-liquid capacity, or document the deviation for integrators. Deferred to avoid shipping a wrong liquidity calc.

**6.5 `MorphoAdapter` live-fork verification (blocking before registration).** Resolve the Sepolia Circle-USDC Morpho market, run `MorphoAdapterForkTest` against a real RPC (public RPCs are flaky — use Alchemy/Infura), reconcile `totalAssets()` vs `MorphoBalancesLib.expectedSupplyAssets` after time elapses. Tracked in `contract/DEPLOYMENTS.md`.

**6.6 Morpho accrual staleness.** Optionally replicate `expectedMarketBalances` accrual inside `MorphoAdapter.totalAssets()` for symmetry with `CompoundAdapter` (whose `comet.balanceOf` internally accrues). Current behavior is conservative and self-healing.

**6.7 SafeERC20 — intentionally not adopted.** The money layer uses bare `transfer`/`approve` on Circle USDC (which reverts on failure and whose `approve` unconditionally overwrites), matching `NavyPayments`. The vault asset is fixed to Circle USDC at construction. Recorded so it is not "fixed" into an inconsistency later.

---

## 7. Verified-safe (audited and found not vulnerable)

- **Custody invariant (Critical, disproven):** every USDC-moving path routes only to (a) an owner-allowlisted adapter, (b) `address(this)`, or (c) a redeeming shareholder via share burn. There is **no caller-controlled destination** anywhere in the allocator surface (`withdrawFromAdapter`/`_ensureIdle` hardcode `address(this)`; `deployToAdapter` derives the target from the allowlisted adapter). The allocator **cannot exfiltrate to an arbitrary address** — confirmed pre- and post-refactor.
- **EIP-3009 deposit binding:** the vault passes `user` as both the `receiveWithAuthorization` `from` and the `_mint` recipient; Circle USDC binds `from == signer` and `value == assets` in its EIP-712 verification, so a malicious relayer **cannot misdirect shares to a non-signer nor mint more shares than USDC pulled**. Replay, expiry, malleability, and cross-chain domain are correctly delegated to the token; the vault adds `nonReentrant`.
- **Inflation attack (profit form):** neutralized by `_decimalsOffset()==6` + virtual shares (attacker strictly loses in every PoC).
- **Rounding:** all four ERC-4626 paths round in the vault's favor (deposit/redeem floor, withdraw/mint ceil); no mint↔redeem siphon (roundtrip loses ≤1 unit to the vault).
- **Reentrancy:** no exploitable classic/cross-function/read-only reentrancy — USDC has no transfer hook, Comet/Morpho do not call back (Morpho `data=""`), adapters are owner-allowlisted; all state-changers are guarded (post-fix, including `reallocate`/`deposit`/`mint`).
- **Arithmetic:** no overflow (solc 0.8.24 checked; widening `uint128→uint256` casts; `mulDiv` 512-bit); rate scaling correct (1e18 APR); cap/idle bps math conservative and non-bypassable; Morpho `toAssetsDown` matches `SharesMathLib` exactly.
- **Interface ABI:** `IComet`/`IMorpho` selectors and struct layouts match the real contracts (`Id ≡ bytes32` selector-equivalent).
- **Deposit share pricing:** `previewDeposit` computed on pre-deposit state (before the pull); consistent under `nonReentrant`.

---

## 8. ERC-4626 audit checklist verification

| # | Checklist item | Result |
|---|---|---|
| A | Inflation defense (virtual shares / offset) | ✅ `_decimalsOffset()==6`; profit-form neutralized; `ZeroShares` revert closes empty-vault griefing; seed-shares recommended (§6.3) |
| B | Rounding against the user / for the vault (all 4 paths) | ✅ verified |
| C | `previewX` == executing function | ✅ `depositWithAuthorization` uses `previewDeposit` (floor) |
| D | Reentrancy (classic/cross-fn/read-only) | ✅ guarded; read-only not reachable (no callback surface) |
| E | External accrual/consistency (Comet/Morpho) | ✅ Comet `balanceOf` accrues; ⚠️ Morpho stored-totals conservative (§6.6) |
| F | Withdrawal illiquidity handled | ⚠️ cross-venue brick fixed (A6); intra-venue partial withdraw = §6.1 |
| G | Target market allowlisted / validated | ✅ `MorphoAdapter` validates `loanToken`/`id` (M-02) |
| H | Access control / least privilege / 2-step owner | ✅ allocator sandboxed; 2-step ownership; ⚠️ timelock = §6.2 |
| I | Solvency invariant preserved by every state-changer | ✅ no mint-without-assets / drop-without-burn |
| J | Rebalance permissioned & bounded | ✅ `onlyAllocator`, cap/minIdle/maxLoss on-chain |
| K | Emergency pause / exit always open | ✅ pause blocks entry, never exits |
| L | Permit/meta-tx binding, replay, front-run | ✅ EIP-3009 `receiveWithAuthorization` (`msg.sender==to`) + `onlyRelayer`; token nonce replay |
| M | No unbounded loops / DoS | ✅ `MAX_ADAPTERS=10`; adapter-revert isolation |
| N | No AMM-spot/manipulable oracle for share price | ✅ share price from lending balances, not spot |
| O | maxWithdraw/maxRedeem accuracy | ⚠️ documented deviation (§6.4) |
| P | Events emitted with correct amounts | ✅ `Deposit`/`Reallocated`/`Deployed`/`Divested` |
| Q | Fuzz/property tests | ✅ roundtrip no-profit fuzz; ⚠️ add donation-interleaving fuzz (nice-to-have) |

Legend: ✅ satisfied · ⚠️ satisfied with a documented follow-up.

## 9. Historical attack pattern-match

| Class / incident | Applies here? | Mitigation in NavyVault |
|---|---|---|
| Empty-market donation (Sonne/Hundred/Onyx) | Partially | offset-6 (profit) + `ZeroShares` (grief) + seed-shares (§6.3) |
| Share-price / oracle manipulation (Harvest, Value DeFi, Elephant) | No | share price from lending balances, not AMM spot; donations unprofitable |
| Missing-invariant self-liquidation (Euler) | No | every state-changer preserves solvency; no donate-to-reserves-style hole |
| Reentrancy incl. read-only (Cream, Rari-Fei, Conic, Sentiment, Visor) | No | no callback surface; all state-changers guarded |
| Flash-loan governance (Beanstalk) | No | no on-chain token governance |
| Unallowlisted strategy (Pickle) | Guarded | adapters `onlyOwner`-allowlisted; `MorphoAdapter` self-validates its market |
| Key compromise (bZx) | Residual | 2-step ownership + pause; multisig/timelock = mainnet gate |

Sources: OpenZeppelin ERC-4626 docs & "Novel Defense"; Trail of Bits `crytic/properties`; a16z `erc4626-tests`; post-mortems for Sonne (Verichains/Halborn), Euler (Omniscia), Harvest, Cream, Rari-Fei (CertiK), Conic (Neptune), Beanstalk (Veridise), Pickle (rekt); Compound III & Morpho Blue docs.

## 10. Test coverage

- **68 passing / 1 intentional skip** across unit, fuzz, and live-fork suites.
- `NavyVaultTest` (27): roles, adapter mgmt, gasless deposit + zero-share revert, allocator deploy/divest/reallocate with cap/buffer/loss guards, adapter-revert isolation, force-remove, adapter cap, dust tolerance, 2-step ownership, pause, redemption liquidity pull.
- `NavyVaultFuzzTest` (2): deposit↔redeem no-profit roundtrip (idle + deployed states).
- `MorphoAdapterConstructorTest` (3): market-wiring validation.
- `CompoundAdapterForkTest` (2): **live** Sepolia supply/withdraw/APR.
- `MorphoAdapterForkTest`: no-ops until a market is resolved (§6.5).

## 11. Conclusion

The NavyVault contract layer is well-structured and its two most important properties — **the allocator cannot steal, and the gasless deposit correctly binds payer to shares** — are sound. The audit surfaced two genuine High-severity **liveness/DoS** issues (adapter-revert bricking, floor-rounding loss-guard bricking) and several Medium issues (owner centralization, Morpho wiring validation, donation griefing), all of which have been fixed and independently re-verified, plus documented follow-ups that are ops/design decisions or a live-verification gate for `MorphoAdapter`. Before this vault custodies real user funds on mainnet, complete the gates in §6 (professional third-party audit, timelock + multisig, `MorphoAdapter` live-fork verification, and the partial-withdraw enhancement) per `docs/PRODUCTION.md`.
