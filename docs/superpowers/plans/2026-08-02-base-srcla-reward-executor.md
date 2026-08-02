# Base SRCLA Reward Accounting and Execution Implementation Plan (Plan 3 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conservative incentive-reward NAV accounting and event-driven, economically gated claim-and-swap execution through an immutable shared Uniswap V3 executor without confusing incentive tokens with automatically accrued lending interest.

**Architecture:** Strategies continue to account base interest through their receipt positions. A shared `RewardExecutor` maintains admin-approved reward/feed/Uniswap route records, lazily recognizes claimable plus held incentives in USDC NAV, and atomically claims/swaps when possible. The allocator chooses only a route ID and bounded amounts; tokens and USDC never enter allocator custody.

**Tech Stack:** Solidity 0.8.24, Foundry, Chainlink AggregatorV3, Uniswap V3 SwapRouter02/Factory/Quoter interfaces, Base fork tests.

## Global Constraints

- Depends on Plans 1 and 2.
- Release one supports Uniswap V3 only; no Aerodrome, aggregators, Permit2/AllowanceHolder, arbitrary calldata, private order flow, or asynchronous intents.
- Output token and recipient are fixed to Circle native Base USDC and `NavyVault`.
- Reward tokens count only when on-chain emission/claimability, funding, Chainlink feeds, and an approved executable route all pass.
- Off-chain, expired, underfunded, stale, or unrouteable incentives contribute zero new NAV and zero forecast return.
- Exact allowance is granted for each harvest and reset to zero; its gas belongs in the off-chain economic gate.
- Reward NAV never increases synchronous `maxWithdraw`.
- Base interest in aUSDC, Comet, and mUSDC is not harvested.

---

### Task 1: Define reward sources, routes, and executor registry

**Files:**
- Create: `contract/src/interfaces/IRewardSource.sol`
- Create: `contract/src/interfaces/chainlink/IAggregatorV3.sol`
- Create: `contract/src/interfaces/uniswap/IUniswapV3.sol`
- Create: `contract/src/RewardExecutor.sol`
- Create: `contract/test/RewardExecutorRegistry.t.sol`
- Create: `contract/test/mocks/MockRewardSource.sol`

**Interfaces:**
- Produces: `RewardExecutor.RewardPolicy`, `Route`, `setRewardPolicy`, `setRoute`, `disableRoute`, and `quoteOracleFloor`.

- [ ] **Step 1: Write registry authorization and identity tests**

```solidity
function test_allocatorCannotRegisterArbitraryRoute() public {
    vm.prank(allocator);
    vm.expectRevert(RewardExecutor.NotAdmin.selector);
    executor.setRoute(routeId, route);
}

function test_routeMustEndInVaultAsset() public {
    route.path = abi.encodePacked(WELL, uint24(10_000), WETH);
    vm.prank(admin);
    vm.expectRevert(RewardExecutor.WrongOutputAsset.selector);
    executor.setRoute(routeId, route);
}
```

Cover canonical factory/router, exact token path, pool existence/token identity, maximum hops, feed identity, nonzero limits, route disable, and adapter/reward-token tuple registration.

- [ ] **Step 2: Run and confirm failure**

Run: `cd contract && forge test --match-contract RewardExecutorRegistryTest -vv`

Expected: FAIL because executor and interfaces are absent.

- [ ] **Step 3: Implement immutable executor identity plus mutable admitted registry**

```solidity
constructor(address vault_, address admin_, address router_, address factory_) {
    if (vault_ == address(0) || admin_ == address(0)) revert ZeroAddress();
    vault = vault_;
    admin = admin_;
    router = ISwapRouter02(router_);
    factory = IUniswapV3Factory(factory_);
}
```

`RewardPolicy` binds adapter, reward token, reward/USD feed, USDC/USD feed, feed ages, haircut, accounting cap, maximum harvest input, daily USDC notional, and enabled flag. `Route` binds input token, encoded V3 path, pool identities/fees, maximum oracle deviation, maximum price impact, and enabled flag.

- [ ] **Step 4: Run registry tests and static analysis build**

Run: `cd contract && forge fmt --check && forge test --match-contract RewardExecutorRegistryTest -vv`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract/src/RewardExecutor.sol contract/src/interfaces/IRewardSource.sol contract/src/interfaces/chainlink contract/src/interfaces/uniswap contract/test/RewardExecutorRegistry.t.sol contract/test/mocks/MockRewardSource.sol
git commit -m "feat(contract): add bounded reward executor registry"
```

---

### Task 2: Implement lazy conservative reward NAV

**Files:**
- Modify: `contract/src/RewardExecutor.sol`
- Modify: `contract/src/NavyVault.sol`
- Create: `contract/test/RewardAccounting.t.sol`
- Create: `contract/test/mocks/MockAggregatorV3.sol`

**Interfaces:**
- Produces the `IRewardAccountant` implementation consumed by `NavyVault`.

- [ ] **Step 1: Write temporal-fairness, freshness, and cap tests**

```solidity
function test_lateDepositorPaysForRecognizedPreexistingRewards() public {
    source.setClaimable(WELL, 1_000e18);
    wellUsd.setAnswer(5e6, block.timestamp);
    usdcUsd.setAnswer(1e8, block.timestamp);
    executor.syncForShareAction(true);
    uint256 shares = vault.previewDeposit(100e6);
    assertLt(shares, 100e12);
}

function test_staleFeedClosesIssuanceAndCannotRaiseNav() public {
    wellUsd.setUpdatedAt(block.timestamp - MAX_AGE - 1);
    assertEq(vault.maxDeposit(alice), 0);
    assertLe(executor.recognizedRewardAssets(), lastRecognized);
}
```

Cover negative/zero answers, `answeredInRound`, decimals conversion, token/feed mismatch, claimable plus held balance, haircut, absolute cap, cache age/materiality, multiple streams, invalid source contributing zero, and rewards excluded from `maxWithdraw`.

- [ ] **Step 2: Run and confirm failure**

Run: `cd contract && forge test --match-contract RewardAccountingTest -vv`

Expected: FAIL because accounting sync is not implemented.

- [ ] **Step 3: Implement conservative value and vault freshness hook**

```solidity
function _conservativeUsdcValue(RewardPolicy memory p, uint256 rewardAmount) internal view returns (uint256) {
    uint256 rewardUsd = _freshPositiveAnswer(p.rewardUsdFeed, p.maxRewardFeedAge);
    uint256 usdcUsd = _freshPositiveAnswer(p.usdcUsdFeed, p.maxUsdcFeedAge);
    uint256 gross = _scaleToUsdc(rewardAmount, rewardUsd, usdcUsd, p.rewardDecimals);
    return Math.min(Math.mulDiv(gross, 10_000 - p.haircutBps, 10_000), p.accountingCap);
}
```

`syncForShareAction(true)` reverts with `UnsafeRewardValuation` when a material registered source cannot be refreshed, making vault `maxDeposit/maxMint` zero. For withdrawals, no stale input may increase the last recognized value; rewards remain excluded from `_synchronousLiquidity`.

- [ ] **Step 4: Run accounting and vault liquidity suites**

Run: `cd contract && forge test --match-contract RewardAccountingTest -vv && forge test --match-contract VaultLiquidityTest -vv`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract/src/RewardExecutor.sol contract/src/NavyVault.sol contract/test/RewardAccounting.t.sol contract/test/mocks/MockAggregatorV3.sol
git commit -m "feat(contract): account incentive rewards conservatively"
```

---

### Task 3: Implement exact-allowance Uniswap V3 harvesting

**Files:**
- Modify: `contract/src/RewardExecutor.sol`
- Create: `contract/test/RewardHarvest.t.sol`
- Create: `contract/test/mocks/MockSwapRouter02.sol`

**Interfaces:**
- Produces: `harvest(address adapter, address rewardToken, bytes32 routeId, uint256 amountIn, uint256 minOut, uint256 deadline, bytes32 decisionHash)`.

- [ ] **Step 1: Write recipient, oracle-floor, allowance, and atomicity tests**

```solidity
function test_harvestResetsAllowanceAndSendsOnlyUsdcToVault() public {
    source.setClaimable(WELL, 100e18);
    vm.prank(allocator);
    uint256 out = executor.harvest(address(source), WELL, routeId, 100e18, 45e6, block.timestamp + 60, decisionHash);
    assertEq(IERC20(WELL).allowance(address(executor), address(router)), 0);
    assertEq(usdc.balanceOf(address(vault)), out);
    assertEq(well.balanceOf(allocator), 0);
}
```

Cover allocator-only, disabled/wrong route, amount cap, daily cap, short deadline, stale oracle, `minOut` below oracle floor, router short output, wrong balance delta, replayed decision hash, failed swap reverting claim, and no arbitrary recipient.

- [ ] **Step 2: Run and confirm failure**

Run: `cd contract && forge test --match-contract RewardHarvestTest -vv`

Expected: FAIL before `harvest` exists.

- [ ] **Step 3: Implement bounded claim and exact-input swap**

```solidity
uint256 beforeUsdc = IERC20(usdc).balanceOf(vault);
uint256 claimed = IRewardSource(adapter).claimReward(rewardToken, amountIn);
IERC20(rewardToken).forceApprove(address(router), claimed);
router.exactInput(ISwapRouter02.ExactInputParams({
    path: route.path,
    recipient: vault,
    amountIn: claimed,
    amountOutMinimum: Math.max(minOut, oracleFloor)
}));
IERC20(rewardToken).forceApprove(address(router), 0);
uint256 received = IERC20(usdc).balanceOf(vault) - beforeUsdc;
if (received < Math.max(minOut, oracleFloor)) revert InsufficientOutput();
```

Persist spent daily notional by UTC day index, mark `decisionHash` consumed, recompute reward cache from actual remaining balances, and emit quote/oracle/actual fields required for evaluation.

- [ ] **Step 4: Run harvest, accounting, and invariant tests**

Run: `cd contract && forge test --match-contract RewardHarvestTest -vv && forge test --match-contract RewardAccountingTest -vv && forge test --match-contract NavyVaultInvariantTest -vv`

Expected: PASS; no fuzzed allocator action transfers reward or USDC to the allocator.

- [ ] **Step 5: Commit**

```bash
git add contract/src/RewardExecutor.sol contract/test/RewardHarvest.t.sol contract/test/mocks/MockSwapRouter02.sol
git commit -m "feat(contract): harvest rewards through bounded Uniswap V3 routes"
```

---

### Task 4: Add protocol-specific claim sources to the three strategies

**Files:**
- Modify: `contract/src/strategies/AaveV3Strategy.sol`
- Modify: `contract/src/strategies/CompoundV3Strategy.sol`
- Modify: `contract/src/strategies/MoonwellStrategy.sol`
- Create: `contract/test/strategies/StrategyRewards.t.sol`

**Interfaces:**
- Each strategy implements `IRewardSource.rewardTokens`, `claimableReward`, and `claimReward` callable only by `RewardExecutor`.

- [ ] **Step 1: Write claim-identity and funding tests**

```solidity
function test_compoundZeroSpeedRewardIsNotEligible() public {
    comet.setBaseTrackingSupplySpeed(0);
    assertEq(compound.claimableReward(COMP), 0);
}

function test_moonwellExpiredStreamReturnsZero() public {
    distributor.setEndTime(WELL, block.timestamp - 1);
    assertEq(moonwell.claimableReward(WELL), 0);
}
```

Cover Aave distribution end and transfer strategy, Compound reward config/speed/minimum/funding, Moonwell multiple streams/end/funding/pause, exact token identity, executor-only claim, and claimed tokens retained by the strategy until the executor pulls the exact amount.

- [ ] **Step 2: Run and confirm failure**

Run: `cd contract && forge test --match-contract StrategyRewardsTest -vv`

Expected: FAIL because strategies do not implement reward-source methods.

- [ ] **Step 3: Implement exact protocol claim semantics**

```solidity
function claimReward(address token, uint256 maxAmount) external onlyRewardExecutor returns (uint256 claimed) {
    if (!_eligibleReward(token)) return 0;
    uint256 beforeBalance = IERC20(token).balanceOf(address(this));
    _claimFromProtocol(token);
    claimed = Math.min(IERC20(token).balanceOf(address(this)) - beforeBalance, maxAmount);
    IERC20(token).safeTransfer(rewardExecutor, claimed);
}
```

Do not count stored nonzero speeds after an end timestamp. Aave Merit-like off-chain campaigns remain excluded. Native Base WELL is keyed by full address, not the ambiguous label `xWELL`.

- [ ] **Step 4: Run strategy reward and base-position suites**

Run: `cd contract && forge test --match-contract StrategyRewardsTest -vv && forge test --match-path 'test/strategies/*Strategy.t.sol' --summary`

Expected: PASS; reward additions do not alter base interest accounting.

- [ ] **Step 5: Commit**

```bash
git add contract/src/strategies contract/test/strategies/StrategyRewards.t.sol
git commit -m "feat(contract): claim verified lending incentive rewards"
```

---

### Task 5: Add Base-fork reward/oracle/Uniswap conformance and full-stack deployment

**Files:**
- Create: `contract/test/fork/BaseRewardExecutorFork.t.sol`
- Create: `contract/config/base-reward-routes.json`
- Modify: `contract/script/DeployBaseVault.s.sol`
- Modify: `contract/script/AdminBaseVault.s.sol`
- Modify: `contract/DEPLOYMENTS.md`
- Modify: `contract/README.md`

**Interfaces:**
- Produces deployed vault, executor, three strategy addresses, and initial disabled route/policy records for `/srcla` configuration.

- [ ] **Step 1: Write pinned fork assertions**

```solidity
function testFork_liveRewardStateAndRouteIdentity() public baseFork {
    assertEq(ICometBase(COMET).baseTrackingSupplySpeed(), 0);
    assertEq(IERC20(COMP).balanceOf(COMET_REWARDS), 0);
    assertEq(IUniswapV3Pool(WELL_WETH_POOL).factory(), UNISWAP_V3_FACTORY);
    assertEq(IUniswapV3Pool(WETH_USDC_POOL).factory(), UNISWAP_V3_FACTORY);
}
```

Use the research-pinned block for fixture evidence, then separately test the latest chosen deployment block. Verify full Chainlink proxy identities from the official registry, feed descriptions/decimals/fresh rounds, V3 factory→pool mappings, token order, quote, exact-input swap, claim funding, and Base L1/L2 gas fields.

- [ ] **Step 2: Run and confirm missing route manifest failure**

Run: `cd contract && source .env && BASE_FORK_BLOCK=49437605 forge test --match-contract BaseRewardExecutorForkTest -vv`

Expected: FAIL before the manifest and fork harness exist.

- [ ] **Step 3: Create the route manifest and complete deployment wiring**

Store chain ID, exact token/feed/router/factory/path/pool/fee identities, admission block/hash, and code hashes in `base-reward-routes.json`. Deployment order is vault → reward executor → three strategies → vault accountant/adapter configuration. Strategies and routes start disabled; admin scripts activate them only after fork conformance succeeds at the activation block.

```solidity
RewardExecutor executor = new RewardExecutor(address(vault), admin, UNISWAP_V3_ROUTER, UNISWAP_V3_FACTORY);
vault.setRewardAccountant(address(executor));
```

- [ ] **Step 4: Run complete contract verification**

Run: `cd contract && forge fmt --check && forge build && forge test --summary`

Run with archive RPC: `cd contract && source .env && BASE_FORK_BLOCK=49437605 forge test --match-path 'test/fork/*' --summary`

Expected: all unit/invariant tests and all pinned fork tests pass.

- [ ] **Step 5: Commit**

```bash
git add contract/test/fork/BaseRewardExecutorFork.t.sol contract/config/base-reward-routes.json contract/script/DeployBaseVault.s.sol contract/script/AdminBaseVault.s.sol contract/DEPLOYMENTS.md contract/README.md
git commit -m "feat(contract): verify and deploy Base reward execution"
```
