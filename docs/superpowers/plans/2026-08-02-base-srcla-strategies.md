# Base SRCLA Lending Strategies Implementation Plan (Plan 2 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement immutable, vault-bound Aave V3, Compound III, and Moonwell strategies for Circle native Base USDC with exact accounting, conservative same-transaction liquidity, configuration identity, and pinned Base-fork conformance.

**Architecture:** Each strategy owns its protocol receipt position and exposes the shared `IStrategyAdapter` boundary from Plan 1. State-changing methods are callable only by `NavyVault`; withdrawals always return native USDC to the vault. Forecasting remains off-chain, but each strategy exposes enough immutable/live identity for SRCLA to reject configuration drift.

**Tech Stack:** Solidity 0.8.24, Foundry, minimal protocol interfaces copied from official sources, Base archive RPC fork tests.

## Global Constraints

- Depends on Plan 1 interfaces and vault core.
- Exact asset is Circle native Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Canonical release-one markets are Aave Pool `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`, Compound Comet `0xb125E6687d4313864e53df431d5425969c15Eb2F`, and Moonwell mUSDC `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22`.
- Strategies never borrow, enter collateral mode, redirect funds, expose arbitrary calls, or trust dashboard APY.
- Every external transfer is checked by actual native-USDC balance delta.
- Fork tests pin a block number/hash through environment variables and skip only when `BASE_RPC_URL` is absent.
- Protocol proxy/configuration changes are surfaced through `configurationDigest`; they are not silently accepted.

---

### Task 1: Add minimal official protocol interfaces and a common strategy conformance suite

**Files:**
- Create: `contract/src/interfaces/aave/IAaveV3.sol`
- Create: `contract/src/interfaces/compound/ICometBase.sol`
- Create: `contract/src/interfaces/moonwell/IMoonwell.sol`
- Create: `contract/src/strategies/BaseStrategy.sol`
- Create: `contract/test/strategies/StrategyConformance.t.sol`
- Create: `contract/test/mocks/HarnessStrategy.sol`

**Interfaces:**
- Produces: `BaseStrategy.onlyVault`, common asset/vault validation, and `StrategyConformance` assertions reused by the three strategies.

- [ ] **Step 1: Write the failing common conformance test**

```solidity
function assertCommon(IStrategyAdapter strategy) internal {
    assertEq(strategy.vault(), address(vault));
    assertEq(strategy.asset(), address(usdc));
    vm.prank(address(0xBAD));
    vm.expectRevert(BaseStrategy.NotVault.selector);
    strategy.deposit(1e6);
}
```

Add cases for zero addresses, wrong underlying, deposit credit delta, withdraw return delta, configuration digest stability, and destination fixed to the vault.

- [ ] **Step 2: Run and confirm the new imports fail**

Run: `cd contract && forge test --match-contract StrategyConformanceTest -vv`

Expected: FAIL because the interfaces/base strategy are absent.

- [ ] **Step 3: Add only the protocol selectors actually used**

```solidity
abstract contract BaseStrategy is IStrategyAdapter {
    using SafeERC20 for IERC20;
    address public immutable override vault;
    address public immutable override asset;
    error NotVault();
    modifier onlyVault() { if (msg.sender != vault) revert NotVault(); _; }
}
```

Copy signatures and return layouts from the official Aave Origin, Compound Comet, and Moonwell sources cited by the design research. Do not import whole protocol repositories or redeclare unused administration methods. `HarnessStrategy` is the minimal concrete `BaseStrategy` used by `assertCommon`.

- [ ] **Step 4: Run build and conformance tests**

Run: `cd contract && forge fmt --check && forge test --match-contract StrategyConformanceTest -vv`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract/src/interfaces/aave contract/src/interfaces/compound contract/src/interfaces/moonwell contract/src/strategies/BaseStrategy.sol contract/test/strategies contract/test/mocks/HarnessStrategy.sol
git commit -m "feat(contract): add lending strategy interfaces and conformance suite"
```

---

### Task 2: Implement `AaveV3Strategy`

**Files:**
- Create: `contract/src/strategies/AaveV3Strategy.sol`
- Create: `contract/test/strategies/AaveV3Strategy.t.sol`
- Create: `contract/test/fork/AaveV3BaseFork.t.sol`
- Create: `contract/test/mocks/MockAaveV3.sol`

**Interfaces:**
- Produces: Aave position accounting and liquidity used by NavyVault and SRCLA observation.

- [ ] **Step 1: Write unit and fork tests first**

```solidity
function test_maxWithdrawable_isMinOfPositionAndATokenCash() public {
    venue.setPosition(80_000e6);
    venue.setCash(12_000e6);
    assertEq(strategy.maxWithdrawable(), 12_000e6);
}

function testFork_supplyAndWithdrawRoundTrip() public baseFork {
    deal(BASE_USDC, address(vault), 10_000e6);
    vault.deployForTest(address(strategy), 10_000e6);
    assertApproxEqAbs(strategy.totalAssets(), 10_000e6, 2);
    vault.divestForTest(address(strategy), strategy.maxWithdrawable());
}
```

Also test active/frozen/paused distinctions, aToken underlying identity, scaled/indexed accounting, exact vault recipient, zero allowance after deposit, and configuration digest changes when the registered rate strategy or implementation changes.

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd contract && forge test --match-path 'test/strategies/AaveV3Strategy.t.sol' -vv`

Expected: FAIL because `AaveV3Strategy` does not exist.

- [ ] **Step 3: Implement Aave supply, withdrawal, value, and identity**

```solidity
function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
    uint256 beforeAssets = totalAssets();
    IERC20(asset).forceApprove(address(pool), assets);
    pool.supply(asset, assets, address(this), 0);
    IERC20(asset).forceApprove(address(pool), 0);
    credited = totalAssets() - beforeAssets;
}

function maxWithdrawable() public view returns (uint256) {
    return Math.min(totalAssets(), IERC20(asset).balanceOf(address(aToken)));
}
```

Use the live liquidity index and scaled balance according to the deployed aToken interface; do not approximate with a cached principal. `configurationDigest` binds Pool, addresses provider, aToken, variable debt token, incentives controller, registered strategy, and relevant implementation addresses.

- [ ] **Step 4: Run unit then pinned fork tests**

Run: `cd contract && forge test --match-contract AaveV3StrategyTest -vv`

Run with archive RPC: `cd contract && source .env && BASE_FORK_BLOCK=49436925 forge test --match-contract AaveV3BaseForkTest -vv`

Expected: PASS; the fork test verifies native-USDC identity and exact supply/withdraw behavior.

- [ ] **Step 5: Commit**

```bash
git add contract/src/strategies/AaveV3Strategy.sol contract/test/strategies/AaveV3Strategy.t.sol contract/test/fork/AaveV3BaseFork.t.sol contract/test/mocks/MockAaveV3.sol
git commit -m "feat(contract): add Base Aave V3 USDC strategy"
```

---

### Task 3: Replace the Sepolia adapter with `CompoundV3Strategy`

**Files:**
- Create: `contract/src/strategies/CompoundV3Strategy.sol`
- Delete: `contract/src/adapters/CompoundAdapter.sol`
- Create: `contract/test/strategies/CompoundV3Strategy.t.sol`
- Create: `contract/test/fork/CompoundV3BaseFork.t.sol`
- Create: `contract/test/mocks/MockCometBase.sol`
- Retire: `contract/test/CompoundAdapterFork.t.sol`

**Interfaces:**
- Produces: positive-base-balance-only Comet integration.

- [ ] **Step 1: Write the no-borrow and cash-bound tests**

```solidity
function test_withdrawNeverCrossesIntoBorrow() public {
    comet.setPositiveBalance(address(strategy), 100e6);
    vm.prank(address(vault));
    vm.expectRevert(CompoundV3Strategy.ExceedsPositiveBalance.selector);
    strategy.withdraw(101e6);
}

function test_maxWithdrawable_usesCometCash() public {
    comet.setPositiveBalance(address(strategy), 500e6);
    usdc.mint(address(comet), 120e6);
    assertEq(strategy.maxWithdrawable(), 120e6);
}
```

Test withdrawal pause, exact principal/present-value rounding, full-exit dust, `baseToken()` mismatch, and proxy/extension/configuration digest.

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd contract && forge test --match-contract CompoundV3StrategyTest -vv`

Expected: FAIL before the new strategy exists.

- [ ] **Step 3: Implement bounded Comet operations**

```solidity
function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
    uint256 positive = comet.balanceOf(address(this));
    if (assets > positive) revert ExceedsPositiveBalance();
    if (comet.isWithdrawPaused()) revert WithdrawPaused();
    uint256 beforeAssets = IERC20(asset).balanceOf(vault);
    comet.withdrawTo(vault, asset, assets);
    returnedAssets = IERC20(asset).balanceOf(vault) - beforeAssets;
}
```

Supply with exact allowance/reset. `maxWithdrawable` is `min(positive Comet balance, USDC.balanceOf(Comet))`. Do not apply collateral supply caps to base USDC.

- [ ] **Step 4: Run unit and pinned Base-fork tests**

Run: `cd contract && forge test --match-contract CompoundV3StrategyTest -vv`

Run: `cd contract && source .env && BASE_FORK_BLOCK=49436925 forge test --match-contract CompoundV3BaseForkTest -vv`

Expected: PASS with positive balance after supply and no borrow after full allowed withdrawal.

- [ ] **Step 5: Commit**

```bash
git add contract/src/strategies/CompoundV3Strategy.sol contract/test/strategies/CompoundV3Strategy.t.sol contract/test/fork/CompoundV3BaseFork.t.sol contract/test/mocks/MockCometBase.sol contract/src/adapters/CompoundAdapter.sol contract/test/CompoundAdapterFork.t.sol
git commit -m "feat(contract): replace Sepolia adapter with Base Compound V3 strategy"
```

---

### Task 4: Implement `MoonwellStrategy`

**Files:**
- Create: `contract/src/strategies/MoonwellStrategy.sol`
- Create: `contract/test/strategies/MoonwellStrategy.t.sol`
- Create: `contract/test/fork/MoonwellBaseFork.t.sol`
- Create: `contract/test/mocks/MockMoonwell.sol`

**Interfaces:**
- Produces: mUSDC exchange-rate accounting, no-collateral invariant, and numeric-error-safe mint/redeem.

- [ ] **Step 1: Write numeric-error, rounding, and cash tests**

```solidity
function test_nonzeroRedeemCodeIsFailure() public {
    mUsdc.setRedeemCode(14);
    vm.prank(address(vault));
    vm.expectRevert(abi.encodeWithSelector(MoonwellStrategy.ProtocolError.selector, 14));
    strategy.withdraw(1e6);
}

function test_positionUsesEightDecimalMTokenExchangeRate() public {
    mUsdc.setBalance(address(strategy), 25e8);
    mUsdc.setExchangeRate(4e16);
    assertEq(strategy.totalAssets(), 1e6);
}
```

Test mint error codes, strict supply-cap headroom, no `enterMarkets`, no borrow, stale stored exchange-rate handling, `getCash` bound, and implementation/interest-model/comptroller digest changes.

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd contract && forge test --match-contract MoonwellStrategyTest -vv`

Expected: FAIL because the strategy is absent.

- [ ] **Step 3: Implement exact mUSDC handling**

```solidity
function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
    uint256 beforeAssets = totalAssets();
    IERC20(asset).forceApprove(address(mToken), assets);
    uint256 code = mToken.mint(assets);
    IERC20(asset).forceApprove(address(mToken), 0);
    if (code != 0) revert ProtocolError(code);
    credited = totalAssets() - beforeAssets;
}
```

Use `exchangeRateCurrent` through a static simulation for executable paths and reproduce current exchange-rate math for view-safe accounting. Bound `maxWithdrawable` by `min(position, getCash())` and use redeem-underlying with numeric result checks.

- [ ] **Step 4: Run unit and pinned Base-fork tests**

Run: `cd contract && forge test --match-contract MoonwellStrategyTest -vv`

Run: `cd contract && source .env && BASE_FORK_BLOCK=49436925 forge test --match-contract MoonwellBaseForkTest -vv`

Expected: PASS; fork proves `underlying() == BASE_USDC`, no collateral membership, and round-trip within registered dust.

- [ ] **Step 5: Commit**

```bash
git add contract/src/strategies/MoonwellStrategy.sol contract/test/strategies/MoonwellStrategy.t.sol contract/test/fork/MoonwellBaseFork.t.sol contract/test/mocks/MockMoonwell.sol
git commit -m "feat(contract): add Base Moonwell USDC strategy"
```

---

### Task 5: Add cross-strategy fork vectors and deployment identity manifest

**Files:**
- Create: `contract/test/fork/BaseStrategyIdentityFork.t.sol`
- Create: `contract/config/base-strategies.json`
- Create: `contract/test/fixtures/base-rate-vectors.json`
- Modify: `contract/script/DeployBaseVault.s.sol`
- Modify: `contract/DEPLOYMENTS.md`
- Modify: `contract/README.md`

**Interfaces:**
- Produces: machine-readable canonical market inputs consumed by deployment and mirrored by `/srcla` Plan 4.

- [ ] **Step 1: Write the manifest identity test**

```solidity
function testFork_manifestMatchesLiveRelationships() public baseFork {
    assertEq(IAaveAToken(AAVE_AUSDC).UNDERLYING_ASSET_ADDRESS(), BASE_USDC);
    assertEq(ICometBase(COMET).baseToken(), BASE_USDC);
    assertEq(IMToken(MUSDC).underlying(), BASE_USDC);
}
```

Assert exact proxy relationships and record live implementation/code hashes in test output without compiling them as permanent constants.

- [ ] **Step 2: Run before manifest creation and confirm failure**

Run: `cd contract && source .env && BASE_FORK_BLOCK=49436925 forge test --match-contract BaseStrategyIdentityForkTest -vv`

Expected: FAIL because the manifest/constants are absent.

- [ ] **Step 3: Add the exact Base registry**

```json
{
  "chainId": 8453,
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "aavePool": "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  "compoundComet": "0xb125E6687d4313864e53df431d5425969c15Eb2F",
  "moonwellMUsdc": "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22"
}
```

Deployment reads and validates this registry, deploys the three strategies against the new vault, and admits them initially as `Disabled`. Admin activation occurs only after the same-block identity and conformance tests pass. Generate `base-rate-vectors.json` from pinned fork reads for zero, below-kink, kink, above-kink, cap, withdrawal-liquidity, and rounding cases; each row stores raw inputs and exact expected integer outputs consumed by Plan 5.

- [ ] **Step 4: Run the full strategy and identity suite**

Run: `cd contract && source .env && forge fmt --check && forge build && BASE_FORK_BLOCK=49436925 forge test --match-path 'test/fork/*' --summary`

Expected: all Base fork tests pass at the pinned block.

- [ ] **Step 5: Commit**

```bash
git add contract/config/base-strategies.json contract/test/fixtures/base-rate-vectors.json contract/test/fork/BaseStrategyIdentityFork.t.sol contract/script/DeployBaseVault.s.sol contract/DEPLOYMENTS.md contract/README.md
git commit -m "test(contract): pin Base lending strategy identities"
```
