# NavyVault Contracts Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the on-chain layer of the rebalancing farming vault — a pooled ERC-4626 `NavyVault` over Circle Sepolia USDC with gasless EIP-3009 deposits, gasless ERC-2612-permit redemptions, and a constrained ALLOCATOR-only rebalance path across pluggable `Compound` and `Morpho` yield adapters — deployed to Sepolia with its ABI copied into `be/`.

**Architecture:** `NavyVault` (OpenZeppelin `ERC4626` + `ERC20Permit` + `ReentrancyGuard`, custom `owner`/`relayers`/`allocators` roles mirroring `NavyPayments`) holds all USDC and mints `navUSDC` shares. It reads live per-venue APY and total assets through an `IYieldAdapter` allowlist; the ALLOCATOR keeper moves funds between adapters under on-chain caps (`capBps`), a liquidity buffer (`minIdleBps`), and a withdrawal loss bound (`maxLossBps`). Two concrete adapters wrap Compound III (Comet) and Morpho Blue.

**Tech Stack:** Foundry (Solidity 0.8.24), OpenZeppelin Contracts v5, morpho-blue interfaces/libs, Circle Sepolia USDC (EIP-3009 + EIP-2612).

**Scope note:** This is Plan 1 of 3. Plan 2 (backend `/vault/*` BFF + keeper + watcher + DB) and Plan 3 (removal of dead subwallet/crypto code + AI-assistant repoint + fe/expo screens) are written **after** this plan lands, because they need the deployed address, final ABI, and resolved Morpho `marketParams`. Spec: `docs/superpowers/specs/2026-07-28-navy-vault-rebalancing-farming-design.md`.

**Conventions to follow (from the existing `contract/` app):**
- Custom `error` types + `revert`, not `require` strings (see `NavyPayments.sol`).
- No SafeERC20 — Circle USDC reverts on failed transfers; return values unchecked by design.
- `owner` + role mappings with `onlyOwner`/`onlyRelayer` modifiers (mirror `NavyPayments`).
- Unit tests use `test/mocks/MockUSDC.sol` (EIP-3009, `name="USDC"`, `version="2"`); real protocols use Sepolia-fork tests gated on `SEPOLIA_RPC_URL`.
- `forge fmt` line length 120; `solc 0.8.24`, optimizer 200 runs.

---

### Task 0: Install dependencies and remappings

**Files:**
- Modify: `contract/remappings.txt` (create content)
- Modify: `contract/.gitmodules` (via `forge install`)

- [ ] **Step 1: Install OpenZeppelin Contracts v5 and morpho-blue**

Run (from `contract/`):
```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
forge install morpho-org/morpho-blue --no-commit
```
Expected: two new dirs under `contract/lib/` (`openzeppelin-contracts`, `morpho-blue`), `.gitmodules` updated.

- [ ] **Step 2: Write remappings**

Write `contract/remappings.txt`:
```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
@morpho-blue/=lib/morpho-blue/src/
forge-std/=lib/forge-std/src/
```

- [ ] **Step 3: Verify it compiles**

Run: `forge build`
Expected: compiles the existing `NavyPayments` plus the new libs with no errors.

- [ ] **Step 4: Commit**

```bash
git add contract/remappings.txt contract/.gitmodules contract/lib
git commit -m "chore(contract): add OpenZeppelin v5 + morpho-blue deps for NavyVault"
```

---

### Task 1: `IYieldAdapter` interface

**Files:**
- Create: `contract/src/interfaces/IYieldAdapter.sol`

- [ ] **Step 1: Write the interface**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev A yield venue behind the vault. The adapter is the on-chain position holder
/// (it is `msg.sender` to the underlying protocol). The vault sends USDC to the adapter
/// before calling `deposit`, and `withdraw` returns USDC to `to`. All state-changing
/// methods are `onlyVault`.
interface IYieldAdapter {
    /// @dev Supply `amount` of the vault asset already transferred to this adapter.
    function deposit(uint256 amount) external;

    /// @dev Redeem `amount` of the vault asset from the venue and send it to `to`.
    function withdraw(uint256 amount, address to) external;

    /// @dev Current value of this adapter's position, denominated in the vault asset.
    function totalAssets() external view returns (uint256);

    /// @dev Annualized supply rate, 1e18-scaled (e.g. 5% APR == 5e16). Simple APR, not compounded.
    function supplyRatePerYear() external view returns (uint256);

    /// @dev The vault asset (Circle USDC).
    function asset() external view returns (address);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `forge build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add contract/src/interfaces/IYieldAdapter.sol
git commit -m "feat(contract): IYieldAdapter interface"
```

---

### Task 2: `MockYieldAdapter` test double

**Files:**
- Create: `contract/test/mocks/MockYieldAdapter.sol`

A minimal adapter that holds USDC directly and reports a settable APR, so the vault's accounting/rebalance logic can be unit-tested without a live protocol.

- [ ] **Step 1: Write the mock**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../../src/interfaces/IYieldAdapter.sol";

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Holds deposited USDC in its own balance (1:1, no yield accrual) and returns a
/// configurable supply rate. `totalAssets` == its USDC balance. For vault unit tests only.
contract MockYieldAdapter is IYieldAdapter {
    address public immutable vault;
    address public immutable assetToken;
    uint256 public rate; // 1e18-scaled APR

    error NotVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _asset, uint256 _rate) {
        vault = _vault;
        assetToken = _asset;
        rate = _rate;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function deposit(uint256) external onlyVault {
        // USDC already transferred in by the vault; nothing else to do (held 1:1).
    }

    function withdraw(uint256 amount, address to) external onlyVault {
        IERC20Min(assetToken).transfer(to, amount);
    }

    function totalAssets() external view returns (uint256) {
        return IERC20Min(assetToken).balanceOf(address(this));
    }

    function supplyRatePerYear() external view returns (uint256) {
        return rate;
    }

    function asset() external view returns (address) {
        return assetToken;
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `forge build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add contract/test/mocks/MockYieldAdapter.sol
git commit -m "test(contract): MockYieldAdapter test double"
```

---

### Task 3: `NavyVault` skeleton — ERC-4626 core, roles, adapter management

**Files:**
- Create: `contract/src/NavyVault.sol`
- Create: `contract/test/NavyVault.t.sol`

- [ ] **Step 1: Write the failing test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NavyVaultTest is Test {
    NavyVault vault;
    MockUSDC usdc;
    MockYieldAdapter adapterA;
    MockYieldAdapter adapterB;

    address owner = address(0x0111);
    address relayer = address(0x0333);
    address allocator = address(0x0A11);
    address alice = address(0xA11CE);

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        vault = new NavyVault(IERC20(address(usdc)), owner);
        vm.startPrank(owner);
        vault.setRelayer(relayer, true);
        vault.setAllocator(allocator, true);
        adapterA = new MockYieldAdapter(address(vault), address(usdc), 3e16); // 3% APR
        adapterB = new MockYieldAdapter(address(vault), address(usdc), 5e16); // 5% APR
        vault.addAdapter(address(adapterA), 5000, 10000); // target 50%, cap 100%
        vault.addAdapter(address(adapterB), 5000, 10000);
        vault.setParams(1000, 50); // minIdleBps 10%, maxLossBps 0.5%
        vm.stopPrank();
    }

    function test_constructor_metadata() public view {
        assertEq(vault.name(), "Navy Vault USDC");
        assertEq(vault.symbol(), "navUSDC");
        assertEq(vault.owner(), owner);
        assertEq(vault.asset(), address(usdc));
    }

    function test_addAdapter_registersAndTracks() public view {
        assertEq(vault.adapterCount(), 2);
        (bool exists, uint16 targetBps, uint16 capBps) = vault.adapterInfo(address(adapterA));
        assertTrue(exists);
        assertEq(targetBps, 5000);
        assertEq(capBps, 10000);
    }

    function test_addAdapter_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.addAdapter(address(0xdead), 5000, 10000);
    }

    function test_removeAdapter_requiresEmpty() public {
        // adapterA has zero assets, so removal succeeds.
        vm.prank(owner);
        vault.removeAdapter(address(adapterA));
        assertEq(vault.adapterCount(), 1);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-contract NavyVaultTest -vv`
Expected: FAIL — `NavyVault.sol` does not exist / does not compile.

- [ ] **Step 3: Write the vault skeleton**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IYieldAdapter} from "./interfaces/IYieldAdapter.sol";

/// @title NavyVault — pooled ERC-4626 farming vault with allocator-driven rebalancing.
/// @dev Shares (navUSDC) are ERC20Permit so redemptions can be relayed gaslessly. Deposits are
/// gasless via EIP-3009 (see depositWithAuthorization). The ALLOCATOR keeper may only move funds
/// between allowlisted adapters under on-chain caps; it can never send funds to an EOA.
contract NavyVault is ERC4626, ERC20Permit, ReentrancyGuard {
    struct AdapterInfo {
        bool exists;
        uint16 targetBps; // desired share of totalAssets (advisory; keeper reads it)
        uint16 capBps; // hard max share of totalAssets this adapter may hold
    }

    address public owner;
    mapping(address => bool) public relayers;
    mapping(address => bool) public allocators;

    address[] public adapters;
    mapping(address => AdapterInfo) public adapterInfo;

    uint16 public minIdleBps; // fraction of totalAssets kept liquid in the vault
    uint16 public maxLossBps; // max acceptable shortfall when pulling from an adapter

    event RelayerSet(address indexed relayer, bool allowed);
    event AllocatorSet(address indexed allocator, bool allowed);
    event AdapterAdded(address indexed adapter, uint16 targetBps, uint16 capBps);
    event AdapterRemoved(address indexed adapter);
    event TargetsSet(address indexed adapter, uint16 targetBps, uint16 capBps);
    event ParamsSet(uint16 minIdleBps, uint16 maxLossBps);
    event Deployed(address indexed adapter, uint256 amount);
    event Divested(address indexed adapter, uint256 received);
    event Reallocated(address indexed from, address indexed to, uint256 amount);

    error NotOwner();
    error NotRelayer();
    error NotAllocator();
    error ZeroAddress();
    error AdapterExists();
    error UnknownAdapter();
    error AdapterNotEmpty();
    error BpsTooHigh();
    error IdleBufferBreached();
    error CapExceeded();
    error LossTooHigh();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    modifier onlyAllocator() {
        if (!allocators[msg.sender]) revert NotAllocator();
        _;
    }

    constructor(IERC20 _usdc, address _owner)
        ERC20("Navy Vault USDC", "navUSDC")
        ERC4626(_usdc)
        ERC20Permit("Navy Vault USDC")
    {
        if (address(_usdc) == address(0) || _owner == address(0)) revert ZeroAddress();
        owner = _owner;
    }

    // --- ERC-4626 overrides ---

    /// @dev Total assets = idle USDC held by the vault + the sum of every adapter's position.
    function totalAssets() public view override returns (uint256 total) {
        total = IERC20(asset()).balanceOf(address(this));
        uint256 n = adapters.length;
        for (uint256 i; i < n; ++i) {
            total += IYieldAdapter(adapters[i]).totalAssets();
        }
    }

    /// @dev Virtual-share offset hardens against the ERC-4626 inflation/donation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @dev Required because ERC20 (via ERC4626) and ERC20Permit both sit in the hierarchy.
    function decimals() public view override(ERC4626, ERC20) returns (uint8) {
        return ERC4626.decimals();
    }

    // --- admin ---

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function setAllocator(address allocator, bool allowed) external onlyOwner {
        allocators[allocator] = allowed;
        emit AllocatorSet(allocator, allowed);
    }

    function setParams(uint16 _minIdleBps, uint16 _maxLossBps) external onlyOwner {
        if (_minIdleBps > 10000 || _maxLossBps > 10000) revert BpsTooHigh();
        minIdleBps = _minIdleBps;
        maxLossBps = _maxLossBps;
        emit ParamsSet(_minIdleBps, _maxLossBps);
    }

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    function addAdapter(address adapter, uint16 targetBps, uint16 capBps) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (adapterInfo[adapter].exists) revert AdapterExists();
        if (targetBps > 10000 || capBps > 10000) revert BpsTooHigh();
        adapterInfo[adapter] = AdapterInfo({exists: true, targetBps: targetBps, capBps: capBps});
        adapters.push(adapter);
        emit AdapterAdded(adapter, targetBps, capBps);
    }

    function setTargets(address adapter, uint16 targetBps, uint16 capBps) external onlyOwner {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        if (targetBps > 10000 || capBps > 10000) revert BpsTooHigh();
        adapterInfo[adapter].targetBps = targetBps;
        adapterInfo[adapter].capBps = capBps;
        emit TargetsSet(adapter, targetBps, capBps);
    }

    function removeAdapter(address adapter) external onlyOwner {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        if (IYieldAdapter(adapter).totalAssets() != 0) revert AdapterNotEmpty();
        delete adapterInfo[adapter];
        uint256 n = adapters.length;
        for (uint256 i; i < n; ++i) {
            if (adapters[i] == adapter) {
                adapters[i] = adapters[n - 1];
                adapters.pop();
                break;
            }
        }
        emit AdapterRemoved(adapter);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-contract NavyVaultTest -vv`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add contract/src/NavyVault.sol contract/test/NavyVault.t.sol
git commit -m "feat(contract): NavyVault ERC-4626 skeleton with roles and adapter management"
```

---

### Task 4: Gasless deposit via EIP-3009 (`depositWithAuthorization`)

**Files:**
- Modify: `contract/src/NavyVault.sol`
- Modify: `contract/test/NavyVault.t.sol`

Reuse the existing `IEIP3009` interface (`contract/src/interfaces/IEIP3009.sol`) and the `MockUSDC` EIP-712 signing pattern already used in `NavyPayments.t.sol`.

- [ ] **Step 1: Write the failing test** (append to `NavyVaultTest`)

```solidity
    // Mirrors the EIP-3009 signing helper in NavyPayments.t.sol.
    function _signReceive(
        uint256 pk,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function test_depositWithAuthorization_mintsShares() public {
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        usdc.mint(user, 100e6);

        bytes32 nonce = keccak256("deposit-1");
        (uint8 v, bytes32 r, bytes32 s) =
            _signReceive(pk, user, address(vault), 100e6, 0, block.timestamp + 1 hours, nonce);

        vm.prank(relayer);
        uint256 shares = vault.depositWithAuthorization(user, 100e6, 0, block.timestamp + 1 hours, nonce, v, r, s);

        assertEq(vault.balanceOf(user), shares);
        assertEq(vault.totalAssets(), 100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        // First deposit: assets convert 1:1 to shares (scaled by the decimals offset).
        assertEq(vault.convertToAssets(shares), 100e6);
    }

    function test_depositWithAuthorization_onlyRelayer() public {
        bytes32 nonce = keccak256("deposit-2");
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotRelayer.selector);
        vault.depositWithAuthorization(alice, 1e6, 0, block.timestamp + 1 hours, nonce, 27, bytes32(0), bytes32(0));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_depositWithAuthorization -vv`
Expected: FAIL — `depositWithAuthorization` not defined.

- [ ] **Step 3: Add the import and function to `NavyVault.sol`**

Add the import near the top:
```solidity
import {IEIP3009} from "./interfaces/IEIP3009.sol";
```

Add the function in the vault (after the admin section):
```solidity
    /// @dev Gasless deposit. Relayer submits a user's signed EIP-3009 ReceiveWithAuthorization
    /// (to == this vault). USDC's own EIP-712 verification binds user+amount+expiry+nonce, and its
    /// per-nonce authorizationState prevents replay — so the vault needs no separate paid-guard.
    /// Shares are priced on pre-deposit state (previewDeposit before the pull), matching ERC-4626.
    function depositWithAuthorization(
        address user,
        uint256 assets,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRelayer nonReentrant returns (uint256 shares) {
        shares = previewDeposit(assets);
        IEIP3009(asset()).receiveWithAuthorization(user, address(this), assets, validAfter, validBefore, nonce, v, r, s);
        _mint(user, shares);
        emit Deposit(msg.sender, user, assets, shares);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test test_depositWithAuthorization -vv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract/src/NavyVault.sol contract/test/NavyVault.t.sol
git commit -m "feat(contract): gasless EIP-3009 depositWithAuthorization"
```

---

### Task 5: Adapter funding, divestment, and reallocation (allocator path)

**Files:**
- Modify: `contract/src/NavyVault.sol`
- Modify: `contract/test/NavyVault.t.sol`

- [ ] **Step 1: Write the failing tests** (append to `NavyVaultTest`)

```solidity
    function _depositAs(uint256 pk, uint256 amount, bytes32 nonce) internal {
        address user = vm.addr(pk);
        usdc.mint(user, amount);
        (uint8 v, bytes32 r, bytes32 s) =
            _signReceive(pk, user, address(vault), amount, 0, block.timestamp + 1 hours, nonce);
        vm.prank(relayer);
        vault.depositWithAuthorization(user, amount, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    function test_deployToAdapter_movesIdleAndRespectsBuffer() public {
        _depositAs(0xBEEF, 100e6, keccak256("d1"));
        // minIdleBps 10% of 100e6 == 10e6 must stay idle → at most 90e6 deployable.
        vm.prank(allocator);
        vault.deployToAdapter(address(adapterA), 90e6);
        assertEq(adapterA.totalAssets(), 90e6);
        assertEq(usdc.balanceOf(address(vault)), 10e6);
        assertEq(vault.totalAssets(), 100e6); // unchanged by moving idle→adapter
    }

    function test_deployToAdapter_revertsOnBufferBreach() public {
        _depositAs(0xBEEF, 100e6, keccak256("d2"));
        vm.prank(allocator);
        vm.expectRevert(NavyVault.IdleBufferBreached.selector);
        vault.deployToAdapter(address(adapterA), 95e6); // would leave only 5e6 < 10e6 buffer
    }

    function test_deployToAdapter_revertsOnCap() public {
        _depositAs(0xBEEF, 100e6, keccak256("d3"));
        vm.prank(owner);
        vault.setTargets(address(adapterA), 5000, 5000); // cap 50%
        vm.prank(allocator);
        vm.expectRevert(NavyVault.CapExceeded.selector);
        vault.deployToAdapter(address(adapterA), 60e6); // 60% > 50% cap
    }

    function test_deployToAdapter_onlyAllocator() public {
        _depositAs(0xBEEF, 100e6, keccak256("d4"));
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.deployToAdapter(address(adapterA), 10e6);
    }

    function test_reallocate_movesBetweenAdapters() public {
        _depositAs(0xBEEF, 100e6, keccak256("d5"));
        vm.startPrank(allocator);
        vault.deployToAdapter(address(adapterA), 80e6);
        vault.reallocate(address(adapterA), address(adapterB), 50e6);
        vm.stopPrank();
        assertEq(adapterA.totalAssets(), 30e6);
        assertEq(adapterB.totalAssets(), 50e6);
        assertEq(vault.totalAssets(), 100e6);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `forge test --match-test "test_deployToAdapter|test_reallocate" -vv`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Add the allocator functions to `NavyVault.sol`**

```solidity
    /// @dev Move idle USDC into an adapter, keeping the minIdle buffer and honoring the adapter cap.
    /// totalAssets is unchanged by this move (idle↓, adapter↑), so caps are measured against a
    /// constant denominator.
    function deployToAdapter(address adapter, uint256 amount) public onlyAllocator nonReentrant {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        uint256 total = totalAssets();
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 minIdle = (total * minIdleBps) / 10000;
        if (amount > idle || idle - amount < minIdle) revert IdleBufferBreached();
        uint256 projected = IYieldAdapter(adapter).totalAssets() + amount;
        if (projected > (total * adapterInfo[adapter].capBps) / 10000) revert CapExceeded();
        IERC20(asset()).transfer(adapter, amount);
        IYieldAdapter(adapter).deposit(amount);
        emit Deployed(adapter, amount);
    }

    /// @dev Pull USDC from an adapter back to the vault, bounding the realized shortfall by maxLossBps.
    function withdrawFromAdapter(address adapter, uint256 amount) public onlyAllocator nonReentrant {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        uint256 before = IERC20(asset()).balanceOf(address(this));
        IYieldAdapter(adapter).withdraw(amount, address(this));
        uint256 received = IERC20(asset()).balanceOf(address(this)) - before;
        if (received + (amount * maxLossBps) / 10000 < amount) revert LossTooHigh();
        emit Divested(adapter, received);
    }

    /// @dev Convenience: divest from one adapter and deploy into another in a single call.
    function reallocate(address from, address to, uint256 amount) external onlyAllocator {
        withdrawFromAdapter(from, amount);
        deployToAdapter(to, amount);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `forge test --match-test "test_deployToAdapter|test_reallocate" -vv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract/src/NavyVault.sol contract/test/NavyVault.t.sol
git commit -m "feat(contract): allocator deploy/divest/reallocate with cap, buffer, loss guards"
```

---

### Task 6: Redemption with automatic adapter liquidity pull

**Files:**
- Modify: `contract/src/NavyVault.sol`
- Modify: `contract/test/NavyVault.t.sol`

Standard ERC-4626 `redeem`/`withdraw` must succeed even when most funds are deployed: override `_withdraw` to top up idle from adapters first. The relayer path (permit + redeem) is exercised in Plan 2; here we test the on-chain liquidity behavior directly.

- [ ] **Step 1: Write the failing test** (append to `NavyVaultTest`)

```solidity
    function test_redeem_pullsFromAdaptersWhenIdleInsufficient() public {
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _depositAs(pk, 100e6, keccak256("r1"));
        // Deploy 90e6 so idle is only 10e6.
        vm.prank(allocator);
        vault.deployToAdapter(address(adapterA), 90e6);

        uint256 shares = vault.balanceOf(user);
        // User redeems everything; vault must pull ~90e6 back from the adapter.
        vm.prank(user);
        uint256 assets = vault.redeem(shares, user, user);

        assertEq(assets, 100e6);
        assertEq(usdc.balanceOf(user), 100e6);
        assertEq(vault.balanceOf(user), 0);
    }

    function test_redeem_partialLeavesRemainderInvested() public {
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _depositAs(pk, 100e6, keccak256("r2"));
        vm.prank(allocator);
        vault.deployToAdapter(address(adapterA), 90e6);

        uint256 half = vault.balanceOf(user) / 2;
        vm.prank(user);
        vault.redeem(half, user, user);

        assertApproxEqAbs(usdc.balanceOf(user), 50e6, 1);
        assertApproxEqAbs(vault.totalAssets(), 50e6, 1);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_redeem -vv`
Expected: FAIL — with only 10e6 idle, `super._withdraw`'s transfer reverts (insufficient balance).

- [ ] **Step 3: Add the `_withdraw` override and `_ensureIdle` to `NavyVault.sol`**

```solidity
    /// @dev Before fulfilling a redemption/withdrawal, top up idle from adapters if needed.
    function _withdraw(address caller, address receiver, address ownerAddr, uint256 assets, uint256 shares)
        internal
        override
    {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets) {
            _ensureIdle(assets - idle);
        }
        super._withdraw(caller, receiver, ownerAddr, assets, shares);
    }

    /// @dev Pull `needed` USDC from adapters in registration order until covered, bounding loss.
    function _ensureIdle(uint256 needed) internal {
        uint256 n = adapters.length;
        for (uint256 i; i < n && needed > 0; ++i) {
            address adapter = adapters[i];
            uint256 have = IYieldAdapter(adapter).totalAssets();
            if (have == 0) continue;
            uint256 pull = have < needed ? have : needed;
            uint256 before = IERC20(asset()).balanceOf(address(this));
            IYieldAdapter(adapter).withdraw(pull, address(this));
            uint256 received = IERC20(asset()).balanceOf(address(this)) - before;
            if (received + (pull * maxLossBps) / 10000 < pull) revert LossTooHigh();
            needed = received >= needed ? 0 : needed - received;
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test test_redeem -vv`
Expected: PASS.

- [ ] **Step 5: Run the whole mock-based suite**

Run: `forge test --match-contract NavyVaultTest -vv`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add contract/src/NavyVault.sol contract/test/NavyVault.t.sol
git commit -m "feat(contract): redemptions auto-pull liquidity from adapters"
```

---

### Task 7: Fuzz + invariant coverage for share math and guards

**Files:**
- Create: `contract/test/NavyVault.fuzz.t.sol`

- [ ] **Step 1: Write the fuzz tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NavyVaultFuzzTest is Test {
    NavyVault vault;
    MockUSDC usdc;
    MockYieldAdapter adapter;

    address owner = address(0x0111);
    address relayer = address(0x0333);
    address allocator = address(0x0A11);

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        vault = new NavyVault(IERC20(address(usdc)), owner);
        vault.setRelayer(relayer, true);
        vault.setAllocator(allocator, true);
        adapter = new MockYieldAdapter(address(vault), address(usdc), 4e16);
        vault.addAdapter(address(adapter), 10000, 10000);
        vault.setParams(0, 50); // no idle buffer so any amount is deployable in this test
        vm.stopPrank();
    }

    function _deposit(uint256 pk, uint256 amount, bytes32 nonce) internal {
        address user = vm.addr(pk);
        usdc.mint(user, amount);
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                user, address(vault), amount, uint256(0), block.timestamp + 1 hours, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.prank(relayer);
        vault.depositWithAuthorization(user, amount, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    /// @dev A user who deposits and immediately redeems all shares never gets more than deposited.
    function testFuzz_depositRedeem_roundtripNoProfit(uint96 amount) public {
        vm.assume(amount >= 1e6 && amount <= 1_000_000e6);
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _deposit(pk, amount, keccak256(abi.encode(amount)));
        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        uint256 out = vault.redeem(shares, user, user);
        assertLe(out, amount);
        assertApproxEqAbs(out, amount, 1); // at most 1 base-unit rounding loss
    }

    /// @dev Deploying then redeeming through the adapter preserves the roundtrip.
    function testFuzz_deployThenRedeem(uint96 amount) public {
        vm.assume(amount >= 1e6 && amount <= 1_000_000e6);
        uint256 pk = 0xCAFE;
        address user = vm.addr(pk);
        _deposit(pk, amount, keccak256(abi.encode(amount, "x")));
        vm.prank(allocator);
        vault.deployToAdapter(address(adapter), amount);
        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        uint256 out = vault.redeem(shares, user, user);
        assertApproxEqAbs(out, amount, 1);
    }
```

Close the contract:
```solidity
}
```

- [ ] **Step 2: Run the fuzz tests**

Run: `forge test --match-contract NavyVaultFuzzTest -vv`
Expected: PASS (default 256 runs each).

- [ ] **Step 3: Commit**

```bash
git add contract/test/NavyVault.fuzz.t.sol
git commit -m "test(contract): fuzz roundtrip and share-math invariants for NavyVault"
```

---

### Task 8: `CompoundAdapter` + Sepolia-fork test

**Files:**
- Create: `contract/src/adapters/CompoundAdapter.sol`
- Create: `contract/src/interfaces/IComet.sol`
- Create: `contract/test/CompoundAdapterFork.t.sol`

- [ ] **Step 1: Write the Comet interface**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Compound III (Comet) surface used by CompoundAdapter.
interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdrawTo(address to, address asset, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function getUtilization() external view returns (uint256);
    function getSupplyRate(uint256 utilization) external view returns (uint64);
    function baseToken() external view returns (address);
}
```

- [ ] **Step 2: Write the adapter**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CompoundAdapter — supplies the vault's USDC to Compound III (Comet).
/// @dev The adapter is msg.sender to Comet, so Comet credits this contract. totalAssets reads the
/// Comet supplier balance. Only the vault may move funds.
contract CompoundAdapter is IYieldAdapter {
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    address public immutable vault;
    IERC20 public immutable usdc;
    IComet public immutable comet;

    error NotVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _comet) {
        vault = _vault;
        usdc = IERC20(_usdc);
        comet = IComet(_comet);
    }

    function deposit(uint256 amount) external onlyVault {
        usdc.approve(address(comet), amount);
        comet.supply(address(usdc), amount);
    }

    function withdraw(uint256 amount, address to) external onlyVault {
        comet.withdrawTo(to, address(usdc), amount);
    }

    function totalAssets() external view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    function supplyRatePerYear() external view returns (uint256) {
        uint256 util = comet.getUtilization();
        uint64 ratePerSecond = comet.getSupplyRate(util); // 1e18-scaled per-second
        return uint256(ratePerSecond) * SECONDS_PER_YEAR;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }
}
```

- [ ] **Step 3: Write the fork test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {IComet} from "../src/interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Runs only when SEPOLIA_RPC_URL is set. Verifies supply/withdraw and the APR read against
/// the live Comet USDC market.
contract CompoundAdapterForkTest is Test {
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant COMET = 0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e;
    address VAULT; // stand-in vault EOA, set in setUp via makeAddr

    CompoundAdapter adapter;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        adapter = new CompoundAdapter(VAULT, USDC, COMET);
    }

    function test_baseTokenMatchesUsdc() public {
        if (address(adapter) == address(0)) return; // skipped without RPC
        assertEq(IComet(COMET).baseToken(), USDC);
    }

    function test_supplyWithdrawAndRate() public {
        if (address(adapter) == address(0)) return;
        uint256 amount = 10e6;
        deal(USDC, address(adapter), amount); // fund the adapter with test USDC
        vm.prank(VAULT);
        adapter.deposit(amount);
        assertApproxEqAbs(adapter.totalAssets(), amount, 1);

        uint256 apr = adapter.supplyRatePerYear();
        assertGt(apr, 0);
        assertLt(apr, 1e18); // sanity: < 100% APR

        vm.prank(VAULT);
        adapter.withdraw(amount - 1, VAULT); // leave 1 unit dust to avoid rounding revert
        assertApproxEqAbs(IERC20(USDC).balanceOf(VAULT), amount - 1, 1);
    }
}
```

- [ ] **Step 4: Run the fork test**

Run: `SEPOLIA_RPC_URL=<your-rpc> forge test --match-contract CompoundAdapterForkTest -vv`
Expected: PASS. Without `SEPOLIA_RPC_URL`, the tests no-op (return early) and still pass.

Note (from CLAUDE.md): some public RPCs spuriously revert `eth_estimateGas` for Comet withdraws — use an Alchemy/Infura endpoint for this test.

- [ ] **Step 5: Commit**

```bash
git add contract/src/adapters/CompoundAdapter.sol contract/src/interfaces/IComet.sol contract/test/CompoundAdapterFork.t.sol
git commit -m "feat(contract): CompoundAdapter (Comet supply/withdraw/APR) + fork test"
```

---

### Task 9: Resolve the Morpho Circle-USDC market

**Files:**
- Create: `contract/script/ResolveMorphoMarket.s.sol`
- Modify: `contract/DEPLOYMENTS.md`

Open item #1 from the spec: the Morpho Blue market for Circle USDC on Sepolia must be pinned (reuse the existing LTV-Finance market, or create our own). This task records the concrete `marketParams` used by the adapter in the next task.

- [ ] **Step 1: Write a read script that prints candidate market params**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IMorphoView {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function market(bytes32 id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );
}

/// @dev Prints liquidity for a candidate Morpho market id so we can confirm a live Circle-USDC
/// market before wiring MorphoAdapter. Pass MORPHO_MARKET_ID + MORPHO_ADDRESS via env.
contract ResolveMorphoMarket is Script {
    function run() external view {
        address morpho = vm.envAddress("MORPHO_ADDRESS");
        bytes32 id = vm.envBytes32("MORPHO_MARKET_ID");
        (uint128 tsa,,uint128 tba,,,uint128 fee) = IMorphoView(morpho).market(id);
        console2.log("totalSupplyAssets:", tsa);
        console2.log("totalBorrowAssets:", tba);
        console2.log("fee:", fee);
    }
}
```

- [ ] **Step 2: Run it against the candidate market**

Run: `MORPHO_ADDRESS=0xd011EE229E7459ba1ddd22631eF7bF528d424A14 MORPHO_MARKET_ID=<candidate> forge script script/ResolveMorphoMarket.s.sol --rpc-url sepolia`
Expected: prints non-reverting market totals for a live Circle-USDC market. If no suitable market exists, create one with `Morpho.createMarket(marketParams)` (loanToken = Circle USDC) and record its id.

- [ ] **Step 3: Record the pinned params in `DEPLOYMENTS.md`**

Append a section to `contract/DEPLOYMENTS.md`:
```markdown
## NavyVault / Morpho market (Sepolia)

- Morpho Blue: `0xd011EE229E7459ba1ddd22631eF7bF528d424A14`
- Circle USDC (loanToken): `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Market id: `<resolved 0x… id>`
- marketParams: loanToken / collateralToken / oracle / irm / lltv = `<…>`
- Source: <existing market url, or "created via createMarket in tx 0x…">
```

- [ ] **Step 4: Commit**

```bash
git add contract/script/ResolveMorphoMarket.s.sol contract/DEPLOYMENTS.md
git commit -m "chore(contract): resolve + record Morpho Circle-USDC Sepolia market params"
```

---

### Task 10: `MorphoAdapter` + Sepolia-fork test

**Files:**
- Create: `contract/src/adapters/MorphoAdapter.sol`
- Create: `contract/src/interfaces/IMorpho.sol`
- Create: `contract/test/MorphoAdapterFork.t.sol`

The least-standardized adapter (per the spec). Uses morpho-blue's `SharesMathLib` for position→assets conversion and the market IRM for the rate.

- [ ] **Step 1: Write the Morpho interface**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

struct Market {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

struct Position {
    uint256 supplyShares;
    uint128 borrowShares;
    uint128 collateral;
}

interface IMorpho {
    function supply(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256 assetsSupplied, uint256 sharesSupplied);
    function withdraw(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);
    function market(bytes32 id) external view returns (Market memory);
    function position(bytes32 id, address user) external view returns (Position memory);
}

interface IIrm {
    function borrowRateView(MarketParams memory p, Market memory m) external view returns (uint256);
}
```

- [ ] **Step 2: Write the adapter**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IMorpho, IIrm, MarketParams, Market, Position} from "../interfaces/IMorpho.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MorphoAdapter — supplies the vault's USDC to a Morpho Blue market.
/// @dev The adapter is the `onBehalf` supplier. totalAssets converts supplyShares→assets using the
/// market totals; supplyRatePerYear = borrowRate * utilization * (1 - fee), annualized.
contract MorphoAdapter is IYieldAdapter {
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant WAD = 1e18;
    uint256 private constant VIRTUAL_ASSETS = 1;
    uint256 private constant VIRTUAL_SHARES = 1e6; // matches Morpho SharesMathLib

    address public immutable vault;
    IERC20 public immutable usdc;
    IMorpho public immutable morpho;
    bytes32 public immutable marketId;
    MarketParams public marketParams;

    error NotVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _morpho, MarketParams memory _params, bytes32 _id) {
        vault = _vault;
        usdc = IERC20(_usdc);
        morpho = IMorpho(_morpho);
        marketParams = _params;
        marketId = _id;
    }

    function deposit(uint256 amount) external onlyVault {
        usdc.approve(address(morpho), amount);
        morpho.supply(marketParams, amount, 0, address(this), "");
    }

    function withdraw(uint256 amount, address to) external onlyVault {
        morpho.withdraw(marketParams, amount, 0, address(this), to);
    }

    function totalAssets() external view returns (uint256) {
        Market memory m = morpho.market(marketId);
        uint256 shares = morpho.position(marketId, address(this)).supplyShares;
        if (shares == 0) return 0;
        // toAssetsDown(shares, totalAssets, totalShares) with Morpho's virtual amounts.
        uint256 totalA = uint256(m.totalSupplyAssets) + VIRTUAL_ASSETS;
        uint256 totalS = uint256(m.totalSupplyShares) + VIRTUAL_SHARES;
        return (shares * totalA) / totalS;
    }

    function supplyRatePerYear() external view returns (uint256) {
        Market memory m = morpho.market(marketId);
        if (m.totalSupplyAssets == 0) return 0;
        uint256 borrowRate = IIrm(marketParams.irm).borrowRateView(marketParams, m); // per-second WAD
        uint256 utilization = (uint256(m.totalBorrowAssets) * WAD) / uint256(m.totalSupplyAssets);
        uint256 supplyRatePerSecond = (borrowRate * utilization / WAD) * (WAD - uint256(m.fee)) / WAD;
        return supplyRatePerSecond * SECONDS_PER_YEAR;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }
}
```

- [ ] **Step 3: Write the fork test** (uses the market id recorded in Task 9 via env `MORPHO_MARKET_ID` and the 5 param fields via env)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MorphoAdapter} from "../src/adapters/MorphoAdapter.sol";
import {MarketParams} from "../src/interfaces/IMorpho.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MorphoAdapterForkTest is Test {
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant MORPHO = 0xd011EE229E7459ba1ddd22631eF7bF528d424A14;
    address VAULT;

    MorphoAdapter adapter;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        MarketParams memory p = MarketParams({
            loanToken: USDC,
            collateralToken: vm.envAddress("MORPHO_COLLATERAL"),
            oracle: vm.envAddress("MORPHO_ORACLE"),
            irm: vm.envAddress("MORPHO_IRM"),
            lltv: vm.envUint("MORPHO_LLTV")
        });
        adapter = new MorphoAdapter(VAULT, USDC, MORPHO, p, vm.envBytes32("MORPHO_MARKET_ID"));
    }

    function test_supplyWithdrawAndRate() public {
        if (address(adapter) == address(0)) return;
        uint256 amount = 10e6;
        deal(USDC, address(adapter), amount);
        vm.prank(VAULT);
        adapter.deposit(amount);
        assertApproxEqAbs(adapter.totalAssets(), amount, 2);

        uint256 apr = adapter.supplyRatePerYear();
        assertLt(apr, 1e18); // sanity: < 100% APR (may be 0 if utilization is 0)

        vm.prank(VAULT);
        adapter.withdraw(amount - 2, VAULT);
        assertApproxEqAbs(IERC20(USDC).balanceOf(VAULT), amount - 2, 2);
    }
}
```

- [ ] **Step 4: Run the fork test**

Run: `SEPOLIA_RPC_URL=<rpc> MORPHO_MARKET_ID=<id> MORPHO_COLLATERAL=<..> MORPHO_ORACLE=<..> MORPHO_IRM=<..> MORPHO_LLTV=<..> forge test --match-contract MorphoAdapterForkTest -vv`
Expected: PASS. Without env, it no-ops.

- [ ] **Step 5: Commit**

```bash
git add contract/src/adapters/MorphoAdapter.sol contract/src/interfaces/IMorpho.sol contract/test/MorphoAdapterFork.t.sol
git commit -m "feat(contract): MorphoAdapter (supply/withdraw/APR) + fork test"
```

---

### Task 11: Deploy script + ABI export to backend

**Files:**
- Create: `contract/script/DeployVault.s.sol`
- Modify: `contract/DEPLOYMENTS.md`
- Create: `be/src/evm/navy-vault-abi.json` (copied from build output)

- [ ] **Step 1: Write the deploy script**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Deploys NavyVault + CompoundAdapter, wires roles, and registers the adapter. Env-driven.
/// MorphoAdapter is deployed/registered separately once its market params are pinned (Task 9/10).
contract DeployVault is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("NAVY_USDC_ADDRESS");
        address ownerAddr = vm.envAddress("NAVY_OWNER_ADDRESS");
        address relayer = vm.envAddress("NAVY_RELAYER_ADDRESS");
        address keeper = vm.envAddress("NAVY_KEEPER_ADDRESS");
        address comet = vm.envAddress("NAVY_COMET_ADDRESS");

        vm.startBroadcast(deployerPk);
        NavyVault vault = new NavyVault(IERC20(usdc), ownerAddr);
        CompoundAdapter compound = new CompoundAdapter(address(vault), usdc, comet);
        if (vm.addr(deployerPk) == ownerAddr) {
            vault.setRelayer(relayer, true);
            vault.setAllocator(keeper, true);
            vault.addAdapter(address(compound), 10000, 10000);
            vault.setParams(1000, 50); // 10% idle buffer, 0.5% max loss
        }
        vm.stopBroadcast();

        console2.log("NavyVault:", address(vault));
        console2.log("CompoundAdapter:", address(compound));
    }
}
```

- [ ] **Step 2: Build so the ABI is emitted**

Run: `forge build`
Expected: writes `contract/out/NavyVault.sol/NavyVault.json`.

- [ ] **Step 3: Export the ABI to the backend** (mirrors how `navy-payments-abi.json` is a runtime asset)

Run (from repo root):
```bash
jq '.abi' contract/out/NavyVault.sol/NavyVault.json > be/src/evm/navy-vault-abi.json
```
Expected: a JSON array of ABI entries at `be/src/evm/navy-vault-abi.json`.

- [ ] **Step 4: Deploy to Sepolia and record the address**

Run: `DEPLOYER_PRIVATE_KEY=… NAVY_USDC_ADDRESS=0x1c7D… NAVY_OWNER_ADDRESS=… NAVY_RELAYER_ADDRESS=… NAVY_KEEPER_ADDRESS=… NAVY_COMET_ADDRESS=0xAec1… forge script script/DeployVault.s.sol --rpc-url sepolia --broadcast --slow`
Expected: prints the deployed `NavyVault` + `CompoundAdapter` addresses.

Append to `contract/DEPLOYMENTS.md`:
```markdown
## NavyVault (Sepolia)

- NavyVault: `<addr>`
- CompoundAdapter: `<addr>`
- MorphoAdapter: `<addr once deployed>`
- owner: `<addr>` · keeper/allocator: `<addr>` · relayer: `<addr>`
- Deployed: 2026-07-28 · tx `<hash>`
```

- [ ] **Step 5: Commit**

```bash
git add contract/script/DeployVault.s.sol contract/DEPLOYMENTS.md be/src/evm/navy-vault-abi.json
git commit -m "feat(contract): NavyVault deploy script + ABI export to backend"
```

---

### Task 12: Full suite, formatting, and gas snapshot

**Files:**
- Create: `contract/.gas-snapshot` (via `forge snapshot`)

- [ ] **Step 1: Format**

Run: `forge fmt`
Expected: reformats to 120-col; no logic changes.

- [ ] **Step 2: Run the entire local suite**

Run: `forge test -vv`
Expected: all mock/unit/fuzz tests PASS; fork tests PASS or no-op depending on `SEPOLIA_RPC_URL`.

- [ ] **Step 3: Gas snapshot**

Run: `forge snapshot`
Expected: writes `contract/.gas-snapshot`.

- [ ] **Step 4: Commit**

```bash
git add contract/.gas-snapshot contract/src contract/test
git commit -m "chore(contract): forge fmt + gas snapshot for NavyVault suite"
```

---

## Self-Review

**Spec coverage:**
- Pooled ERC-4626 + user shares → Tasks 3, 4 (`NavyVault`, `navUSDC`, `depositWithAuthorization`). ✅
- Gasless EIP-3009 deposit → Task 4. ✅ Gasless permit redeem → shares are `ERC20Permit` (Task 3); the relayer `permit`+`redeem` call path is backend (Plan 2), on-chain liquidity behavior tested in Task 6. ✅
- Constrained ALLOCATOR rebalance, no EOA exfiltration, cap/minIdle/maxLoss → Task 5 (`deployToAdapter`/`withdrawFromAdapter`/`reallocate`) + Task 6 (`_ensureIdle`). ✅
- On-chain APY read per venue → `supplyRatePerYear` in Tasks 8 (Compound) and 10 (Morpho). ✅
- Two live Sepolia venues (Compound + Morpho) with Circle USDC; N-protocol interface → Tasks 1, 8, 9, 10. ✅
- Inflation/donation guard + reentrancy → Task 3 (`_decimalsOffset` = 6, `ReentrancyGuard` on deposit/deploy/divest). ✅
- Foundry unit + fuzz + fork tests, ABI as runtime asset → Tasks 3–12. ✅
- Owner→multisig mainnet gate → `owner` is a settable single address (Task 3); ownership transfer to a multisig is a mainnet op, out of scope here (spec "mainnet gates"). ✅

**Deferred to later plans (correctly out of scope here):** `/vault/*` BFF, keeper strategy `decideRebalance`, watcher/DB, removal of dead subwallet/crypto code, AI-assistant repoint, fe/expo screens — all Plan 2/3, which depend on this plan's deployed address + ABI + resolved Morpho params.

**Placeholder scan:** The only intentionally-unresolved values are the Morpho `marketParams`/market id (Task 9 resolves and records them) and deployed addresses (recorded at deploy time in Tasks 11). The fork tests no-op without `SEPOLIA_RPC_URL`, so the suite is green offline. No `TODO`/"implement later" steps.

**Type consistency:** `IYieldAdapter` signatures (`deposit`, `withdraw(amount,to)`, `totalAssets`, `supplyRatePerYear`, `asset`) are identical across the interface (Task 1), the mock (Task 2), and both real adapters (Tasks 8, 10). Vault method names (`deployToAdapter`, `withdrawFromAdapter`, `reallocate`, `adapterInfo`, `adapterCount`, `setParams`, `setTargets`) match between the implementation (Tasks 3, 5) and every test that calls them. `AdapterInfo` tuple order (`exists`, `targetBps`, `capBps`) matches the test destructuring in Task 3. The fork tests use `makeAddr("vault")` for the stand-in vault caller (any non-zero EOA works — it only needs to be the adapter's authorized `msg.sender`).
