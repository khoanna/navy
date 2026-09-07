# SRCLA Paper Conformance — Phase 2 Implementation Plan (Contracts)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-chain enforcement layer match the research paper: one fund-moving path, no dead bypasses, a reserve floor that is actually enforced, oracle staleness that is actually checked, and impairment that can be recorded.

**Architecture:** Surgical changes to three contracts. `NavyVaultSRCLA.sol` loses its two superseded execution paths and gains the enforcement the paper specifies (percentage idle floor, structural liquidity floor, impairment cap). `RewardExecutor.sol` gains the oracle-age, chain-binding and event evidence §9.4 requires. `RewardAccountant.sol` gains the lazy refresh §9.2 requires. Off-chain ABIs follow.

**Tech Stack:** Foundry (Solidity 0.8.24), `forge test`; ethers v6 on the off-chain side.

**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md` §6.1–6.3
**Paper:** `docs/research/output/srcla-paper.md` (v0.5) §5.1, §5.2, §6.1, §9.2, §9.4, §9.5
**Phase 1 outcome and carried deferrals:** `docs/superpowers/plans/2026-09-07-srcla-phase1-outcome.md`

## Global Constraints

- **Baseline:** `forge test --no-match-path 'test/{fork,integration}/*' --no-match-contract 'Fork'` currently reports **417 passed, 0 failed, 3 skipped** across 30 suites. Any task that reduces the passing count without deleting the corresponding test is a regression.
- **Fork tests cannot run.** No Anvil node and no `BASE_RPC_URL`. Never start one. Fork suites (`test/fork/**`, `test/integration/**`, `*Fork*`) are out of scope for verification; say so rather than skipping silently.
- **Solidity 0.8.24**, Foundry. Contracts are immutable and non-proxy by design — there is no upgrade path, so correctness at deploy time is the only correctness there is.
- **Action kind encoding is `NavyVaultSRCLA.ActionKind`: Deploy=0, Divest=1, Harvest=2, EmergencyExit=3.** `VaultTypes.ActionKind` is an inverted duplicate (Divest=0, Deploy=1) and is deleted in Task 9.
- **Money is `uint256` in USDC base units (6 decimals).** Rates are WAD (1e18); utilisation is RAY (1e27). Basis points are `uint16` out of 10,000.
- **`PlanHeader` must NOT change.** `contract/test/vault/PlanEncodingGoldenVectors.t.sol` pins `planDomain` and `hashPlanAction` outputs captured from the real contract, and `srcla/src/policy/steps/plan.ts` reproduces them. Changing the header breaks both. If a task appears to need a header change, stop and report.
- **Off-chain ABI mirrors:** `srcla/src/execution/executor.ts` carries a `VAULT_ABI` array. Any external-function signature you change or delete must be changed there in the same commit, or the off-chain code silently encodes calls to a function that no longer exists.
- **Commit by explicit pathspec:** `git commit -m "..." -- <paths>`. `git add` new files by exact path only, never `-A`. The repository owner has unrelated staged work (`De-cuong.pdf`, `image.png`, `be/src/vault/vault-apy.service.spec.ts`) that must remain staged and untouched; verify with `git show --stat HEAD`.
- **No side effects outside the repository:** no containers, no ports, no Anvil, no database.
- Run `forge` commands from `contract/`; run `pnpm` commands from `srcla/`.

## Task Map

| # | Task | Closes |
|---|---|---|
| 1 | Delete the weak `executeAction` and the legacy plan triple; prove the bypasses are gone | C1, spec §6.1.1 |
| 2 | Wire `minIdleBps` into `requiredIdle()` | C2 |
| 3 | `liquidityFloorBps` — the on-chain half of amendment P5 | spec §6.1.3 |
| 4 | `accountingCap` + `recognizeLoss` — impairment | C3, paper §5.1 |
| 5 | Fix `executeHarvestAction` to take its action from a Merkle proof | C4 |
| 6 | Deterministic `withdrawalOrder` for `_ensureIdle` | C5, paper §5.2 |
| 7 | `RewardExecutor` — oracle age, chain binding, event evidence, replay counter | C6, C7, C8, C10 |
| 8 | `RewardAccountant` — the §9.2 lazy refresh | C9 |
| 9 | Delete the inverted `VaultTypes.ActionKind` duplicate | Phase 1 carry-forward |
| 10 | Regenerate audit evidence and deployment record | spec §12 Phase 2 checkpoint |

---

### Task 1: Delete the weak `executeAction` and the legacy plan triple

The vault currently exposes **three** ways to execute a plan. Only one — `executeNextActionWithProof` — performs the rechecks paper §9.5 requires: configuration digest, plan risk limits, turnover accounting, plan completion and dynamic-reserve activation. The other two are strictly weaker and reachable by the same role.

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol` (delete `executePlan` ~:566, `executeNextAction` ~:580, legacy `harvest(address,bytes32,uint256)` ~:586, `executeAction` ~:669, and the now-dead `_planActions` mapping and `_getExpectedAction`)
- Modify: `contract/test/vault/MerklePlanExecution.t.sol`, `contract/test/vault/merkle-proof-validation.t.sol`
- Modify: `srcla/src/execution/executor.ts` (drop the `executeAction` ABI entry ~:96 and the `executeAction` method ~:310)
- Test: `contract/test/vault/BypassRemoval.t.sol` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: a vault whose only fund-moving entry points are `executeNextActionWithProof(bytes32[],Action)`, `executeHarvestAction(...)` (rewritten in Task 5), `emergencyExit(address)` (ADMIN_ROLE), and the ERC-4626 user paths.

- [ ] **Step 1: Write the failing test**

Create `contract/test/vault/BypassRemoval.t.sol`. It asserts the deleted selectors are genuinely absent — the vault has no fallback, so a call to a removed selector reverts.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {MockERC20} from "../../src/MockERC20.sol";

/// @dev Paper §9.5 requires every plan action to pass the configuration-digest
///      recheck, the plan risk limits, turnover accounting and plan completion.
///      Only executeNextActionWithProof does that, so the weaker paths must not
///      exist at all — a disabled-but-present path is one upgrade away from live.
contract BypassRemovalTest is Test {
    NavyVaultSRCLA internal vault;
    MockERC20 internal usdc;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new NavyVaultSRCLA(usdc, "Navy USDC", "navUSDC", address(this), address(this));
    }

    function _selectorAbsent(string memory sig) internal returns (bool) {
        (bool ok, ) = address(vault).call(abi.encodeWithSignature(sig));
        return !ok;
    }

    function test_weakExecuteActionSelectorIsGone() public {
        assertTrue(
            _selectorAbsent("executeAction(uint256,uint32,uint8,address,uint256,uint256,bytes32,bytes32[])"),
            "weak executeAction must not exist"
        );
    }

    function test_legacyExecutePlanSelectorIsGone() public {
        assertTrue(
            _selectorAbsent("executePlan(bytes32,bytes32,uint64,(uint256,uint32,uint8,address,uint256,uint256,bytes32)[])"),
            "legacy executePlan must not exist"
        );
    }

    function test_legacyExecuteNextActionSelectorIsGone() public {
        assertTrue(_selectorAbsent("executeNextAction()"), "legacy executeNextAction must not exist");
    }

    function test_legacyHarvestSelectorIsGone() public {
        assertTrue(
            _selectorAbsent("harvest(address,bytes32,uint256)"),
            "legacy 3-arg harvest must not exist"
        );
    }

    function test_sanctionedProofPathStillExists() public {
        // A present-but-reverting function proves the selector still exists:
        // it reverts for a policy reason (no active plan), not for absence.
        (bool ok, bytes memory ret) = address(vault).call(
            abi.encodeWithSignature(
                "executeNextActionWithProof(bytes32[],(uint256,uint32,uint8,address,uint256,uint256,bytes32))"
            )
        );
        assertFalse(ok, "call should revert");
        assertGt(ret.length, 0, "should revert with data, proving the function exists");
    }
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `forge test --match-contract BypassRemovalTest -vv`
Expected: the four `SelectorIsGone` tests FAIL, because those functions currently exist and calling them with empty calldata reverts inside the function rather than for absence. Read the failure output before proceeding — if a test passes now, the selector string is wrong and the test proves nothing.

- [ ] **Step 3: Delete the superseded paths**

In `contract/src/NavyVaultSRCLA.sol` remove, in full:
- `function executePlan(bytes32 planId, bytes32 decisionHash, uint64 expiresAt, Action[] calldata actions)`
- `function executeNextAction()`
- `function harvest(address adapter, bytes32 routeId, uint256 minOut)` — the three-argument legacy overload only; **keep** the six-argument `harvest(address,address,uint256,bytes32,uint256,uint256)`
- `function executeAction(uint256, uint32, ActionKind, address, uint256, uint256, bytes32, bytes32[])`
- the `_planActions` mapping and `_getExpectedAction`, which only those paths used

Leave `_executeAction(Action memory)` — `executeNextActionWithProof` calls it.

- [ ] **Step 4: Update the two contract tests that exercised the deleted path**

`contract/test/vault/MerklePlanExecution.t.sol` and `contract/test/vault/merkle-proof-validation.t.sol` call `executeAction`. Port each case to `executeNextActionWithProof`, which takes `(bytes32[] merkleProof, Action action)` and requires the leaf to be `hashPlanAction(activePlanDomain, action)` rather than the old packed encoding. Any case that cannot be ported because it tested behaviour unique to the weak path should be DELETED with a one-line comment saying which behaviour left with it — do not leave it skipped.

- [ ] **Step 5: Remove the off-chain mirror**

In `srcla/src/execution/executor.ts` delete the `'function executeAction(...)'` entry from `VAULT_ABI` and the `async executeAction(...)` method. Phase 1 left no live caller; confirm with `grep -rn "\.executeAction(" srcla/src srcla/test`.

- [ ] **Step 6: Verify**

Run: `forge test --match-contract BypassRemovalTest -vv` → all five PASS.
Run: `forge test --no-match-path 'test/{fork,integration}/*' --no-match-contract 'Fork'` → no failures; the passing count may drop only by tests you deleted in Step 4, and your report must name each.
Run from `srcla/`: `pnpm exec tsc --noEmit && pnpm test:unit` → clean, 721 tests.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(contract): delete the weak executeAction and legacy plan triple

Paper 9.5 requires every plan action to pass the configuration-digest recheck,
plan risk limits, turnover accounting and plan completion. Only
executeNextActionWithProof does. The weaker executeAction and the legacy
executePlan/executeNextAction/harvest triple bypassed those and were reachable
by the same role, so they are removed rather than disabled.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/NavyVaultSRCLA.sol contract/test/vault/BypassRemoval.t.sol contract/test/vault/MerklePlanExecution.t.sol contract/test/vault/merkle-proof-validation.t.sol srcla/src/execution/executor.ts
```

---

### Task 2: Wire `minIdleBps` into `requiredIdle()`

`minIdleBps` is declared, settable by ADMIN_ROLE, included in the configuration digest — and never read when computing the reserve. The percentage idle floor the paper describes is not enforced.

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol` (`requiredIdle()` ~:1077)
- Test: `contract/test/vault/VaultPolicy.t.sol`

**Interfaces:**
- Consumes: `AdapterConfig` unchanged.
- Produces: `requiredIdle()` returning `max(adminReserve, dynamicReserve, activePlanReserve, totalAssets * minIdleBps / 10_000)`.

- [ ] **Step 1: Write the failing test**

Append to `contract/test/vault/VaultPolicy.t.sol`:

```solidity
/// @dev minIdleBps was dead configuration: settable, digest-covered, never read.
function test_requiredIdleHonoursMinIdleBps() public {
    // adminReserve and dynamicReserve both zero, so only the bps floor can bind.
    vault.setAdminReserve(0);
    vault.setMinIdleBps(500); // 5%

    uint256 assets = vault.totalAssets();
    vm.assume(assets > 0);

    assertEq(
        vault.requiredIdle(),
        (assets * 500) / 10_000,
        "requiredIdle must honour the percentage floor"
    );
}

function test_requiredIdleTakesTheLargerOfFloorAndAdminReserve() public {
    uint256 assets = vault.totalAssets();
    vm.assume(assets > 10_000);

    vault.setMinIdleBps(100);                     // 1% of assets
    vault.setAdminReserve(assets);                // absolute, strictly larger
    assertEq(vault.requiredIdle(), assets, "admin reserve must win when larger");

    vault.setAdminReserve(0);
    vault.setMinIdleBps(10_000);                  // 100% of assets
    assertEq(vault.requiredIdle(), assets, "bps floor must win when larger");
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `forge test --match-test test_requiredIdleHonoursMinIdleBps -vv`
Expected: FAIL — `requiredIdle()` returns 0 because it ignores `minIdleBps`.

- [ ] **Step 3: Implement**

```solidity
    function requiredIdle() public view returns (uint256 reserve) {
        reserve = Math.max(adminReserve, dynamicReserve);
        reserve = Math.max(reserve, activePlanReserve);
        // Paper §8.1: the administrator's percentage idle floor is
        // non-bypassable. It was previously declared and never read.
        reserve = Math.max(reserve, Math.mulDiv(totalAssets(), minIdleBps, 10_000));
    }
```

Note `requiredIdle()` is called from `_deploy` via `_requiredIdle()`, and `totalAssets()` iterates adapters — confirm no reentrancy or gas regression in the deploy path, and say so in your report.

- [ ] **Step 4: Verify**

Run: `forge test --match-contract VaultPolicy -vv` → PASS.
Run: `forge test --no-match-path 'test/{fork,integration}/*' --no-match-contract 'Fork'` → no new failures. If a pre-existing test now fails because the floor genuinely binds where it previously did not, that is the feature working; fix the test's expectation and show the arithmetic.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(contract): enforce the percentage idle floor in requiredIdle

minIdleBps was settable and covered by the configuration digest but never read,
so the paper's non-bypassable percentage floor was not enforced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/NavyVaultSRCLA.sol contract/test/vault/VaultPolicy.t.sol
```

---

### Tasks 3–10

Specified in the companion file, split so each stays reviewable:

**`docs/superpowers/plans/2026-09-07-srcla-paper-conformance-phase2-tasks-3-10.md`**

Tasks 1 and 2 come first because Task 1 removes code every later task would otherwise have to keep working, and Task 2 changes a value (`requiredIdle`) that Tasks 3 and 6 both build on.

## Self-Review Notes

- **Spec coverage:** spec §6.1 → Tasks 1–6; §6.2 → Task 7; §6.3 → Task 8; §12's Phase 2 checkpoint → Task 10. Spec §6.4 (off-chain execution) was completed in Phase 1.
- **Deliberately deferred to Phase 3/4, not lost:** the `srcla` Moonwell `simulateStressRate` unit mismatch (unreferenced code); an Aave-shaped `irmParams` variant; the six pre-existing `scripts/` type errors surfaced by Phase 1's new `typecheck:scripts` gate.
- **Known risk:** Tasks 3 and 4 change `AdapterConfig`, which feeds `currentConfigurationDigest()`. That changes live digests but NOT the pinned golden vectors, which are computed from a fixed `PlanHeader` and do not read adapter configuration. Task 3's implementer must confirm `PlanEncodingGoldenVectors` still passes; if it does not, something changed the header and the task must stop.
- **Task 10 will likely be BLOCKED** on the absence of an Anvil node, exactly as Phase 1's Task 16 was. It is scoped so the documentation work proceeds and only the redeploy is deferred.
