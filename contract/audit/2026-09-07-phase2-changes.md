# Phase 2 contract change record — SRCLA paper conformance

**Date:** 2026-09-07 → 2026-09-08
**Branch:** `feat/srcla-paper-conformance`
**Scope:** `contract/src/NavyVaultSRCLA.sol`, `contract/src/reward/RewardExecutor.sol`,
`contract/src/reward/RewardAccountant.sol`, `contract/src/libraries/VaultTypes.sol`,
`contract/src/interfaces/{IVaultEvents,IRewardExecutor,IRewardAccountant}.sol`,
`contract/script/DeployBaseSystem.s.sol` (+ two dev scripts)
**Plan:** `docs/superpowers/plans/2026-09-07-srcla-paper-conformance-phase2.md`
**Paper:** `docs/research/output/srcla-paper.md` (v0.5)
**Audit status:** `audit/AUDIT-REPORT.md` describes **pre-Phase-2** bytecode. This file is
the delta an auditor must read alongside it.

**No redeploy has occurred.** Every address recorded anywhere in this repository refers to
bytecode that predates these changes. See §"Deferred: redeploy and `vault-e2e`" at the end.

---

## Read this first — the three loudest items

1. **ABI BREAK.** `RewardAccountant`'s **constructor signature changed** from
   `constructor(address admin)` to `constructor(address admin, address vault_)`
   (commit `fdc33c10`). Any integrator, script or deployment tool that constructs it the
   old way **no longer compiles**, and any recorded constructor-argument blob for a prior
   deployment is wrong for this bytecode.
2. **`RewardAccountant.syncForShareAction` is no longer `view`** (commit `d48f5656`). It is
   state-changing and is called by `NavyVaultSRCLA.deposit`/`mint`. Every caller's gas cost
   and reentrancy surface changed. A caller that `staticcall`s it now reverts.
3. **Three findings from review were deliberately NOT fixed** and are carried below as
   known-open: **F6** (off-chain positional read of `routes()` is stale), **F7** (paper §9.2's
   allocator leg unimplemented), **F8** (recognized reward NAV still ignores claimable
   amounts — so "a failed claim contributes zero" holds **vacuously**, not by code).

---

## Change index

| # | Task | Commit(s) | Paper / spec | Contract |
|---|---|---|---|---|
| 1 | Delete the weak `executeAction` and the legacy plan triple | `22d59355`, `cd2c9912` | §9.5, spec §6.1.1 | `NavyVaultSRCLA` |
| 2 | Enforce `minIdleBps` in `requiredIdle()` | `724b91e6`, `55bc2cac` | §8.1 | `NavyVaultSRCLA` |
| 3 | `liquidityFloorBps` — on-chain half of amendment P5 | `d25b5524` | P5, spec §6.1.3 | `NavyVaultSRCLA` |
| 4 | `accountingCap` + `recognizeLoss` — impairment | `357a41f1`, `2d34d77c` | §5.1 | `NavyVaultSRCLA` |
| 5 | `executeHarvestAction` takes its action from a Merkle proof | `0d02eeb4` | §9.5 | `NavyVaultSRCLA` |
| 6 | Deterministic `withdrawalOrder` for `_ensureIdle` | `5c71032a`, `e966001b` | §5.2 | `NavyVaultSRCLA` |
| 7 | Oracle age, chain binding, swap evidence, replay counter | `92b55a65` | §9.4 | `RewardExecutor` |
| 8 | The §9.2 lazy reward refresh | `d48f5656` | §9.2 | `RewardAccountant`, `NavyVaultSRCLA` |
| — | **F1–F5 review fixes (ABI break, see above)** | `fdc33c10` | §9.2, §9.4 | `RewardAccountant`, `RewardExecutor`, `NavyVaultSRCLA`, `DeployBaseSystem.s.sol` |
| 9 | Delete the inverted `VaultTypes.ActionKind` duplicate | `71958a21` | Phase 1 carry-forward | `VaultTypes` (library) |

---

## Task 1 — the weak `executeAction` and the legacy plan triple are gone

**Commits:** `22d59355`, `cd2c9912`. **Paper:** §9.5.

The vault exposed three ways to execute a plan action; only `executeNextActionWithProof`
performed the §9.5 rechecks (configuration digest, plan risk limits, turnover accounting,
plan completion, dynamic-reserve activation). The weaker paths were reachable by the same
`ALLOCATOR_ROLE`, so they were **removed from the bytecode**, not disabled.

Removed external functions:

- `executeAction(uint256,uint32,uint8,address,uint256,uint256,bytes32,bytes32[])`
- `executePlan(bytes32,bytes32,uint64,(uint256,uint32,uint8,address,uint256,uint256,bytes32)[])`
- `executeNextAction()`
- `harvest(address,bytes32,uint256)` — the legacy 3-arg form; the atomic 6-arg
  `harvest(address,address,uint256,bytes32,uint256,uint256)` remains
- `getActivePlanAction(...)` — read only the now-deleted `_planActions`

Also deleted: the `_planActions` mapping, `_getExpectedAction`, and the `ActionExecuted`
event declaration (only the deleted `executeAction` ever emitted it, so it was permanent
no-fire noise in a published, immutable ABI).

**External-surface consequence.** The vault's only fund-moving entry points are now
`executeNextActionWithProof`, `executeHarvestAction`, the atomic 6-arg `harvest`,
`emergencyExit` (ADMIN_ROLE) and the ERC-4626 user paths. Any client, monitoring rule,
subgraph, or ABI copy that references a removed selector now encodes a call to a function
that does not exist — the vault has no fallback, so such a call reverts.

**Auditor should re-examine:** that no remaining path can execute a plan action without the
§9.5 rechecks; `contract/test/vault/BypassRemoval.t.sol` proves the four deleted selectors
are absent from the **deployed runtime bytecode** (a bytecode scan, not merely a revert),
with a positive control. `cd2c9912` restored `onlyAllocator` / `RewardExecutorNotSet`
coverage on the surviving atomic harvest, which the Task-1 test deletions had silently
dropped — verify that the guards on the surviving harvest are covered, not assumed.

**Off-chain mirror:** `srcla/src/execution/executor.ts` dropped the `executeAction` ABI entry
and method in the same commit.

---

## Task 2 — `minIdleBps` is now actually enforced

**Commits:** `724b91e6` (fix), `55bc2cac` (fuzz coverage). **Paper:** §8.1.

`minIdleBps` was settable and covered by the configuration digest but **never read**. The
paper's non-bypassable percentage floor therefore did not exist on-chain.

```solidity
function requiredIdle() public view returns (uint256 reserve) {
    reserve = Math.max(adminReserve, dynamicReserve);
    reserve = Math.max(reserve, activePlanReserve);
    reserve = Math.max(reserve, Math.mulDiv(totalAssets(), minIdleBps, 10_000));  // new
}
```

**Liveness-affecting.** `requiredIdle()` gates deploys. On a vault with a non-zero
`minIdleBps` that previously deployed freely, deploys can now revert `InsufficientIdle`.
A vault configured with `minIdleBps = 0` is unchanged.

**Auditor should re-examine:** the new term reads `totalAssets()`, which after Task 4 is
itself a function of `accountingCap` and `adapterRecognizedLoss` — so an admin action that
lowers NAV also lowers the absolute idle floor. Confirm that is the intended coupling.
`contract/test/invariant/IdleFloorInvariant.t.sol` is a new, independent
handler/invariant pair added because the pre-existing `VaultHandler.deploy()`'s bare
`catch` swallowed `InsufficientIdle` like every other revert, giving the bps term zero real
assertion coverage.

---

## Task 3 — `liquidityFloorBps`: a deploy can now revert on liquidity

**Commit:** `d25b5524`. **Paper:** amendment P5, spec §6.1.3.

P5's structural liquidity cap previously lived only in the off-chain optimiser. The vault
is meant to be the authoritative guardrail, so the check is now on-chain:

```solidity
uint16 floorBps = adapters[adapter].liquidityFloorBps;
if (floorBps != 0) {
    uint256 required = Math.mulDiv(actualStrategyAssets, floorBps, 10_000);
    if (IStrategyAdapter(adapter).maxWithdrawable() < required) revert AdapterLiquidityFloorBreached();
}
```

**ABI changes:**

- `setAdapterRisk` gains a **fifth argument** `uint16 liquidityFloorBps`.
- `AdapterRiskSet` (`IVaultEvents`) gains a matching field — event **topic0 changed**; any
  indexer or alert on `AdapterRiskSet` must be updated.
- New error `AdapterLiquidityFloorBreached()`.
- `currentConfigurationDigest()`'s per-adapter encoding now covers the new field, so **every
  previously computed configuration digest is invalidated**. A plan committed against an
  old digest will fail its §9.5 recheck.

All existing call sites pass `0` (check disabled), so registered-adapter behaviour is
unchanged until an admin sets a non-zero floor.

**New, liveness-affecting behaviour:** the check reads `maxWithdrawable()` on the adapter
**after** the deposit is credited. A venue whose synchronous liquidity is temporarily
depleted (protocol utilisation spike, cash shortfall) makes an otherwise valid deploy
revert. This turns a third-party protocol's transient state into a plan-execution failure.

**Auditor should re-examine:** whether `maxWithdrawable()` is trustworthy for each adapter
(it is adapter-reported, inside the existing admin-allowlist trust boundary); and the DoS
shape — an adversary who can move a venue's utilisation can block deploys to it.

---

## Task 4 — impairment: `accountingCap` and `recognizeLoss` (economics; admin authority)

**Commits:** `357a41f1`, then `2d34d77c` (durability fix). **Paper:** §5.1.

The vault had an `Impaired` adapter state but no way to act on it: an impaired adapter kept
contributing full nominal value to NAV. §5.1 requires an unrecoverable amount to become
either a recognized loss or a conservative value cap. Both now exist.

**`totalAssets()` changed** — this is a **share-price effect**:

```solidity
uint256 value = strategyAssets[adapter];
uint256 cap = adapters[adapter].accountingCap;
uint256 contribution = value < cap ? value : cap;
uint256 loss = adapterRecognizedLoss[adapter];
assets_ += contribution > loss ? contribution - loss : 0;
```

**New admin powers (`ADMIN_ROLE`):**

- `setAdapterAccountingCap(address adapter, uint256 cap)` — bounds an adapter's NAV
  contribution. Emits `AdapterAccountingCapSet`. Defaults to `type(uint256).max` on
  registration, i.e. disabled.
- `recognizeLoss(address adapter, uint256 amount)` — permanently increases the durable
  per-adapter `adapterRecognizedLoss` mapping and the global `recognizedLosses` counter.
  Emits `LossRecognized`. **Monotonic: losses never unwind.**

**Direction of the effect.** As implemented, both levers are **one-directional: they can only
lower NAV.** `accountingCap` is a `min()` against the tracked value, and
`adapterRecognizedLoss` is only ever added to. An admin cannot raise NAV or share price with
either. That is the safety property to check has not regressed.

**But it is still an admin lever on share price.** Lowering NAV lowers the price per share
for every existing holder, and raises the shares minted for the next depositor. There is no
timelock and no bound on how much an `ADMIN_ROLE` holder may write down in one call beyond
the adapter's own current contribution. This sits inside the same governance trust boundary
as `LENDACCESS-6` in the existing register (a default admin can install a lying adapter),
but it is a **new, direct, single-call** route to the same outcome and should be reflected in
the multisig/timelock policy that `LENDACCESS-6` demands.

**The `2d34d77c` durability fix — read this, the first version was actively harmful.**
`357a41f1`'s `recognizeLoss` wrote down `strategyAssets[adapter]`. But `_syncAllStrategies()`
runs on **every** deposit, mint, withdraw and redeem and overwrites that slot from the
adapter's own `sync()` — so the very next unrelated vault action silently reversed the
impairment while `recognizedLosses` kept climbing. `2d34d77c` moved the loss into the durable
`adapterRecognizedLoss` mapping, subtracted inside `totalAssets()` **after** the accounting
cap, with an underflow clamp.

`2d34d77c` also changed the **global counter's semantics**: `recognizedLosses` accrues only by
the amount **actually** recognized (capped at the adapter's remaining contribution), because
it is not telemetry — it gates plan execution via `activePlanMaxRecognizedLoss`, so an
overstated figure can spuriously abort a valid plan.

**Auditor should re-examine:**
- The interaction of `accountingCap` and `adapterRecognizedLoss` in `totalAssets()` — the cap
  is applied first, then the loss subtracted, then clamped at zero. Double-counting is the
  hazard: an admin who both caps and recognizes against the same shortfall reduces NAV twice.
  Nothing prevents that.
- `recognizedLosses` is written by three separate paths — `recognizeLoss`, `_divest`'s loss
  branch, and `_ensureIdle`'s aggregate loss — and read by the plan risk gate. Confirm the
  gate's semantics still hold now that an admin can move the same counter out-of-band during
  an active plan.
- Gas: `totalAssets()` now pays an extra SLOAD per active adapter. The 16-adapter deploy gas
  budget in `contract/test/gas/VaultGas.t.sol` was raised to accommodate it (see the audit
  register's P1 performance gate).

---

## Task 5 — `executeHarvestAction` reads its action from a Merkle proof

**Commit:** `0d02eeb4`. **Paper:** §9.5.

`executeHarvestAction` sourced its expected `Action` from `_planActions`, which only the
(now deleted) legacy `executePlan` ever populated — so it always read a zeroed struct and
reverted. Harvest-in-plan was unreachable. It now takes the action with a Merkle proof, like
every other plan action, and checks `action.kind == Harvest`.

**Signature changed** (proof + action parameters). `srcla/src/execution/executor.ts` was
updated in the same commit.

**Auditor should re-examine:** that the harvest leaf uses the same domain-bound encoding as
the other action kinds and cannot be replayed across plans, and that the pause/adapter-state
checks in `_executeHarvestWithRequest` run **before** the `dataHash` comparison (three
pre-existing tests were re-pointed onto this entry point in `e966001b` on exactly that
assumption).

---

## Task 6 — deterministic withdrawal order

**Commits:** `5c71032a` (recovered, landed `[UNVERIFIED]`), `e966001b` (verification + fix).
**Paper:** §5.2.

New `_withdrawalOrder` storage, `setWithdrawalOrder(address[])` (ADMIN_ROLE; rejects
unregistered and duplicate entries), `withdrawalOrder()` view. `_ensureIdle` drains the
configured order first, then falls through to registry order so a withdrawal cannot fail
while liquidity exists elsewhere. `_drainAdapterForIdle` extracted.

**Provenance warning for an auditor:** `5c71032a` was committed **unverified** — recovered
work from two torn-down agents, landed to avoid losing it while `forge` was crashing the
machine. `e966001b` performed the verification and found it had broken three pre-existing
tests (Harvest-kind actions routed through the generic path now revert
`HarvestRequiresExecuteHarvestAction`). Treat `5c71032a`'s diff as needing a fresh read
rather than as reviewed work.

**Auditor should re-examine:** that a partial admin order cannot starve a withdrawal, and
that the fall-through cannot double-drain an adapter that appears in both the order and the
registry.

---

## Task 7 — `RewardExecutor`: oracle age, chain binding, swap evidence

**Commit:** `92b55a65`. **Paper:** §9.4. **Register findings touched:** `AMMORACLE-7` (Open).

- **`Route` gains `maxRewardFeedAge` and `maxUsdcFeedAge`** (seconds). `approveRoute`
  rejects zero for either and fails closed if either feed is already stale at approval time.
- **`_validateChainlinkPrice(feed, maxAge)`** now reverts `StaleChainlinkPrice` when
  `block.timestamp - updatedAt > maxAge`, in addition to the existing round-completeness and
  non-zero-`updatedAt` checks. Previously a feed frozen for a week passed. It returns the
  validated price, so `_validateOracle` / `_oracleExpectedOut` no longer call the deprecated
  `latestAnswer()`.
- **`computeDigest` is now `view`, was `pure`** (it reads `block.chainid`). It and
  `approveRoute`'s check share one internal `_computeDigest`. **The digest now covers
  `block.chainid`, `keccak256(pools)` and the two new max-age fields** — all previously
  omitted. **Every previously computed route digest is invalidated.**
- **`swapCount(bytes32) public view`** — new replay/evidence counter, incremented in
  `_completeSwap`, which now also **emits `Swapped`** with real amounts and price impact.
  The event was declared but never emitted, so harvests left no on-chain evidence.
- **`setDailyVolume` is REMOVED** from the contract and `IRewardExecutor` — it was an admin
  backdoor that reset the daily notional cap. Any operator procedure or script calling it
  now fails.

**Storage-layout change.** The two new `Route` fields are inserted after `usdcFeed`, so the
auto-generated `routes(bytes32)` getter returns **14 words, not 12**. See **F6** below —
this has a known unrepaired off-chain consumer.

**Auditor should re-examine:** whether §9.4 is now satisfied or only partly. `AMMORACLE-7`
in the existing register is **Open** for two reasons — no Base sequencer-uptime/grace check,
and no governed upper bound on `maxFeedAge`. The upper bound was added later in `fdc33c10`
(`MAX_FEED_AGE = 48 hours`); **the sequencer-uptime check is still absent.** `AMMORACLE-8`
(governed economic min/max answer bounds) is likewise still Open. Reward routes must remain
disabled.

---

## Task 8 — the §9.2 lazy reward refresh; `syncForShareAction` is state-changing

**Commit:** `d48f5656`. **Paper:** §9.2.

- **`RewardAccountant.syncForShareAction(bool)` changed from `view` to STATE-CHANGING.** It
  calls a new internal `_lazyRefreshStaleMaterialTokens()`: for each policy token, if its
  cache is **both** material and older than `cacheLifetime`, it attempts the same validated
  refresh `refresh()` performs (shared `_getValidatedPrice` / `_computeTokenValue` helpers).
  A non-stale or non-material entry carries its existing `cache.value` forward with no
  oracle re-read. If the USDC feed or the token's own feed fails validation, that token's
  cache is left exactly as it was and contributes **zero** to the recomputed total —
  the same "invalid source contributes nothing" rule `refresh()` already applies.
- **New access control:** `address public vault`, admin-settable via `setVault(address)`
  (`REWARD_ADMIN_ROLE`). `syncForShareAction` reverts `Unauthorized()` for any caller that
  is neither `vault` nor a `REWARD_ADMIN_ROLE` holder. This was chosen over granting the
  vault `REWARD_ADMIN_ROLE`, which also controls token policies and feeds and would have
  been a real privilege escalation.
- **`NavyVaultSRCLA.deposit`/`mint` reordered:** `syncForShareAction` is now called
  **before** the `_cacheStale()` gate (it was called after, i.e. only when the cache was
  already known non-stale — a no-op in practice). A stale-but-refreshable cache can now
  self-heal inline with the depositor's own transaction.

**Every caller's gas and reentrancy surface changed.** The vault now makes a
state-*mutating* external call on the deposit/mint hot path, before `super.deposit()`.
`NavyVaultSRCLA` declares **no `ReentrancyGuard` and no `nonReentrant` anywhere.**

**Auditor should re-examine (review finding F9, LOW, not fixed):** inside
`_lazyRefreshStaleMaterialTokens`, `_computeTokenValue` calls
`IERC20(token).balanceOf(address(this))` **before** the `cache.value` / `cache.lastUpdated`
writes, and `lastSafeValue` — which `totalAssets()` reads — is written only after the whole
loop. A reward token with a reentrant `balanceOf` could re-enter `vault.deposit` mid-loop and
observe a state where some caches are updated but `lastSafeValue` is not; the outer frame
then overwrites the inner frame's `lastSafeValue`. Reward tokens are admin-allowlisted via
`setTokenPolicy`, so this stays inside an existing trust boundary and **no exploit is
claimed** — but the implementer's justification ("touches only the accountant's own storage")
is not accurate: there is an untrusted-shaped external call in the middle of a
read-modify-write. `nonReentrant` on `deposit`/`mint`, or hoisting the balance reads above
the writes, would close it cheaply.

**Also re-examine:** a `staticcall` to `syncForShareAction` now reverts. The only real
callers found by grep across `contract/`, `srcla/` and `be/` are the two vault call sites;
other matches are test-only mocks and `srcla`'s read-only ABI file.

---

## F1–F5 review round — **the ABI break** (`fdc33c10`)

Independent review of Tasks 7 and 8 returned two BLOCKERs and three MAJORs. All five were
fixed in one commit. This is the most consequential commit in Phase 2 for an integrator.

### F1 (BLOCKER) — `DeployBaseSystem.s.sol` shipped a vault whose every deposit reverts

`d48f5656` added authorization to `syncForShareAction` but left `DeployBaseSystem.s.sol`
wiring the accountant with a comment instead of a call, because its `admin` may be a
different key from its broadcaster. Result: a production deployment where
`accountant.vault() == address(0)`, so **every `deposit` and `mint` reverts
`Unauthorized()`** — and `maxDeposit` still advertised `type(uint256).max`.

**⚠️ ABI BREAK — `RewardAccountant`'s constructor signature changed:**

```solidity
constructor(address admin, address vault_)   // was: constructor(address admin)
```

The vault is now bound at construction; there is no window in which the accountant
authorises nobody. `setVault` is retained for re-pointing later. **Any integrator or script
constructing `RewardAccountant` the old way no longer compiles**, and any recorded
constructor-argument encoding for a prior deployment is invalid against this bytecode. All
8 in-repo construction sites (3 scripts, 5 tests) already had the vault in scope and were
updated.

**ERC-4626 view-path behaviour change:** `NavyVaultSRCLA.maxDeposit` and `maxMint` now
return **0** when a reward accountant is wired but does not authorise this vault:

```solidity
function _syncUnauthorised() private view returns (bool) {
    return rewardAccountant != address(0)
        && IRewardAccountant(rewardAccountant).vault() != address(this);
}
```

This is a view-path check rather than a revert in `setRewardAccountant`, because the
unwired state is also reachable *after* wiring via `accountant.setVault(address(0))`.
It adds one `STATICCALL` to `maxDeposit`/`maxMint`, which OZ's `ERC4626.deposit` calls
internally — a gas change on the hot path. **An accountant that does not implement
`vault()` now makes the vault's read path revert instead of silently over-reporting.**

**A REQUIRED post-deploy step is now documented in `contract/script/POST_DEPLOY.md`**
(new file), plus a `console2.log` block at the end of every `DeployBaseSystem` run that
echoes `accountant.vault()` for the operator to compare against the printed vault address.
It was put there rather than in `DEPLOYMENTS.md`/`README.md` because both of those files
carry uncommitted owner edits.

### F2 (BLOCKER) — the §9.2 lazy refresh was inert most of any day

The USDC/USD leg of the refresh was bounded at a hardcoded `1 hours` and returns before any
per-token work. Chainlink's USDC/USD feed on Base publishes on an **86400 s (24 h) heartbeat
with a 0.3 % deviation threshold** (source: Chainlink's published reference-data directory
for Base mainnet; a stablecoin rarely breaches 0.3 %, so publication normally *is* the
heartbeat). The refresh therefore did nothing for most of any day and the deposit still
reverted `MaterialCacheRequired`.

**New admin-configurable bound:**

```solidity
uint256 public constant DEFAULT_USDC_FEED_MAX_AGE = 24 hours;  // = the published heartbeat
uint256 public constant MAX_USDC_FEED_MAX_AGE     = 48 hours;  // hard ceiling
uint256 public usdcFeedMaxAge;                                 // constructor: = DEFAULT
function setUsdcFeedMaxAge(uint256) external onlyRole(REWARD_ADMIN_ROLE);  // rejects 0 and > ceiling
```

`usdcFeedMaxAge` replaces the hardcoded `1 hours` in **both** `refresh()` and
`_lazyRefreshStaleMaterialTokens()` — they read the same feed for the same purpose and
would otherwise disagree. The bound is bounded on both sides: zero would freeze every
refresh, unbounded would reinstate staleness.

**The heartbeat is from Chainlink's published directory, not read from chain** — no RPC was
available. If production uses a different feed variant with a different cadence,
`setUsdcFeedMaxAge` is the knob. The 48 h ceiling (two heartbeats) is a documented judgement
call, not derived.

### F3 (MAJOR) — no vault-level test proved the refresh unblocks a deposit

Added `test_deposit_succeedsWhenTheLazyRefreshCanClearAStaleCache` and the `mint`
equivalent. They configure the state §9.2 is written for and that the existing
`*_revertsWhenCacheStale` tests cannot reach: the reward token has its **own** feed with
`maxAge = 30 days` while `cacheLifetime = 1 hours`, so a 2-hour warp staleness the *cache*
alone while both oracles stay valid.

### F4 (MAJOR) — `approveRoute` rejected the safe value and permitted the dangerous one

`approveRoute` rejected `0` but accepted `type(uint256).max` for either max-age field —
reinstating exactly the staleness defect the fields exist to close. New public constant
`RewardExecutor.MAX_FEED_AGE = 48 hours`, enforced on both legs alongside the existing zero
rejection. Every route in the repo already uses `3600`, so nothing needed re-tuning.
**This is the "governed maximum feed age" half of register finding `AMMORACLE-7`.**

### F5 (MAJOR) — a vacuous invariant test

`test_syncForShareActionDoesNotRaiseValueFromAnInvalidFeed` asserted
`assertLe(after, before)`, which a no-op sync satisfies. It now pins the specific
post-state: NAV strictly falls to zero, issuance stays blocked, and the cache is **not**
stamped fresh. A same-block USDC heartbeat fabricated in the fixture — which is what hid F2
— was deleted.

**Evidence quality note for an auditor:** the fix round re-ran every new or rewritten test
against a real revert of the production change it covers. One test does **not** fail under
any revert and is flagged by its own author rather than claimed as evidence:
`test_defaultUsdcFeedMaxAgeCoversTheBaseHeartbeat` (`assertGe(usdcFeedMaxAge(), 86_400)`) is
a configuration assertion, not a behaviour test.

---

## Task 9 — the inverted `VaultTypes.ActionKind` is deleted

**Commit:** `71958a21`. **Origin:** Phase 1 carry-forward.

`VaultTypes.ActionKind` was `{Divest, Deploy}` — the **inverse** of the vault's own
`NavyVaultSRCLA.ActionKind` `{Deploy, Divest, Harvest, EmergencyExit}`. Anything reaching
for the wrong one silently encodes a deploy as a divest. It had no compile-time user, so it
and the unused `VaultTypes.Action` struct were removed.

`ACTION_TYPEHASH` and `HARVEST_REQUEST_TYPEHASH` reference the field list only as a **string
literal** (verified), so encoding is unaffected. `PlanHeader`, `AdapterStatus`,
`AdapterConfig`, `DependencyGroup` and `HarvestRequest` are untouched.

**Nothing an auditor needs to re-examine on-chain** — this is a source-level deletion with no
bytecode consequence for the vault, which never referenced the library's enum.

---

## Known-open — carried forward, deliberately NOT fixed

These were found by review and left. They are recorded here so they are not lost.

### F6 [MEDIUM] — the `Route` layout change breaks srcla's positional digest read

`srcla/src/collector/snapshot-collector.ts` reads the public `routes(bytes32)` getter and
hardcodes `routeData[11]` as `routeDigest`, with a comment enumerating the 12 words the
getter used to return. Task 7 inserted two fields, so the getter now returns **14 words and
`routeDigest` is at index 13**; index 11 is now `upperBound`. The collector would record
`upperBound` as the route digest — **silent data corruption in the route manifest, not a
failure**.

`RewardExecutor.MAX_FEED_AGE` (added in `fdc33c10`) is a `constant`, so it occupies no
storage slot and does **not** shift the index again: **index 13 stands.** But nobody has
updated the off-chain reader.

Masked today by a separate pre-existing bug on the line above (`ethers.id(fn + '()')`
computes the selector for `routes()`, not `routes(bytes32)`, and no argument is encoded), so
the call almost certainly returns `0x` and is swallowed by the `catch`. **Latent, not
active — but latent breakage introduced by Phase 2.**

Related: `srcla/src/chain/abis/reward-executor.json` is stale in **four** ways — the
`approveRoute`/`computeDigest` tuples lack the two new fields, `computeDigest` is still
declared `pure` (it is `view`), `setDailyVolume` is still present though deleted, and
`MAX_FEED_AGE` is missing. Nothing in `srcla/src` currently loads that file, so this is
housekeeping — but any future consumer encoding `approveRoute` from it produces wrong
calldata.

### F7 [MEDIUM] — paper §9.2's "allocator transactions" leg is unimplemented

Paper §9.2: *"share-changing **and allocator** transactions refresh material reward values
lazily when cache-age or material-change rules require it."*

Task 8 wired only the share-changing leg (`deposit`/`mint`). **No allocator entry point** —
`submitPlan`, `executeNextActionWithProof`, `executeHarvestAction`, `harvest` — calls
`syncForShareAction`, and `RewardAccountant.vault` authorises **exactly one address**, so an
allocator EOA could not call it even if it wanted to. Half the sentence is implemented.
Wiring the other half needs a **second authorisation concept**, which is a design decision,
not a patch.

### F8 [MEDIUM] — recognized reward NAV still ignores claimable amounts ⚠️

Paper §9.2: *"Recognized reward NAV uses **actual claimable plus held amounts**"*.

Both `refresh()` and the new `_lazyRefreshStaleMaterialTokens()` value **only**
`IERC20(token).balanceOf(address(this))` (`RewardAccountant._computeTokenValue`).
`refresh(address[] calldata)` **declares an adapters array and never reads it** — the
parameter is unnamed and unused. `getClaimableFromAdapters` exists but is **never called**
from either path.

**An auditor must not read the passing test as evidence that the logic exists.** The
property "a failed claim contributes zero to recognized NAV" is satisfied **VACUOUSLY** —
there is no claim leg in either refresh path at all, so there is nothing that could
contribute. It is not satisfied by a branch, a guard, or any code an auditor can point at.
Conformance to §9.2's "claimable plus held" wording is **absent**, not verified.

Pre-existing; not introduced by Phase 2. It compounds with the existing register finding
`ERC20-5` / `LENDACCESS-5` (**Feature disabled** — first-party reward claiming is not
implemented and all claimable values are zero), which is why it is currently harmless: with
no claiming implemented, "claimable" is always zero anyway. **It stops being harmless the
moment real claiming lands.**

### `USDC_USD_FEED` at `DeployBaseSystem.s.sol:33` is dead and probably wrong ⚠️

`0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56` — the `USDC_USD_FEED` constant, also mirrored
in `DeployBaseSystem.t.sol` and in `DEPLOYMENTS.md`'s Base address table — **does not appear
anywhere in Chainlink's Base feed directory.** The directory lists `USDC / USD` on Base under
`0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` (corroborated by BaseScan, which shows an
`EACAggregatorProxy` there) and also under `0x458138Fc0D67027E9A6778ef40a6ffC318c69061`, both
at heartbeat 86400 / threshold 0.3.

It was **not** changed: two candidate addresses came back and picking the wrong one is worse
than leaving a dead constant — and it *is* dead, `run()` never reads it. A `WARNING` comment
sits at the constant and a ⚠️ in `POST_DEPLOY.md` tells the operator to read the address from
Chainlink's directory rather than copy it.

**Unresolved. Needs someone with RPC access** to confirm the correct Base USDC/USD proxy and
correct the constant, its test mirror, and `DEPLOYMENTS.md`. Latent today, a live landmine
for whoever first runs `setUsdcUsdFeed`.

### F10 / F11 — recorded, low

- **F10:** `test_swapEmitsSwappedEvidence` duplicates `test_swap_emitsEvent` with weaker
  assertions (`expectEmit(..., false)` — data unchecked). Redundant, not vacuous.
- **F11:** `maxDeposit`/`maxMint` now **under**-report: they return `0` whenever
  `_cacheStale()`, but after Task 8 a deposit in that state may succeed via the lazy
  refresh. Being `view`, they cannot simulate the refresh. §9.2 specifies exactly this
  `maxDeposit == 0` behaviour, so it is not wrong — but the BFF (`/vault/limits`) and any
  ERC-4626 aggregator will refuse deposits the contract would accept. Worth a deliberate
  decision.

---

## Verification status

Run from `contract/`, at commit `71958a21`:

| Gate | Command | Result |
|---|---|---|
| Compile | `forge build` | clean (pre-existing lint warnings only) |
| Non-fork suite | `forge test --no-match-path 'test/{fork,integration}/*' --no-match-contract 'Fork'` | **450 passed, 0 failed, 3 skipped** (453) |
| Broad non-fork | `forge test --no-match-path 'test/fork/*' --no-match-contract 'Fork\|BaseDeploymentAcceptance'` | 461 passed, 0 failed, 3 skipped (464) |
| Golden vectors | `forge test --match-contract PlanEncodingGoldenVectorsTest` | 1 passed. **`PlanHeader` unchanged throughout Phase 2.** |
| Base fork suites | — | **NOT RUN.** No Anvil node, no `BASE_RPC_URL`. |

**Known flake:** `invariant_noSilentInflation` (`test/invariant/NavyVaultInvariant.t.sol`)
fires intermittently on an unpinned fuzz seed and via Foundry's cached fuzz-failure replay
(`cache/invariant/failures/`). Confirmed as pre-existing and seed-dependent — deleting the
cache directory and rerunning passes cleanly. Not a Phase 2 regression; not chased.

**Not verified by any suite run here:** every fork test, `test/integration/**`, and
`BaseDeploymentAcceptanceTest` (which requires a Base-chain fork and fails
`setUp(): Must run on Base chain` otherwise).

---

## Deferred: redeploy and `vault-e2e` — **BLOCKED**

The spec's Phase 2 checkpoint is "`forge test` green including new invariants; `vault-e2e`
passes". **The first half is met. The second is BLOCKED** — it needs an Anvil fork of Base,
a fresh deploy and a funded relayer/keeper, none of which were available, and starting one
was explicitly prohibited for this work.

**No redeploy has happened. Every address recorded in `contract/DEPLOYMENTS.md`, `be/.env`
or `srcla/.env.anvil` refers to superseded bytecode.** Redeploying is not optional before
any further integration testing: Phase 2 changed a constructor signature, removed five
external functions, added a `setAdapterRisk` argument, changed the `AdapterRiskSet` event
shape, and invalidated both the vault configuration digest and every route digest.

### Operator runbook

```bash
# 1. Anvil fork of Base mainnet (:8545). This IS the chain for local dev.
anvil --fork-url https://mainnet.base.org --code-size-limit 100000

# 2. Deploy the vault package against the fork.
cd contract
forge script script/DeployNavyVaultSRCLA.s.sol --fork-url http://127.0.0.1:8545 --broadcast
#   (full Base package instead: script/DeployBaseSystem.s.sol)
#   -> addresses change on EVERY redeploy. Copy them into:
#        be/.env         NAVY_VAULT_ADDRESS, NAVY_PAYMENTS_ADDRESS, NAVY_USDC_ADDRESS, NAVY_TREASURY_ADDRESS
#        srcla/.env.anvil VAULT_ADDRESS, COMPOUND_/AAVE_/MOONWELL_STRATEGY_ADDRESS, REWARD_EXECUTOR_ADDRESS

# 3. REQUIRED post-deploy admin steps — see contract/script/POST_DEPLOY.md.
#    In particular verify accountant.vault() == the deployed vault, or every
#    deposit and mint reverts Unauthorized() (finding F1). DeployBaseSystem
#    prints both addresses at the end of its run for comparison.

# 4. Fund the vault.
forge script script/FundVaultAnvil.s.sol --fork-url http://127.0.0.1:8545 --broadcast

# 5. Fork acceptance (the suites excluded from every count above).
forge test --match-path 'test/integration/BaseDeploymentAnvil.t.sol' --fork-url http://127.0.0.1:8545
BASE_RPC_URL=http://127.0.0.1:8545 forge test   # picks up test/**/*Fork.t.sol too

# 6. The end-to-end vault proof. Needs a funded relayer/keeper and a plain-EOA payer
#    (an EIP-7702 delegated account CANNOT be the EIP-3009 payer).
cd ..
NAVY_VAULT_E2E=1 NAVY_VAULT_E2E_PAYER_KEY=<plain EOA key> node be/scripts/vault-e2e.mjs

# 7. Off-chain conformance, since Phase 2 changed ABIs the off-chain code mirrors.
cd srcla && pnpm exec tsc --noEmit && pnpm test:unit
#    -> also fix F6 first: snapshot-collector.ts reads routeData[11]; the index is now 13.
```

### What must be true before that runbook is meaningful

- **F6 is unfixed.** Running the collector against a redeployed `RewardExecutor` records
  `upperBound` as the route digest.
- **The `USDC_USD_FEED` constant is unresolved.** Do not run `setUsdcUsdFeed` from it.
- **Reward routes must stay disabled** — `AMMORACLE-7` (sequencer uptime) and `AMMORACLE-8`
  (economic answer bounds) are still Open in the register, and first-party reward claiming
  is still `Feature disabled`.
