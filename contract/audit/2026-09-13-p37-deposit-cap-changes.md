# P37 contract change record — deposit cap

**Branch:** `feat/srcla-p37-deposit-cap`
**Scope:** `contract/src/NavyVaultSRCLA.sol`, `contract/src/interfaces/IVaultEvents.sol`,
`contract/script/DeployBaseSystem.s.sol`, `contract/script/VerifyBaseSystem.s.sol`,
`contract/script/ReleaseScope.sol`
**Spec:** the P37 release-gates design (G5, "Contract — deposit cap") — a local-only design document, not in the repository
**Plan:** the Track 3 deposit-cap implementation plan — a local-only design document, not in the repository
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
   `maxDeposit`/`maxMint` compute room from the vault's cached NAV — cached adapter values
   (`strategyAssets`) AND the reward accountant's cached reward NAV
   (`cachedRewardAssets()`) — like `previewMint`/`maxWithdraw` already did, while
   `deposit`/`mint` refresh both in the same transaction before the max check:
   `_syncAllStrategies()`, then `syncForShareAction(true)`, whose lazy refresh can raise
   `cachedRewardAssets()`. So the advertised room can differ from what the call actually
   accepts in either direction — not only shrink: adapter interest accrued since the last
   sync can make a caller depositing exactly `maxDeposit()` near the cap revert, while a
   reward-cache refresh inside the same transaction can raise NAV and therefore shrink room
   further, or (if a previously-invalid feed clears) restore value the cached view had
   discounted. Reward NAV on Base is currently a measured zero, so this has no practical
   effect today. The cap itself is always enforced against the refreshed, synced NAV —
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
| 5 | `DeployBaseSystem.s.sol` pins Moonwell mUSDC's current interest-rate model (the stale value made `MoonwellAdapter`'s constructor revert); re-read before any real deploy | `20fa3c6c` | — | `DeployBaseSystem.s.sol` |

## Storage and gas

- One new storage slot, declared after `paused` (`src/NavyVaultSRCLA.sol:111,117`; nothing
  between them but the getter's NatSpec). The vault is deployed directly (no proxy), so
  there is no layout-compatibility constraint.
- **Runtime bytecode size (EIP-170).** `forge build --sizes` on `NavyVaultSRCLA`: 32,378
  bytes at base (`23715ccb`, measured via a `git archive` scratch export since the working
  tree cannot be checked out to another commit) and 32,584 bytes at this branch's head — a
  +206-byte delta from P37's deposit-cap change. Both cross-check exactly against on-chain
  evidence: Track 1 Task 8b read back a deployed pre-cap vault at 32,378 bytes, and Task 6b
  read back this branch's fork-deployed vault's `cast code` at 32,584 bytes (65,170 hex
  characters including the `0x` prefix). `NavyVaultSRCLA` already exceeded the EIP-170
  limit of 24,576 bytes before P37, by 7,802 bytes; this branch widens the overage to 8,008
  bytes. Base enforces EIP-170 like every EVM chain, so `NavyVaultSRCLA` cannot be deployed
  to Base mainnet as it stands — a size reduction is required, and it is outside P37's
  scope. Local fork deploys work around the limit rather than avoiding it: `anvil
  --code-size-limit 100000` raises the node's accepted size, and `forge script
  --disable-code-size-limit` skips the client-side check before broadcasting; neither
  option exists on real Base mainnet. `audit/RELEASE-EVIDENCE-2026-08-14.md:14`'s size row
  ("24,749 bytes (limit: 24,576) PASS") is stale — the vault has grown well past that
  figure since, for reasons outside this branch's scope to attribute — and is superseded
  by the measurements above; that file is left unedited as historical evidence.

Measured as `gasleft()` deltas around each call, using a temporary probe
(`test/gas/DepositCapGasProbe.t.sol`, run via
`forge test --match-path test/gas/DepositCapGasProbe.t.sol -vv`). The probe is a
measurement harness, not committed — it is kept only at
`.superpowers/sdd/2026-09-13-srcla-p37-track3-deposit-cap/gas-probe.t.sol` outside the
repo. It extends `test/gas/VaultGas.t.sol`'s `VaultGasTestBase`, whose `setUpBase`
mints and donates `10_000_000_000 * 10**6` base units (10,000,000,000,000,000 base
units, i.e. $10,000,000,000) of USDC directly to the vault at zero share supply, then
registers 0 or 3 adapters. The table below is measured at both adapter counts, for an
uncapped vault and one capped well above its NAV at `PROBE_CAP = type(uint256).max / 2`:

| Function | 0 adapters, uncapped | 0 adapters, capped | 3 adapters, uncapped | 3 adapters, capped |
|---|---|---|---|---|
| `deposit` | 36,651 | 37,972 | 82,139 | 86,324 |
| `mint` | 66,545 | 69,722 | 87,743 | 96,660 |
| `maxDeposit` | 14,674 | 22,495 | 14,656 | 49,354 |
| `maxMint` | 15,856 | 27,533 | 15,838 | 57,257 |

`PROBE_CAP` is in the near-max range that item 6 warns can overflow `maxMint`'s
`convertToShares`, and would on a vault with ordinary NAV. It does not overflow here only
because the fixture's donated NAV is itself huge ($10,000,000,000) at zero share supply:
`maxMint` computes `mulDiv(room, totalSupply + 10**decimalsOffset, totalAssets + 1)`, and
dividing by that large `totalAssets + 1` denominator brings the quotient back under
2^256 even though the raw product does not fit in 256 bits — which is exactly what forces
`mulDiv` onto its full 512-bit intermediate-precision path rather than its cheaper
256-bit one. At the real $1,000,000 cap against ordinary NAV, `maxMint` and the capped
`mint` stay on the cheap path, so their real figures are slightly lower than this table's;
the probe's oversized cap and NAV combination overstates them.

A capped `mint` pays two extra `totalAssets()` loops (`maxDeposit`, then
`convertToShares`) beyond the uncapped path — visible in `maxMint`'s jump over
`maxDeposit`'s own increase at both adapter counts, and in `mint`'s smaller but
consistent increase over its uncapped baseline. An uncapped `mint` still pays
`previewMint`'s own `totalAssets()` loop; it pays none of the *extra* ones the cap adds.

## What the auditor should check

- `maxMint` never admits more assets than `maxDeposit` (`testFuzz_maxMintNeverAdmitsMoreAssetsThanMaxDeposit`).
- No sequence of deposits and mints carries `totalAssets()` past the cap except accrued
  yield (`DepositCapInvariantTest`).
- The zero cases (`paused`, `_syncUnauthorised`, `_cacheStale`) still take precedence.
- `setDepositCap` is `onlyRole(ADMIN_ROLE)`; no path lets `ALLOCATOR_ROLE` set it.
- The stale cached-NAV view is bounded, not exploitable:
  `test_staleAdapterCacheOverstatesRoomButTheCapHolds`.
- A zero cap closes deposits and mints without blocking a full redemption:
  `test_zeroCapClosesDepositsAndMints`; raising the cap back to uncapped restores
  unlimited limits: `test_settingTheCapBackToMaxRestoresUncapped`; the invariant
  campaign's `setCap` moves the cap across 0–5M between deposits.
- The mainnet release scope is exactly $1,000,000: `testReleaseScopeIsOneMillionUsdc`.
