# Base SRCLA Vault Core Implementation Plan (Plan 1 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sepolia farming vault with an immutable Base-native ERC-4626 core that enforces adapter lifecycle, exposure/dependency caps, dynamic reserve, staged-plan, loss, pause, and synchronous-withdrawal safety independently of SRCLA forecasts.

**Architecture:** `NavyVault` owns Circle native Base USDC and delegates only to vault-bound `IStrategyAdapter` contracts. The external admin configures immutable-code adapters and hard limits; the hot allocator can execute ordered, expiring plan actions and vault-only emergency exits but cannot choose arbitrary recipients or calls. Reward accounting is represented by a narrow hook in this plan and implemented in Plan 3.

**Tech Stack:** Foundry 1.4.4, Solidity 0.8.24, OpenZeppelin Contracts v5, Forge unit/fuzz/invariant tests.

## Global Constraints

- Base chain ID is exactly `8453`.
- Vault asset is Circle native Base USDC exactly `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` in deployment and fork tests.
- Users pay gas and use standard ERC-4626 entry/exit; do not add EIP-3009, a farming relayer, or relayed redemption.
- `NavyVault` is immutable and non-proxy; adapters are replaced by admitting newly deployed immutable instances.
- All allocator-controlled recipients are fixed to the vault or an admitted adapter.
- Accounting NAV and same-transaction withdrawal liquidity remain separate.
- Use custom errors, `SafeERC20`, checks-effects-interactions, `ReentrancyGuard`, and explicit balance-delta checks.
- Preserve `NavyPayments.sol` and its Sepolia behavior.
- Approved design: `docs/superpowers/specs/2026-08-02-base-srcla-vault-design.md`.

---

### Task 1: Add Base Foundry profile and the strategy/policy interfaces

**Files:**
- Modify: `contract/foundry.toml`
- Create: `contract/src/interfaces/IStrategyAdapter.sol`
- Create: `contract/src/interfaces/IRewardAccountant.sol`
- Create: `contract/src/libraries/VaultTypes.sol`
- Create: `contract/test/interfaces/StrategyInterface.t.sol`

**Interfaces:**
- Produces: `IStrategyAdapter`, `IRewardAccountant`, `VaultTypes.AdapterStatus`, `VaultTypes.AdapterConfig`, `VaultTypes.PlanHeader`, and `VaultTypes.Action` for every later contract plan.

- [ ] **Step 1: Write the failing interface-shape test**

```solidity
function test_actionTypehash_isStable() public pure {
    assertEq(
        VaultTypes.ACTION_TYPEHASH,
        keccak256("Action(uint256 planId,uint32 index,uint8 kind,address adapter,uint256 amount,uint256 minOut)")
    );
}
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd contract && forge test --match-contract StrategyInterfaceTest -vv`

Expected: FAIL because the new interfaces and library do not exist.

- [ ] **Step 3: Define the exact shared boundary**

```solidity
interface IStrategyAdapter {
    function vault() external view returns (address);
    function asset() external view returns (address);
    function configurationDigest() external view returns (bytes32);
    function totalAssets() external view returns (uint256);
    function maxWithdrawable() external view returns (uint256);
    function deposit(uint256 assets) external returns (uint256 credited);
    function withdraw(uint256 assets) external returns (uint256 returnedAssets);
}

interface IRewardAccountant {
    function recognizedRewardAssets() external view returns (uint256);
    function syncForShareAction(bool issuingShares) external returns (uint256 recognizedAssets);
}
```

Define `ActionKind { Divest, Deploy }`, `AdapterStatus { None, Active, Disabled, Impaired, Removed }`, `AdapterConfig { status, capBps, absoluteCap, maxLossBps, accountingCap }`, `PlanHeader`, and `Action` in `VaultTypes.sol`. Set `ACTION_TYPEHASH` to the literal asserted by the test.

Add:

```toml
[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"
base = "${BASE_RPC_URL}"
```

- [ ] **Step 4: Run formatting and the focused test**

Run: `cd contract && forge fmt --check && forge test --match-contract StrategyInterfaceTest -vv`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract/foundry.toml contract/src/interfaces contract/src/libraries contract/test/interfaces
git commit -m "feat(contract): define Base vault strategy policy interfaces"
```

---

### Task 2: Implement ERC-4626 accounting, ownership, and adapter lifecycle

**Files:**
- Replace: `contract/src/NavyVault.sol`
- Create: `contract/test/BaseNavyVault.t.sol`
- Create: `contract/test/mocks/MockStrategyAdapter.sol`
- Create: `contract/test/mocks/MockRewardAccountant.sol`

**Interfaces:**
- Consumes: Plan 1 Task 1 shared types.
- Produces: `NavyVault.addAdapter`, `setAdapterStatus`, `setAdapterLimits`, `setRewardAccountant`, `recordImpairment`, `transferOwnership`, `acceptOwnership`, and ERC-4626 accounting used by Plans 2–7.
- Exposes: `adapterStatus`, `strategyAssets`, `configuredAdapters`, and the immutable Base USDC asset identity for monitoring and policy checks.

- [ ] **Step 1: Write lifecycle and NAV tests**

```solidity
function test_totalAssets_includesIdleStrategiesRewardsAndLoss() public {
    deal(address(usdc), address(vault), 60_000e6);
    adapter.setReportedAssets(40_000e6);
    rewardAccountant.setRecognized(500e6);
    vm.prank(admin);
    vault.recordImpairment(address(adapter), 1_000e6);
    assertEq(vault.totalAssets(), 99_500e6);
}

function test_disabledAdapterRemainsInNav() public {
    vm.prank(admin);
    vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Disabled);
    assertEq(vault.strategyAssets(address(adapter)), 40_000e6);
    assertEq(uint8(vault.adapterStatus(address(adapter))), uint8(VaultTypes.AdapterStatus.Disabled));
}
```

Cover two-step ownership, zero/mismatched asset/vault rejection, duplicate adapter rejection, active→disabled→impaired→removed transitions, removal-only-at-zero, reward accountant replacement, impairment caps, virtual-share inflation resistance, and reverting adapter reads closing `maxDeposit`/`maxMint` instead of silently minting cheap shares.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `cd contract && forge test --match-contract BaseNavyVaultTest -vv`

Expected: FAIL against the old Sepolia vault interface.

- [ ] **Step 3: Implement the minimal immutable vault core**

```solidity
contract NavyVault is ERC4626, ERC20Permit, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    address public pendingOwner;
    address public allocator;
    IRewardAccountant public rewardAccountant;
    uint256 public recognizedLosses;

    function totalAssets() public view override returns (uint256 assets_) {
        assets_ = IERC20(asset()).balanceOf(address(this));
        for (uint256 i; i < adapters.length; ++i) {
            assets_ += _recognizedStrategyAssets(adapters[i]);
        }
        if (address(rewardAccountant) != address(0)) assets_ += rewardAccountant.recognizedRewardAssets();
        return assets_ > recognizedLosses ? assets_ - recognizedLosses : 0;
    }
}
```

Use `_decimalsOffset() == 6`, explicit events for every configuration/impairment transition, and adapter `asset()`, `vault()`, and `configurationDigest()` validation at admission. Keep an adapter in enumeration until its accounted and live position are both zero.

- [ ] **Step 4: Run unit tests and the existing payment suite**

Run: `cd contract && forge test --match-contract BaseNavyVaultTest -vv && forge test --match-contract NavyPaymentsTest -q`

Expected: PASS; payment behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add contract/src/NavyVault.sol contract/test/BaseNavyVault.t.sol contract/test/mocks
git commit -m "feat(contract): add immutable Base ERC4626 vault core"
```

---

### Task 3: Enforce adapter, dependency, reserve, and aggregate-loss limits

**Files:**
- Modify: `contract/src/NavyVault.sol`
- Create: `contract/test/VaultPolicy.t.sol`
- Create: `contract/test/NavyVault.invariant.t.sol`
- Create: `contract/test/handlers/VaultPolicyHandler.sol`

**Interfaces:**
- Produces: `setAdapterLimits`, `setDependencyCap`, `setAdapterDependencies`, `setAdminIdleFloor`, `effectiveAdapterCap`, and `requiredIdle`.

- [ ] **Step 1: Write failing policy and invariant tests**

```solidity
function test_effectiveCapUsesLowestLimit() public {
    _setLimits(adapterA, 6_000, 40_000e6);
    _depositAlice(100_000e6);
    assertEq(vault.effectiveAdapterCap(address(adapterA)), 40_000e6);
}

function invariant_exposureNeverExceedsAdapterOrDependencyCaps() public view {
    assertLe(vault.strategyAssets(address(adapterA)), vault.effectiveAdapterCap(address(adapterA)));
    assertLe(vault.dependencyExposure(PROTOCOL_GROUP), vault.dependencyCap(PROTOCOL_GROUP));
}
```

Also test duplicate group membership, 100% accepted common-mode groups, absolute caps, percentage caps after NAV changes, admin floor versus plan reserve, aggregate withdrawal loss across multiple adapters, dust handling, and forbidden allocator configuration.

- [ ] **Step 2: Run tests and confirm the missing policy functions fail**

Run: `cd contract && forge test --match-path 'test/VaultPolicy.t.sol' -vv`

Expected: FAIL with missing selectors.

- [ ] **Step 3: Implement generic policy storage and checks**

```solidity
function requiredIdle() public view returns (uint256) {
    return adminIdleFloor > activePlanReserve ? adminIdleFloor : activePlanReserve;
}

function _checkExposure(address adapter, uint256 projectedAssets, uint256 nav) internal view {
    AdapterConfig memory c = adapterConfig[adapter];
    uint256 bpsCap = Math.mulDiv(nav, c.capBps, 10_000);
    if (projectedAssets > Math.min(bpsCap, c.absoluteCap)) revert AdapterCapExceeded();
    _checkEveryDependency(adapter, projectedAssets, nav);
}
```

Represent dependency IDs as `bytes32`; store adapter membership and group `capBps` plus optional absolute cap. Compute loss once across an entire withdrawal, not independently per adapter. Use `SafeERC20` for Circle USDC.

- [ ] **Step 4: Run unit, invariant, and fuzz suites**

Run: `cd contract && forge test --match-path 'test/VaultPolicy.t.sol' -vv && forge test --match-contract NavyVaultInvariantTest -vv && forge test --match-contract NavyVaultFuzzTest -vv`

Expected: PASS with at least 256 invariant runs under the repository default profile.

- [ ] **Step 5: Commit**

```bash
git add contract/src/NavyVault.sol contract/test/VaultPolicy.t.sol contract/test/NavyVault.invariant.t.sol contract/test/handlers
git commit -m "feat(contract): enforce vault exposure reserve and loss policy"
```

---

### Task 4: Add ordered, expiring staged plans and bounded emergency exits

**Files:**
- Modify: `contract/src/NavyVault.sol`
- Create: `contract/src/libraries/PlanHash.sol`
- Create: `contract/test/VaultPlans.t.sol`

**Interfaces:**
- Produces: `registerPlan(PlanHeader, bytes32 actionsRoot)`, `executeDivest(Action, bytes32[])`, `executeDeploy(Action, bytes32[])`, `cancelPlan(uint256)`, and `emergencyDivest(address,uint256,uint256)`.

- [ ] **Step 1: Write plan ordering, replay, and expiry tests**

```solidity
function test_failedDeploymentLeavesDivestedFundsIdle() public {
    uint256 planId = _registerTwoStepPlan();
    vm.prank(allocator);
    vault.executeDivest(divestAction, divestProof);
    destination.setDepositFailure(true);
    vm.prank(allocator);
    vm.expectRevert(MockStrategyAdapter.DepositFailed.selector);
    vault.executeDeploy(deployAction, deployProof);
    assertEq(usdc.balanceOf(address(vault)), divestAction.amount);
    assertEq(vault.nextActionIndex(planId), 1);
}
```

Cover wrong policy/config digest, invalid Merkle proof, skipped/replayed index, expiry, action count, minimum final assets, turnover exhaustion, reserve persistence after plan expiry, cancellation, allocator rotation, emergency exit while paused, and emergency recipient fixed to the vault.

- [ ] **Step 2: Run the plan tests and confirm failure**

Run: `cd contract && forge test --match-contract VaultPlansTest -vv`

Expected: FAIL because staged-plan selectors do not exist.

- [ ] **Step 3: Implement the committed action state machine**

```solidity
function executeDivest(VaultTypes.Action calldata action, bytes32[] calldata proof)
    external onlyAllocator nonReentrant
{
    PlanState storage plan = _validateAction(action, proof, VaultTypes.ActionKind.Divest);
    uint256 beforeAssets = IERC20(asset()).balanceOf(address(this));
    uint256 returned = IStrategyAdapter(action.adapter).withdraw(action.amount);
    uint256 delta = IERC20(asset()).balanceOf(address(this)) - beforeAssets;
    if (returned != delta || delta < action.minOut) revert LossLimitExceeded();
    _markActionConsumed(plan, action);
    plan.turnoverUsed += action.amount;
    emit PlanActionExecuted(action.planId, action.index, uint8(action.kind), action.adapter, delta);
}
```

Hash leaves with `ACTION_TYPEHASH`, verify them using OpenZeppelin `MerkleProof`, and bind `policyVersion`, snapshot hash, configuration digest, reserve, minimum final assets, turnover, action count, and expiry in the plan header. `_validateAction` performs read-only checks; `_markActionConsumed` increments only after the adapter call and balance-delta checks succeed.

- [ ] **Step 4: Run plan and invariant tests**

Run: `cd contract && forge test --match-contract VaultPlansTest -vv && forge test --match-contract NavyVaultInvariantTest -vv`

Expected: PASS; partial plans never violate reserve/cap/recipient invariants.

- [ ] **Step 5: Commit**

```bash
git add contract/src/NavyVault.sol contract/src/libraries/PlanHash.sol contract/test/VaultPlans.t.sol
git commit -m "feat(contract): execute bounded staged allocation plans"
```

---

### Task 5: Implement strict synchronous ERC-4626 withdrawals and pause semantics

**Files:**
- Modify: `contract/src/NavyVault.sol`
- Create: `contract/test/VaultLiquidity.t.sol`
- Modify: `contract/test/mocks/MockStrategyAdapter.sol`

**Interfaces:**
- Produces: conservative overrides for `maxWithdraw`, `maxRedeem`, `_withdraw`, `setWithdrawalOrder`, and `setPaused`.

- [ ] **Step 1: Write same-transaction liquidity tests**

```solidity
function test_maxWithdrawExcludesAccountingAssetsThatCannotExitNow() public {
    deal(address(usdc), address(vault), 20_000e6);
    adapter.setReportedAssets(80_000e6);
    adapter.setWithdrawable(10_000e6);
    assertEq(vault.maxWithdraw(alice), 30_000e6);
}

function test_pauseBlocksIssuanceButAllowsBoundedRedeem() public {
    vm.prank(admin);
    vault.setPaused(true);
    assertEq(vault.maxDeposit(alice), 0);
    vm.prank(alice);
    vault.redeem(vault.maxRedeem(alice), alice, alice);
}
```

Cover multiple adapters, deterministic withdrawal order, race/revert, aggregate loss, strategy cash smaller than position, reward NAV excluded from liquidity, stale accountant closing issuance, and `previewWithdraw` not being used as a liquidity assertion.

- [ ] **Step 2: Run tests and confirm current behavior overstates liquidity**

Run: `cd contract && forge test --match-contract VaultLiquidityTest -vv`

Expected: FAIL before the overrides exist.

- [ ] **Step 3: Implement liquidity-capped ERC-4626 behavior**

```solidity
function maxWithdraw(address owner_) public view override returns (uint256) {
    uint256 claim = convertToAssets(balanceOf(owner_));
    return Math.min(claim, _synchronousLiquidity());
}

function _ensureIdle(uint256 assets) internal {
    uint256 startingNav = totalAssets();
    for (uint256 i; i < withdrawalOrder.length && _idle() < assets; ++i) {
        _pullAvailable(withdrawalOrder[i], assets - _idle());
    }
    if (_idle() < assets) revert InsufficientSynchronousLiquidity();
    if (startingNav > totalAssets() && startingNav - totalAssets() > _allowedAggregateLoss(assets)) {
        revert LossLimitExceeded();
    }
}
```

Override deposit/mint/withdraw/redeem with `nonReentrant`. Issuance calls the reward-accountant freshness hook when configured. Withdrawal remains available during pause and uses only `maxWithdrawable` amounts.

- [ ] **Step 4: Run the complete contract suite**

Run: `cd contract && forge fmt --check && forge build && forge test --summary`

Expected: all non-fork tests pass; fork tests skip only when their required RPC variable is absent.

- [ ] **Step 5: Commit**

```bash
git add contract/src/NavyVault.sol contract/test/VaultLiquidity.t.sol contract/test/mocks/MockStrategyAdapter.sol
git commit -m "feat(contract): enforce synchronous ERC4626 liquidity"
```

---

### Task 6: Add Base deployment/admin scripts and ABI gates

**Files:**
- Create: `contract/script/DeployBaseVault.s.sol`
- Create: `contract/script/AdminBaseVault.s.sol`
- Modify: `contract/README.md`
- Modify: `contract/DEPLOYMENTS.md`
- Create: `contract/test/DeployBaseVault.t.sol`

**Interfaces:**
- Produces: deterministic deployment/admin commands used after Plans 2 and 3 provide concrete strategies and `RewardExecutor`.

- [ ] **Step 1: Write deployment validation tests**

```solidity
function test_deployRejectsWrongChainOrAsset() public {
    vm.chainId(11155111);
    vm.expectRevert(DeployBaseVault.WrongChain.selector);
    deployer.deployCore(BASE_USDC, admin, allocator);
}
```

Assert Base chain ID, exact Circle USDC, distinct nonzero admin/allocator, zero relayer state, and post-deployment ownership/allocator configuration.

- [ ] **Step 2: Run the deployment test and confirm failure**

Run: `cd contract && forge test --match-contract DeployBaseVaultTest -vv`

Expected: FAIL because the Base deployment script does not exist.

- [ ] **Step 3: Implement scripts with explicit environment names**

```solidity
uint256 adminPk = vm.envUint("BASE_ADMIN_PRIVATE_KEY");
address allocator = vm.envAddress("SRCLA_ALLOCATOR_ADDRESS");
address usdc = vm.envAddress("BASE_USDC_ADDRESS");
if (block.chainid != 8453) revert WrongChain();
if (usdc != 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) revert WrongAsset();
```

Document `BASE_RPC_URL`, `BASE_ADMIN_PRIVATE_KEY`, `SRCLA_ALLOCATOR_ADDRESS`, and `BASE_USDC_ADDRESS`. State that `contract/.env` is uncommitted. Leave strategy/reward addresses as outputs of Plans 2–3 rather than embedding changeable deployment addresses in source.

- [ ] **Step 4: Run all non-fork verification**

Run: `cd contract && forge fmt --check && forge build && forge test --summary`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract/script/DeployBaseVault.s.sol contract/script/AdminBaseVault.s.sol contract/test/DeployBaseVault.t.sol contract/README.md contract/DEPLOYMENTS.md
git commit -m "feat(contract): add Base vault deployment administration"
```
