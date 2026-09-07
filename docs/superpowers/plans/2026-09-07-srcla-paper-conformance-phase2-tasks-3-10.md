# SRCLA Phase 2 — Tasks 3–10

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Continuation of `2026-09-07-srcla-paper-conformance-phase2.md` — read its **Global Constraints** first; they apply to every task here.

**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md` §6.1–6.3
**Paper:** `docs/research/output/srcla-paper.md` (v0.5)

---

### Task 3: `liquidityFloorBps` — the on-chain half of amendment P5

Paper amendment P5 adds a structural liquidity cap to §6.1's effective exposure limit. Phase 1 implemented it off-chain in the optimiser. The vault must enforce it independently: the paper's whole architecture rests on the contract being the authoritative guardrail, so a constraint that exists only in the allocator is not a constraint.

Motivating case from the research record: a venue quoted 86.26% APR while holding $6,163 of cash at 100.04% utilisation. Rate-based logic is drawn toward exactly that.

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol` (`AdapterConfig` ~:50, `registerAdapter` ~:339, `setAdapterRisk` ~:369, `_deploy` ~:960, `currentConfigurationDigest` ~:896)
- Test: `contract/test/vault/VaultPolicy.t.sol`

**Interfaces:**
- Consumes: `AdapterConfig` from Task 1's state.
- Produces: `AdapterConfig.liquidityFloorBps` (`uint16`); `setAdapterRisk(address,uint16,uint256,uint16,uint16)` gains a fifth argument; a deploy reverts with `AdapterLiquidityFloorBreached()` when the post-deploy position would exceed the venue's demonstrable exit capacity.

- [ ] **Step 1: Write the failing test**

```solidity
/// @dev Paper §6.1 as amended by P5. The vault must refuse to deploy into a
///      venue that cannot demonstrate it could return the resulting position.
///      A venue quoting a high rate on almost no free cash is the case this
///      exists for.
function test_deployRevertsWhenLiquidityFloorBreached() public {
    // Require the adapter to be able to return 100% of the resulting position.
    vault.setAdapterRisk(address(adapter), 10_000, type(uint256).max, 50, 10_000);

    // Adapter reports it can only withdraw a tenth of what we are about to deploy.
    adapter.setMaxWithdrawable(100e6);

    vm.expectRevert(NavyVaultSRCLA.AdapterLiquidityFloorBreached.selector);
    _executePlanWithSingleDeploy(address(adapter), 1_000e6);
}

function test_deploySucceedsWhenLiquidityFloorSatisfied() public {
    vault.setAdapterRisk(address(adapter), 10_000, type(uint256).max, 50, 5_000); // 50%
    adapter.setMaxWithdrawable(600e6); // > 50% of 1,000e6
    _executePlanWithSingleDeploy(address(adapter), 1_000e6);
    assertEq(vault.strategyAssets(address(adapter)), 1_000e6);
}

function test_liquidityFloorOfZeroDisablesTheCheck() public {
    vault.setAdapterRisk(address(adapter), 10_000, type(uint256).max, 50, 0);
    adapter.setMaxWithdrawable(0);
    _executePlanWithSingleDeploy(address(adapter), 1_000e6);
    assertEq(vault.strategyAssets(address(adapter)), 1_000e6);
}
```

`_executePlanWithSingleDeploy` is a helper: build a one-action plan, `submitPlan`, then `executeNextActionWithProof` with an empty proof (a single-leaf tree's root IS the leaf). If `VaultPolicy.t.sol` has no such helper, write one and reuse it in Task 4.

- [ ] **Step 2: Run it to confirm it fails**

Run: `forge test --match-test test_deployRevertsWhenLiquidityFloorBreached -vv`
Expected: FAIL — `setAdapterRisk` takes four arguments and the error does not exist, so this will not compile. That is the expected failure; fix by implementing, not by weakening the test.

- [ ] **Step 3: Implement**

Add to `AdapterConfig`:

```solidity
        /// @notice Minimum share of the resulting position the adapter must be
        /// able to return synchronously, in basis points. Zero disables the
        /// check. Paper §6.1 as amended by P5.
        uint16 liquidityFloorBps;
```

Add the error beside the others:

```solidity
    error AdapterLiquidityFloorBreached();
```

Extend `setAdapterRisk` to accept and validate `liquidityFloorBps` (reject `> 10_000`), set it on the config, and include it in the `AdapterRiskSet` event. Default it to `0` in `registerAdapter` so registration is unchanged in behaviour.

In `_deploy`, after the existing cap checks and after `credited` is known:

```solidity
        uint16 floorBps = adapters[adapter].liquidityFloorBps;
        if (floorBps != 0) {
            uint256 required = Math.mulDiv(actualStrategyAssets, floorBps, 10_000);
            if (IStrategyAdapter(adapter).maxWithdrawable() < required) {
                revert AdapterLiquidityFloorBreached();
            }
        }
```

Add `config.liquidityFloorBps` to `currentConfigurationDigest()`'s per-adapter `abi.encode`, so a change to the floor is a configuration change the allocator must observe.

- [ ] **Step 4: Verify**

Run: `forge test --match-contract VaultPolicy -vv` → the three new tests PASS.
Run: `forge test --match-contract PlanEncodingGoldenVectorsTest -vv` → **must still PASS.** The golden vectors are computed from a fixed `PlanHeader` and do not read adapter configuration, so they should be unaffected. **If they fail, stop and report** — it would mean something changed the header, which the Global Constraints forbid.
Run the full non-fork suite.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): enforce a structural liquidity floor on deploy (P5)

The vault must be the authoritative guardrail, so P5's structural liquidity cap
cannot live only in the off-chain optimiser. A deploy now reverts when the
adapter cannot demonstrate it could return the required share of the resulting
position.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/NavyVaultSRCLA.sol contract/test/vault/VaultPolicy.t.sol
```

---

### Task 4: `accountingCap` and `recognizeLoss` — impairment

Paper §5.1: *"An unrecoverable amount becomes an explicit recognized loss or conservative value cap."* Today the vault has an `Impaired` adapter state but no way to act on it — `recognizedLosses` only ever grows through a divest shortfall, and `VaultTypes.AdapterConfig.accountingCap` is declared and unused. An impaired adapter therefore keeps contributing its full nominal value to NAV.

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol` (`AdapterConfig`, `totalAssets` ~:236, new admin functions)
- Test: `contract/test/vault/VaultPolicy.t.sol`

**Interfaces:**
- Consumes: `AdapterConfig` after Task 3.
- Produces: `AdapterConfig.accountingCap` (`uint256`, `type(uint256).max` meaning uncapped); `setAdapterAccountingCap(address,uint256)`; `recognizeLoss(address,uint256)`; events `AdapterAccountingCapSet(address,uint256)` and `LossRecognized(address,uint256)`.

- [ ] **Step 1: Write the failing test**

```solidity
/// @dev Paper §5.1 — an impaired adapter must not keep contributing its full
///      nominal value to NAV just because it has not been divested.
function test_accountingCapBoundsAnAdaptersContributionToNav() public {
    _executePlanWithSingleDeploy(address(adapter), 1_000e6);
    uint256 before = vault.totalAssets();

    vault.setAdapterAccountingCap(address(adapter), 400e6);

    assertEq(
        vault.totalAssets(),
        before - 600e6,
        "capped adapter must contribute only its cap"
    );
}

function test_accountingCapDoesNotInflateNavWhenAboveActualValue() public {
    _executePlanWithSingleDeploy(address(adapter), 1_000e6);
    uint256 before = vault.totalAssets();
    vault.setAdapterAccountingCap(address(adapter), 5_000e6);
    assertEq(vault.totalAssets(), before, "a cap above actual value must not raise NAV");
}

function test_recognizeLossReducesNavAndIsMonotonic() public {
    _executePlanWithSingleDeploy(address(adapter), 1_000e6);
    uint256 lossesBefore = vault.recognizedLosses();

    vault.recognizeLoss(address(adapter), 250e6);

    assertEq(vault.recognizedLosses(), lossesBefore + 250e6);
}

function test_recognizeLossIsAdminOnly() public {
    vm.prank(address(0xBEEF));
    vm.expectRevert();
    vault.recognizeLoss(address(adapter), 1);
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `forge test --match-test test_accountingCapBoundsAnAdaptersContributionToNav -vv`
Expected: compilation failure — neither function exists.

- [ ] **Step 3: Implement**

Add `uint256 accountingCap;` to `AdapterConfig`, defaulted to `type(uint256).max` in `registerAdapter`.

In `totalAssets()`, bound each adapter's contribution:

```solidity
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = _activeAdapters[i];
            uint256 value = strategyAssets[adapter];
            uint256 cap = adapters[adapter].accountingCap;
            assets_ += value < cap ? value : cap;
        }
```

Add the two admin functions:

```solidity
    /// @notice Bound an adapter's contribution to NAV. Paper §5.1's
    /// "conservative value cap" for an impaired position.
    function setAdapterAccountingCap(address adapter, uint256 cap) external onlyRole(ADMIN_ROLE) {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        adapters[adapter].accountingCap = cap;
        emit AdapterAccountingCapSet(adapter, cap);
    }

    /// @notice Record an unrecoverable amount as an explicit realized loss.
    /// Paper §5.1's alternative to a value cap. Monotonic: losses never unwind.
    function recognizeLoss(address adapter, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (amount == 0) revert ZeroAmount();
        recognizedLosses += amount;
        emit LossRecognized(adapter, amount);
    }
```

Add both fields to `currentConfigurationDigest()`'s per-adapter encoding.

**Think about one thing and record your conclusion:** `totalAssets()` is the denominator of share pricing. Capping it reduces NAV, which lowers the share price for everyone — correct when value is genuinely impaired, but it means an admin can move the share price. Note in your report that this is an admin power the paper's §4 authority table permits ("impairment") and that it is one-directional in the safe sense: a cap can only lower NAV, never raise it. Confirm the second test above actually proves that.

- [ ] **Step 4: Verify**

Run: `forge test --match-contract VaultPolicy -vv` and the full non-fork suite. Watch particularly for ERC-4626 rounding and donation-resistance tests that assume `totalAssets()` is a plain sum.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): impairment via accounting cap and explicit loss recognition

Paper 5.1 requires an unrecoverable amount to become either a recognized loss
or a conservative value cap. The vault had an Impaired state but no way to act
on it, so an impaired adapter kept contributing full nominal value to NAV.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/NavyVaultSRCLA.sol contract/test/vault/VaultPolicy.t.sol
```

---

### Task 5: `executeHarvestAction` must take its action from a Merkle proof

`executeHarvestAction` reads the committed action from `_planActions`, which only the legacy `executePlan` ever populated — and Task 1 deleted that. Harvest-within-a-plan is therefore unreachable: it reads a zeroed struct and reverts on `adapter == address(0)`.

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol` (`executeHarvestAction` ~:768)
- Modify: `srcla/src/execution/executor.ts` (ABI entry)
- Test: `contract/test/vault/VaultHarvest.t.sol`

**Interfaces:**
- Consumes: `hashPlanAction(bytes32,Action)` and `activePlanDomain`, both unchanged.
- Produces: `executeHarvestAction(bytes32[] merkleProof, Action action, VaultTypes.HarvestRequest request)`.

- [ ] **Step 1: Write the failing test**

```solidity
/// @dev Harvest-in-plan was unreachable: it read _planActions, which only the
///      deleted legacy executePlan ever wrote.
function test_harvestActionExecutesViaMerkleProof() public {
    VaultTypes.HarvestRequest memory request = VaultTypes.HarvestRequest({
        adapter: address(adapter),
        token: address(rewardToken),
        maxClaim: 100e18,
        routeId: routeId,
        minOut: 1,
        deadline: block.timestamp + 1 hours
    });

    NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
        planId: planId,
        index: 0,
        kind: NavyVaultSRCLA.ActionKind.Harvest,
        adapter: address(adapter),
        amount: 0,
        minOut: 1,
        dataHash: keccak256(abi.encode(request))
    });

    _submitSingleActionPlan(action);
    vault.executeHarvestAction(new bytes32[](0), action, request);

    assertGt(vault.recognizedRewards(), 0, "harvest must credit recognized rewards");
}

function test_harvestActionRejectsARequestThatDoesNotMatchTheCommitment() public {
    // dataHash commits to `request`; submitting a different one must revert.
    ...build action committing to requestA, then call with requestB...
    vm.expectRevert(NavyVaultSRCLA.InvalidDataHash.selector);
    vault.executeHarvestAction(new bytes32[](0), action, requestB);
}
```

Fill the second test's body from the first — the point is that `dataHash` binds the request, so a substituted request is rejected.

- [ ] **Step 2: Run it to confirm it fails**

Run: `forge test --match-test test_harvestActionExecutesViaMerkleProof -vv`
Expected: compilation failure — the signature takes only a `HarvestRequest` today.

- [ ] **Step 3: Implement**

Change the signature to `(bytes32[] calldata merkleProof, Action calldata action, VaultTypes.HarvestRequest calldata request)`. Mirror `executeNextActionWithProof`'s checks in order: plan active; not expired; configuration digest unchanged; `action.index == activePlanNextActionIndex`; `action.planId == uint256(activePlanId)`; Merkle proof verifies `hashPlanAction(activePlanDomain, action)` against `activePlanMerkleRoot`; `keccak256(abi.encode(request)) == action.dataHash`. Then run the existing `_executeHarvestWithRequest`, advance the index, accumulate turnover, enforce risk limits, and complete the plan exactly as `executeNextActionWithProof` does.

Update the ABI entry in `srcla/src/execution/executor.ts` to match the new signature.

- [ ] **Step 4: Verify**

Run: `forge test --match-contract VaultHarvest -vv`, then the full non-fork suite, then `pnpm exec tsc --noEmit` from `srcla/`.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(contract): make harvest-in-plan reachable via Merkle proof

executeHarvestAction read its committed action from _planActions, which only
the deleted legacy executePlan ever populated, so it always read a zeroed
struct and reverted. It now takes the action with a proof, like every other
plan action.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/NavyVaultSRCLA.sol contract/test/vault/VaultHarvest.t.sol srcla/src/execution/executor.ts
```

---

### Task 6: Deterministic `withdrawalOrder` for `_ensureIdle`

Paper §5.2: *"The vault divests strategies in a deterministic order during a withdrawal."* `_ensureIdle` iterates `_activeAdapters`, whose order `_removeAdapter` mutates with swap-and-pop. Two vaults with identical configuration can drain venues in different orders depending on their registration and removal history.

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol` (`_ensureIdle` ~:1082, new admin function)
- Test: `contract/test/vault/VaultPolicy.t.sol`

**Interfaces:**
- Produces: `setWithdrawalOrder(address[] calldata order)` (ADMIN_ROLE); `withdrawalOrder()` view; `_ensureIdle` iterating that order when set, falling back to registry order when empty.

- [ ] **Step 1: Write the failing test**

```solidity
/// @dev Paper §5.2 requires a deterministic divest order. Registry order is
///      mutated by _removeAdapter's swap-and-pop, so it is not one.
function test_withdrawalDrainsAdaptersInTheConfiguredOrder() public {
    _executePlanWithSingleDeploy(address(adapterA), 500e6);
    _executePlanWithSingleDeploy(address(adapterB), 500e6);

    address[] memory order = new address[](2);
    order[0] = address(adapterB);
    order[1] = address(adapterA);
    vault.setWithdrawalOrder(order);

    // Withdraw less than one adapter holds: only the first in order is touched.
    vault.withdraw(300e6, address(this), address(this));

    assertEq(vault.strategyAssets(address(adapterA)), 500e6, "second in order untouched");
    assertLt(vault.strategyAssets(address(adapterB)), 500e6, "first in order drained");
}

function test_setWithdrawalOrderRejectsAnUnregisteredAdapter() public {
    address[] memory order = new address[](1);
    order[0] = address(0xDEAD);
    vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
    vault.setWithdrawalOrder(order);
}

function test_setWithdrawalOrderRejectsDuplicates() public {
    address[] memory order = new address[](2);
    order[0] = address(adapterA);
    order[1] = address(adapterA);
    vm.expectRevert(NavyVaultSRCLA.DuplicateDependencyGroupMember.selector);
    vault.setWithdrawalOrder(order);
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `forge test --match-test test_withdrawalDrainsAdaptersInTheConfiguredOrder -vv`
Expected: compilation failure — `setWithdrawalOrder` does not exist.

- [ ] **Step 3: Implement**

Add `address[] private _withdrawalOrder;` and:

```solidity
    /// @notice Fix the order in which strategies are divested to satisfy a
    /// withdrawal. Paper §5.2 requires this order to be deterministic; the
    /// registry order is not, because _removeAdapter uses swap-and-pop.
    function setWithdrawalOrder(address[] calldata order) external onlyRole(ADMIN_ROLE) {
        for (uint256 i = 0; i < order.length; i++) {
            if (!registeredAdapters[order[i]]) revert AdapterNotFound();
            for (uint256 j = 0; j < i; j++) {
                if (order[j] == order[i]) revert DuplicateDependencyGroupMember();
            }
        }
        delete _withdrawalOrder;
        for (uint256 i = 0; i < order.length; i++) {
            _withdrawalOrder.push(order[i]);
        }
        emit WithdrawalOrderSet(order);
    }

    function withdrawalOrder() external view returns (address[] memory) {
        return _withdrawalOrder;
    }
```

In `_ensureIdle`, iterate `_withdrawalOrder` when non-empty, else `_activeAdapters`. Keep every existing per-adapter check — state filter, `maxWithdrawable` clamp, loss accounting.

- [ ] **Step 4: Verify**

Run the VaultPolicy suite and the full non-fork suite. Confirm withdrawal tests that relied on registry order still pass or have their expectations updated with reasoning.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): deterministic withdrawal order for _ensureIdle

Paper 5.2 requires a deterministic divest order during a withdrawal. Registry
order is mutated by _removeAdapter's swap-and-pop, so identical configurations
could drain venues differently depending on history.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/NavyVaultSRCLA.sol contract/test/vault/VaultPolicy.t.sol
```

---

### Task 7: `RewardExecutor` — oracle age, chain binding, event evidence, replay counter

Four §9.4 requirements are unmet. The first is the serious one: **the executor never checks oracle staleness at all.** §9.4 requires each route to fix "Chainlink feeds, maximum ages"; `_validateChainlinkPrice` checks round completeness and that `updatedAt != 0`, but never compares it to `block.timestamp`. A feed frozen for a week passes.

**Files:**
- Modify: `contract/src/interfaces/IRewardExecutor.sol` (`Route` struct), `contract/src/reward/RewardExecutor.sol`
- Test: `contract/test/reward/RewardExecutor.t.sol`

**Interfaces:**
- Produces: `Route.maxRewardFeedAge` and `Route.maxUsdcFeedAge` (`uint256` seconds); `swapCount(bytes32)` view; `computeDigest` covering `block.chainid` and `pools`; `Swapped` emitted on every swap; `setDailyVolume` removed.

- [ ] **Step 1: Write the failing tests**

```solidity
/// @dev §9.4 requires each route to fix maximum feed ages. The executor never
///      compared updatedAt to block.timestamp, so a frozen feed passed.
function test_swapRevertsOnAStaleRewardFeed() public {
    rewardFeed.setUpdatedAt(block.timestamp - 2 hours);   // route allows 1 hour
    vm.prank(address(vault));
    vm.expectRevert(RewardExecutor.StaleChainlinkPrice.selector);
    executor.swap(routeId, 1e18, 0, block.timestamp + 1);
}

function test_swapSucceedsOnAFreshFeed() public {
    rewardFeed.setUpdatedAt(block.timestamp - 1 minutes);
    vm.prank(address(vault));
    executor.swap(routeId, 1e18, 0, block.timestamp + 1);
}

function test_routeDigestBindsChainId() public {
    // Same route parameters must not produce the same digest on another chain.
    bytes32 here = executor.computeDigest(routeId, route);
    vm.chainId(999);
    assertTrue(here != executor.computeDigest(routeId, route), "digest must bind chain id");
}

function test_swapEmitsSwappedEvidence() public {
    vm.expectEmit(true, true, true, false);
    emit IRewardExecutor.Swapped(routeId, route.inputToken, route.outputToken, 0, 0, 0);
    vm.prank(address(vault));
    executor.swap(routeId, 1e18, 0, block.timestamp + 1);
}

function test_swapCountIncrements() public {
    uint256 before = executor.swapCount(routeId);
    vm.prank(address(vault));
    executor.swap(routeId, 1e18, 0, block.timestamp + 1);
    assertEq(executor.swapCount(routeId), before + 1);
}
```

If the test mock feed has no `setUpdatedAt`, add one — check `contract/test/mocks/` first.

- [ ] **Step 2: Run them to confirm they fail**

Run: `forge test --match-contract RewardExecutorTest -vv`
Expected: the staleness test fails (a stale feed is currently accepted) and the others fail to compile.

- [ ] **Step 3: Implement**

Add to `Route` in `IRewardExecutor.sol`:

```solidity
        uint256 maxRewardFeedAge; /// @dev Max seconds since the reward feed's updatedAt
        uint256 maxUsdcFeedAge;   /// @dev Max seconds since the USDC feed's updatedAt
```

Change `_validateChainlinkPrice(address feed)` to `_validateChainlinkPrice(address feed, uint256 maxAge)` and add, after the existing checks:

```solidity
        if (block.timestamp - updatedAt > maxAge) revert StaleChainlinkPrice();
```

`_validateOracle` passes each route's respective age. `approveRoute` must reject a zero `maxRewardFeedAge` or `maxUsdcFeedAge` — an unbounded age is the defect being fixed.

Replace the deprecated `latestAnswer()` calls in `_validateOracle` and `_oracleExpectedOut` with the `latestRoundData()` values already being read.

Add `block.chainid` and `keccak256(abi.encodePacked(route_.pools))` to `computeDigest`, and mirror the change in `approveRoute`'s inline digest computation so the two cannot drift.

Add `mapping(bytes32 => uint256) public swapCount;`, increment it in `_completeSwap`, and emit the `Swapped` event there with the real values — it is currently declared and never emitted, so harvests leave no on-chain evidence.

Delete `setDailyVolume` and its interface declaration. Any test using it to reset volume must construct the state legitimately instead; if a test cannot, delete it and say which coverage went with it.

- [ ] **Step 4: Verify**

Run: `forge test --match-contract RewardExecutor -vv` then the full non-fork suite. Note `test/reward/RewardExecutorFork.t.sol` cannot run.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): oracle age, chain binding and swap evidence in RewardExecutor

Paper 9.4 requires each approved route to fix Chainlink feeds and their maximum
ages, and to bind the chain id. The executor checked round completeness but
never compared updatedAt to block.timestamp, so a feed frozen for a week passed;
the route digest omitted chain id and pools; and the Swapped event was declared
but never emitted, leaving harvests with no on-chain evidence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/reward/RewardExecutor.sol contract/src/interfaces/IRewardExecutor.sol contract/test/reward/RewardExecutor.t.sol
```

---

### Task 8: `RewardAccountant` — the §9.2 lazy refresh

§9.2: *"share-changing and allocator transactions refresh material reward values lazily when cache-age or material-change rules require it."* `syncForShareAction` is `external view` and does nothing. The vault calls it on every deposit and mint, and it is a no-op — so a stale feed permanently closes deposits (`maxDeposit` returns 0) with no on-chain remedy, because `refresh()` is `REWARD_ADMIN_ROLE`-gated and nothing in `srcla` calls it.

**Files:**
- Modify: `contract/src/reward/RewardAccountant.sol`, `contract/src/interfaces/IRewardAccountant.sol`
- Test: `contract/test/reward/RewardAccountant.t.sol`

**Interfaces:**
- Produces: `syncForShareAction(bool material) external returns (uint256)` — non-view, refreshing stale material tokens when permitted.

- [ ] **Step 1: Write the failing test**

```solidity
/// @dev §9.2's lazy refresh. syncForShareAction was `view` and did nothing, so
///      a stale feed closed deposits permanently with no on-chain remedy.
function test_syncForShareActionRefreshesAStaleCache() public {
    _seedMaterialToken();
    vm.warp(block.timestamp + 2 days);          // cache now stale
    assertFalse(accountant.issuanceReady(), "precondition: stale");

    vm.prank(address(vault));
    accountant.syncForShareAction(true);

    assertTrue(accountant.issuanceReady(), "sync must clear staleness");
}

function test_syncForShareActionDoesNotRaiseValueFromAnInvalidFeed() public {
    _seedMaterialToken();
    feed.setPrice(-1);                          // invalid
    vm.warp(block.timestamp + 2 days);
    uint256 before = accountant.cachedRewardAssets();

    vm.prank(address(vault));
    accountant.syncForShareAction(true);

    assertLe(accountant.cachedRewardAssets(), before, "an invalid source must never raise NAV");
}
```

The second test is the important one: §9.2 says *"A stale or invalid source cannot increase NAV."*

- [ ] **Step 2: Run them to confirm they fail**

Run: `forge test --match-test test_syncForShareActionRefreshesAStaleCache -vv`
Expected: FAIL — the function is a no-op, so staleness persists.

- [ ] **Step 3: Implement**

Make `syncForShareAction(bool material)` non-view. Have it perform the same validated refresh `refresh()` does, for material tokens whose cache is older than their policy's `maxAge`, and remain callable by the vault — add the vault as an authorised caller rather than widening `REWARD_ADMIN_ROLE`. A token whose feed is stale or invalid must have its cached value left unchanged or reduced, never raised. Update the interface declaration to match, and the vault's call sites where the `view` assumption is now wrong.

- [ ] **Step 4: Verify**

Run: `forge test --match-contract RewardAccountant -vv`, then the full non-fork suite, then rebuild the vault (`forge build`) to confirm the changed mutability does not break its call sites.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): implement the paper 9.2 lazy reward refresh

syncForShareAction was `view` and did nothing, so a stale feed closed deposits
permanently with no on-chain remedy: refresh() is role-gated and nothing calls
it. A stale or invalid source still cannot raise NAV.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/reward/RewardAccountant.sol contract/src/interfaces/IRewardAccountant.sol contract/test/reward/RewardAccountant.t.sol
```

---

### Task 9: Delete the inverted `VaultTypes.ActionKind`

`VaultTypes.ActionKind` is `{Divest, Deploy}` — the inverse of `NavyVaultSRCLA.ActionKind`'s `{Deploy, Divest, Harvest, EmergencyExit}`. Anything that reaches for the wrong one silently encodes a deploy as a divest. `grep` shows no user in `contract/src` or `contract/test`, so this is free to remove and expensive to leave.

**Files:**
- Modify: `contract/src/libraries/VaultTypes.sol`

- [ ] **Step 1: Confirm it is genuinely unused**

Run: `grep -rn "VaultTypes.ActionKind\|VaultTypes.Action\b" contract/ srcla/`
Expected: no hits. If there ARE hits, stop and report — the deletion is not free and I need to rule on it.

- [ ] **Step 2: Delete `ActionKind` and the unused `Action` struct from `VaultTypes.sol`**

Keep `ACTION_TYPEHASH`, `HARVEST_REQUEST_TYPEHASH`, `AdapterStatus`, `AdapterConfig`, `DependencyGroup`, `PlanHeader` and `HarvestRequest`. If `ACTION_TYPEHASH` references the deleted struct's field list only as a string literal, it is safe; confirm rather than assume.

- [ ] **Step 3: Verify**

Run: `forge build` then the full non-fork suite. Both must be clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(contract): delete the inverted VaultTypes.ActionKind duplicate

VaultTypes.ActionKind was {Divest, Deploy}, the inverse of the vault's own
{Deploy, Divest, Harvest, EmergencyExit}. Unused, and a silent encoding hazard
for anything that reached for the wrong one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/src/libraries/VaultTypes.sol
```

---

### Task 10: Regenerate audit evidence and the deployment record

The audit in `contract/audit/` was written against the pre-Phase-2 bytecode. Six of the nine tasks above changed contract behaviour, so the audit's claims no longer describe what is deployed.

**Files:**
- Modify: `contract/audit/AUDIT-REPORT.md`, `contract/DEPLOYMENTS.md`
- Create: `contract/audit/2026-09-07-phase2-changes.md`

- [ ] **Step 1: Write the change record**

Create `contract/audit/2026-09-07-phase2-changes.md` listing, for each of Tasks 1–9: what changed, which paper section required it, and what an auditor should re-examine. Be specific about the ones that alter economics or authority:
- `totalAssets()` can now be reduced by an admin via `accountingCap` — a share-price effect, one-directional (can only lower NAV).
- `recognizeLoss` is a new admin power that permanently increases `recognizedLosses`.
- Deploys can now revert on `AdapterLiquidityFloorBreached`, which is new liveness-affecting behaviour.
- `syncForShareAction` changed from `view` to state-changing, so every caller's gas and reentrancy surface changed.
- The removal of three execution paths changes the contract's external surface.

- [ ] **Step 2: Mark the audit report stale**

Add a dated banner at the top of `contract/audit/AUDIT-REPORT.md` stating it describes pre-Phase-2 bytecode, naming the change record, and listing which findings need re-verification. Do NOT edit the historical findings themselves — an audit report is a dated artefact and rewriting it destroys the record.

- [ ] **Step 3: Update `DEPLOYMENTS.md`**

Add a Phase 2 section noting that the contracts have changed and any previously recorded address now refers to superseded bytecode. Do NOT invent addresses — no redeploy has happened.

- [ ] **Step 4: Report the deferred redeploy**

The spec's Phase 2 checkpoint is "`forge test` green including new invariants; `vault-e2e` passes". The first half is achievable; the second needs an Anvil fork, a deploy and a funded relayer, which are not available. Report BLOCKED for the redeploy and `vault-e2e`, with the exact commands an operator needs — mirroring the runbook in `docs/superpowers/plans/2026-09-07-srcla-phase1-outcome.md`.

- [ ] **Step 5: Commit**

```bash
git commit -m "docs(contract): record Phase 2 contract changes and mark the audit stale

Six of nine Phase 2 tasks changed contract behaviour, so the existing audit no
longer describes the code. Records what changed, what an auditor must
re-examine, and that no redeploy has occurred.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- contract/audit/2026-09-07-phase2-changes.md contract/audit/AUDIT-REPORT.md contract/DEPLOYMENTS.md
```

---

## Phase 2 Exit Criteria

- [ ] `forge build` clean
- [ ] `forge test --no-match-path 'test/{fork,integration}/*' --no-match-contract 'Fork'` — no failures; any drop from the 417 baseline is explained by a named deleted test
- [ ] `forge test --match-contract PlanEncodingGoldenVectorsTest` still passes — the golden vectors must survive every change here
- [ ] From `srcla/`: `pnpm exec tsc --noEmit` and `pnpm test:unit` (721) clean, since three tasks change ABIs the off-chain code mirrors
- [ ] `grep -rn "executeAction\|executePlan(" contract/src` returns nothing
- [ ] Audit change record written; redeploy and `vault-e2e` reported BLOCKED with a runbook

## Self-Review Notes

- **Spec coverage:** §6.1 → Tasks 1–6; §6.2 → Task 7; §6.3 → Task 8; §12's checkpoint → Task 10. §6.4 was Phase 1.
- **Ordering rationale:** Task 1 first because it deletes code every later task would otherwise maintain; Task 2 before 3 and 6 because both build on `requiredIdle`; Task 5 after Task 1 because Task 1 deletes the mapping Task 5's current implementation reads.
- **Type consistency:** `AdapterConfig` gains `liquidityFloorBps` (Task 3) then `accountingCap` (Task 4); both are added to `currentConfigurationDigest()` by their own task. `setAdapterRisk` gains its fifth parameter in Task 3 only.
- **Carried to Phase 3/4, not lost:** the `srcla` Moonwell `simulateStressRate` unit mismatch; an Aave-shaped `irmParams` variant; the six pre-existing `scripts/` type errors; §10.3's balance-delta reconciliation; the §6.2 oracle-freshness admission rule; relocating `POST /v1/internal/trigger` off the read API.
