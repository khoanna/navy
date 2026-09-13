# P37 contract change record — deposit cap

**Branch:** `feat/srcla-p37-deposit-cap`
**Scope:** `contract/src/NavyVaultSRCLA.sol`, `contract/src/interfaces/IVaultEvents.sol`,
`contract/script/DeployBaseSystem.s.sol`, `contract/script/VerifyBaseSystem.s.sol`,
`contract/script/ReleaseScope.sol`
**Spec:** `docs/superpowers/specs/2026-09-13-srcla-p37-release-gates-design.md` (G5, "Contract — deposit cap")
**Plan:** `docs/superpowers/plans/2026-09-13-srcla-p37-track3-deposit-cap.md`
**Audit status:** `audit/AUDIT-REPORT.md` describes pre-Phase-2 bytecode and
`audit/2026-09-07-phase2-changes.md` the Phase 2 delta. This file is the P37 delta on top of both.

**No redeploy has occurred.**

---

## Read this first

1. **New admin power.** `ADMIN_ROLE` can close deposits and mints at any time by setting
   `depositCap` at or below `totalAssets()`. It cannot affect `withdraw`/`redeem`, share
   price, or allocation.
2. **ERC-4626 limits are now finite when capped.** `maxDeposit` returns the room below the
   cap and `maxMint` its share equivalent (`convertToShares`, rounded down). Integrators
   that assumed `type(uint256).max` see a real limit on the mainnet vault. OpenZeppelin
   5.1.0's `deposit`/`mint` revert `ERC4626ExceededMaxDeposit`/`ERC4626ExceededMaxMint`
   above it.
3. **An uncapped vault returns exactly the values it returned before.** The default
   `type(uint256).max` is a sentinel: `maxDeposit`/`maxMint` return `type(uint256).max`
   unchanged rather than `type(uint256).max - totalAssets()`, which also keeps `maxMint`
   from overflowing `mulDiv`.
4. **Accepted EIP-4626 deviation: cached-NAV views vs. synced writes.** With a finite cap,
   `maxDeposit`/`maxMint` compute room from the vault's cached NAV (`strategyAssets`), like
   `previewMint`/`maxWithdraw` already did, while `deposit`/`mint` re-sync every adapter
   first. So the advertised room can exceed what the call actually accepts by adapter
   interest accrued since the last sync, and a caller depositing exactly `maxDeposit()`
   near the cap can revert. The cap itself is always enforced against the synced NAV —
   nothing ever gets in past it. Pinned by
   `test_staleAdapterCacheOverstatesRoomButTheCapHolds`.
5. **Donation and front-running.** Room is measured against `totalAssets()`, so a donation
   or a competing deposit can close it first. The attacker loses the donation. Deposits
   near the cap should not assume the room persists.
6. **Near-max caps.** `type(uint256).max` is the only uncapped value, and a finite cap set
   close to it can overflow `maxMint`'s `convertToShares` conversion. This is admin
   misconfiguration, documented in `setDepositCap`'s NatSpec.

## Change index

| # | Change | Commit | Spec | Contract |
|---|---|---|---|---|
| 1 | `depositCap` slot, `setDepositCap`, `DepositCapSet`, capped `maxDeposit`/`maxMint` | `f8e4a252` | G5 | `NavyVaultSRCLA`, `IVaultEvents` |
| 2 | Cached-NAV view NatSpec, early return for zero room in `maxMint`, stale-cache/zero-cap/authorisation edge-case tests (fix round 1) | `9cfd9511` | G5 | `NavyVaultSRCLA` |
| 3 | Invariant: deposits and mints never breach the cap | `e15a0acf` | G5 | tests only |
| 4 | Mainnet package sets `1_000_000e6`; verifier checks it | `76873052` | G5 | `DeployBaseSystem.s.sol`, `VerifyBaseSystem.s.sol`, `ReleaseScope.sol` |

## Storage and gas

- One new storage slot, declared after `paused` (`src/NavyVaultSRCLA.sol:111,117`; nothing
  between them but the getter's NatSpec). The vault is deployed directly (no proxy), so
  there is no layout-compatibility constraint.

Measured as `gasleft()` deltas around each call, using a temporary probe
(`test/gas/DepositCapGasProbe.t.sol`, run via
`forge test --match-path test/gas/DepositCapGasProbe.t.sol -vv` and not committed — see
below) that follows `test/gas/VaultGas.t.sol`'s setup at 0 and 3 registered adapters, for
an uncapped vault and one capped well above its NAV (`type(uint256).max / 2`):

| Function | 0 adapters, uncapped | 0 adapters, capped | 3 adapters, uncapped | 3 adapters, capped |
|---|---|---|---|---|
| `deposit` | 36,651 | 37,972 | 82,139 | 86,324 |
| `mint` | 66,545 | 69,722 | 87,743 | 96,660 |
| `maxDeposit` | 14,674 | 22,495 | 14,656 | 49,354 |
| `maxMint` | 15,856 | 27,533 | 15,838 | 57,257 |

A capped `mint` pays two `totalAssets()` loops (`maxDeposit`, then `convertToShares`) where
an uncapped `mint` pays none — visible in `maxMint`'s jump over `maxDeposit`'s own increase
at both adapter counts, and in `mint`'s smaller but consistent increase over its uncapped
baseline.

## What the auditor should check

- `maxMint` never admits more assets than `maxDeposit` (`testFuzz_maxMintNeverAdmitsMoreAssetsThanMaxDeposit`).
- No sequence of deposits and mints carries `totalAssets()` past the cap except accrued
  yield (`DepositCapInvariantTest`).
- The zero cases (`paused`, `_syncUnauthorised`, `_cacheStale`) still take precedence.
- `setDepositCap` is `onlyRole(ADMIN_ROLE)`; no path lets `ALLOCATOR_ROLE` set it.
- The stale cached-NAV view is bounded, not exploitable:
  `test_staleAdapterCacheOverstatesRoomButTheCapHolds`.
- The cap can be closed to zero and reopened cleanly: `test_zeroCapClosesDepositsAndMints`.
- The mainnet release scope is exactly $1,000,000: `testReleaseScopeIsOneMillionUsdc`.
