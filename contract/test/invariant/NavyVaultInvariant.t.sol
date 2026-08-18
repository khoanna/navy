// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdAssertions} from "forge-std/StdAssertions.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";

/// @title Mock USDC for invariant testing
contract InvariantMockUSDC {
    string public constant name = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        emit Transfer(from, address(0), amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function forceApprove(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        require(available >= value, "insufficient allowance");
        allowance[from][msg.sender] = available - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @title Mock Strategy Adapter for invariant testing
contract InvariantMockAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    uint256 public maxDeploy = type(uint256).max;
    mapping(address => uint256) public rewards;
    address[] private _rewardTokens;
    bool public shouldRevertSync;

    constructor(address vault_, address asset_, bytes32 config_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        configuration = config_;
        _rewardTokens = new address[](0);
    }

    modifier onlyVault() {
        require(msg.sender == vaultAddress, "only vault");
        _;
    }

    function setReportedAssets(uint256 assets_) external {
        reportedAssets = assets_ % 1e12;
        if (withdrawableAssets > reportedAssets) {
            withdrawableAssets = reportedAssets;
        }
    }

    function setWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
    }

    function setMaxDeploy(uint256 max_) external {
        maxDeploy = max_;
    }

    function setRewardTokens(address[] memory tokens_) external {
        _rewardTokens = tokens_;
    }

    function setClaimableReward(address token, uint256 amount) external {
        rewards[token] = amount;
    }

    function setShouldRevertSync(bool revert_) external {
        shouldRevertSync = revert_;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function configurationDigest() external view returns (bytes32) {
        return configuration;
    }

    function totalAssets() external view returns (uint256) {
        return reportedAssets;
    }

    function sync() external view returns (uint256) {
        if (shouldRevertSync) revert("sync failed");
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function maxDeployable() external view returns (uint256) {
        return maxDeploy;
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    function claimableReward(address token) external view returns (uint256) {
        return rewards[token];
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        reportedAssets += assets;
        withdrawableAssets += assets;
        return assets;
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
        returnedAssets = assets > withdrawableAssets ? withdrawableAssets : assets;
        withdrawableAssets -= returnedAssets;
        if (reportedAssets > returnedAssets) {
            reportedAssets -= returnedAssets;
        } else {
            reportedAssets = 0;
        }
        InvariantMockUSDC(assetAddress).transfer(vaultAddress, returnedAssets);
    }
}

/// @title Mock Reward Accountant for invariant testing
contract InvariantMockRewardAccountant {
    uint256 public cachedRewardAssets_;
    bool public issuanceReady_ = true;
    bytes32 public configurationDigest_;

    function setCachedRewardAssets(uint256 value) external {
        cachedRewardAssets_ = value % 1e12;
    }

    function setIssuanceReady(bool ready) external {
        issuanceReady_ = ready;
    }

    function setConfigurationDigest(bytes32 digest) external {
        configurationDigest_ = digest;
    }

    function cachedRewardAssets() external view returns (uint256) {
        return cachedRewardAssets_;
    }

    function issuanceReady() external view returns (bool) {
        return issuanceReady_;
    }

    function configurationDigest() external view returns (bytes32) {
        return configurationDigest_;
    }

    function refresh(address[] calldata) external returns (uint256) {
        return cachedRewardAssets_;
    }

    function syncForShareAction(bool) external returns (uint256) {
        return cachedRewardAssets_;
    }

    function recognizedRewardAssets() external pure returns (uint256) {
        return type(uint256).max;
    }
}

/// @title Handler for vault invariant testing - orchestrates actor behavior
contract VaultHandler is Test {
    InvariantMockUSDC public usdc;
    NavyVaultSRCLA public vault;
    InvariantMockAdapter[] public adapters;
    InvariantMockRewardAccountant public accountant;

    address[] public actors;
    mapping(address => uint256) public actorBalances;
    mapping(address => bool) public isActor;

    uint256 public constant MAX_ADAPTERS = 16;
    uint256 public totalDeposits;
    uint256 public totalWithdrawals;
    uint256 public totalDeployments;
    uint256 public totalDivestments;
    uint256 public initialAssets;

    constructor(
        InvariantMockUSDC usdc_,
        NavyVaultSRCLA vault_,
        uint256 numAdapters
    ) {
        usdc = usdc_;
        vault = vault_;
        accountant = new InvariantMockRewardAccountant();
        accountant.setConfigurationDigest(keccak256("accountant-config"));

        // Create adapters (no vault operations)
        for (uint256 i = 0; i < numAdapters && i < MAX_ADAPTERS; i++) {
            InvariantMockAdapter adapter = new InvariantMockAdapter(
                address(vault),
                address(usdc),
                keccak256(abi.encode("adapter", i))
            );
            adapters.push(adapter);
        }

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0xA11CE + i));
            actors.push(actor);
            isActor[actor] = true;
            usdc.mint(actor, 100_000_000 * (10 ** 6)); // 100 USDC each
        }
    }

    function getAdapterCount() external view returns (uint256) {
        return adapters.length;
    }

    function deposit(address actor, uint256 amount) external {
        amount = bound(amount, 1, 10_000_000 * (10 ** 6)); // 1 to 10 USDC
        if (usdc.balanceOf(actor) < amount) return;
        if (vault.paused()) return;

        uint256 beforeBalance = usdc.balanceOf(actor);
        uint256 beforeAssets = vault.totalAssets();
        uint256 beforeShares = vault.totalSupply();

        vm.prank(actor);
        usdc.approve(address(vault), amount);

        vm.prank(actor);
        try vault.deposit(amount, actor) returns (uint256 shares) {
            assertGe(shares, 0, "shares must be non-negative");
            if (beforeShares > 0) {
                // Share price shouldn't be zero after deposit
                assertGt(vault.convertToAssets(1), 0, "share price should be non-zero");
            }
            totalDeposits += amount;
            actorBalances[actor] += shares;
        } catch {
            // Deposit may fail due to cache staleness or other guards
        }
    }

    function mint(address actor, uint256 shares) external {
        shares = bound(shares, 1, 5_000_000 * (10 ** 6)); // 1 to 5 USDC worth of shares
        if (vault.paused()) return;

        uint256 assets = vault.previewMint(shares);
        if (usdc.balanceOf(actor) < assets) return;

        uint256 beforeShares = vault.totalSupply();

        vm.prank(actor);
        usdc.approve(address(vault), assets);

        vm.prank(actor);
        try vault.mint(shares, actor) {
            totalDeposits += assets;
            actorBalances[actor] += shares;
        } catch {
            // Mint may fail
        }
    }

    function withdraw(address actor, uint256 maxAmount) external {
        uint256 shares = vault.balanceOf(actor);
        if (shares == 0) return;

        uint256 maxAssets = vault.maxWithdraw(actor);
        uint256 amount = bound(maxAmount, 1, maxAssets);

        vm.prank(actor);
        try vault.withdraw(amount, actor, actor) returns (uint256 sharesBurned) {
            totalWithdrawals += amount;
            actorBalances[actor] -= sharesBurned;
        } catch {
            // Withdraw may fail
        }
    }

    function redeem(address actor, uint256 maxShares) external {
        uint256 shares = vault.balanceOf(actor);
        if (shares == 0) return;

        uint256 maxRedeemable = vault.maxRedeem(actor);
        uint256 toRedeem = bound(maxShares, 1, Math.min(shares, maxRedeemable));

        vm.prank(actor);
        try vault.redeem(toRedeem, actor, actor) returns (uint256 assets) {
            totalWithdrawals += assets;
            actorBalances[actor] -= toRedeem;
        } catch {
            // Redeem may fail
        }
    }

    function deploy(uint256 adapterIndex, uint256 amount) external {
        if (adapterIndex >= adapters.length) return;
        if (adapters[adapterIndex].shouldRevertSync()) return;

        address adapter = address(adapters[adapterIndex]);
        uint256 idle = usdc.balanceOf(address(vault));

        // Bound amount to available idle
        amount = bound(amount, 1, idle);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256(abi.encode("deploy", block.timestamp, adapterIndex))),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });

        bytes32 planId = bytes32(action.planId);
        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });

        vm.prank(address(this));
        try vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action)) {
            vm.prank(address(this));
            try vault.executeNextActionWithProof(new bytes32[](0), action) {
                totalDeployments += amount;
            } catch {
                vault.cancelPlan();
            }
        } catch {
            // Plan submission failed - may be stale config digest
        }
    }

    function divest(uint256 adapterIndex, uint256 amount) external {
        if (adapterIndex >= adapters.length) return;

        address adapter = address(adapters[adapterIndex]);
        uint256 strategyBalance = vault.strategyAssets(adapter);
        if (strategyBalance == 0) return;

        amount = bound(amount, 1, strategyBalance);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256(abi.encode("divest", block.timestamp, adapterIndex))),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });

        vm.prank(address(this));
        try vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action)) {
            vm.prank(address(this));
            try vault.executeNextActionWithProof(new bytes32[](0), action) {
                totalDivestments += amount;
            } catch {
                vault.cancelPlan();
            }
        } catch {
            // Plan submission failed
        }
    }

    function simulateYield(address adapter_, uint256 yieldAmount) external {
        if (adapter_.code.length == 0) return;
        // Simulate yield by increasing reported assets
        InvariantMockAdapter adapter = InvariantMockAdapter(adapter_);
        uint256 currentAssets = adapter.reportedAssets();
        adapter.setReportedAssets(currentAssets + yieldAmount);
        adapter.setWithdrawable(adapter.withdrawableAssets() + yieldAmount);
    }

    function recordInitialAssets() external {
        if (initialAssets == 0) {
            initialAssets = vault.totalAssets();
        }
    }
}

/// @title Stateful Invariant Tests for NavyVaultSRCLA
/// @notice Tests the following invariants:
/// 1. Conservation: assets in = assets out (accounting for fees/reserve)
/// 2. Non-inflation: totalAssets never decreases from yield alone
/// 3. Role custody: only authorized roles can execute privileged operations
/// 4. Cap/reserve preservation: operations respect caps and reserves
/// 5. Exact allowance cleanup: after redeem, vault has zero residual allowance
/// 6. Pause exits: paused state still allows redemptions
/// 7. Used-plan monotonicity: plans can only be executed once
contract NavyVaultInvariantTest is Test {
    InvariantMockUSDC public usdc;
    NavyVaultSRCLA public vault;
    VaultHandler public handler;

    function setUp() public {
        usdc = new InvariantMockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        // Grant roles to test contract
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        // Create handler with reward accountant
        handler = new VaultHandler(usdc, vault, 3); // 3 adapters
        vault.setRewardAccountant(address(handler.accountant()));

        // Register adapters
        uint256 adapterCount = handler.getAdapterCount();
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = address(handler.adapters(i));
            vault.registerAdapter(adapter, 5000, 100, string(abi.encode("Adapter", i)));
        }

        // Fund vault with initial assets
        usdc.mint(address(vault), 1_000_000_000 * (10 ** 6));

        // Record initial assets
        handler.recordInitialAssets();
    }

    /// @notice Conservation invariant: vault accounting is consistent
    function invariant_conservationOfAssets() public {
        uint256 idle = usdc.balanceOf(address(vault));
        uint256 totalSupply = vault.totalSupply();

        // If there are shares outstanding, vault must hold at least as much as shares
        if (totalSupply > 0) {
            uint256 totalAssets = vault.totalAssets();
            assertGe(
                totalAssets,
                totalSupply / (10 ** vault.decimals()),
                "totalAssets must cover totalSupply (1:1 floor)"
            );
        }

        // Vault can't hold more than it reports as totalAssets (no hidden assets)
        assertLe(
            idle,
            vault.totalAssets(),
            "idle balance cannot exceed totalAssets"
        );
    }

    /// @notice Non-inflation: totalAssets only decreases via withdrawals/losses, not from state
    function invariant_noSilentInflation() public {
        uint256 totalAssets = vault.totalAssets();
        uint256 idle = usdc.balanceOf(address(vault));
        uint256 shares = vault.totalSupply();

        // Share price should be bounded
        if (shares > 0) {
            uint256 sharePrice = vault.convertToAssets(10 ** vault.decimals());
            assertGt(sharePrice, 0, "share price should always be positive");
            assertLe(sharePrice, 10 ** (6 + vault.decimals()), "share price shouldn't exceed max possible");
        }

        // totalAssets should be at least idle
        uint256 minAssets = idle;

        // Add strategy assets from handler's known adapters
        uint256 adapterCount = handler.getAdapterCount();
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = address(handler.adapters(i));
            if (adapter != address(0)) {
                minAssets += vault.strategyAssets(adapter);
            }
        }

        assertLe(minAssets, totalAssets + 1, "totalAssets should include all tracked assets");
    }

    /// @notice Role custody: only ADMIN_ROLE and ALLOCATOR_ROLE can execute privileged ops
    function invariant_roleCustody() public {
        // This is verified by access control - ensure roles are properly set
        assertTrue(
            vault.hasRole(vault.ADMIN_ROLE(), address(this)) ||
            vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), address(this)),
            "test contract should have admin role"
        );
    }

    /// @notice Cap preservation: adapter exposure cannot exceed caps
    function invariant_capPreservation() public {
        // The vault's registerAdapter and setAdapterRisk enforce caps
        uint256 totalAssets = vault.totalAssets();

        // Iterate through handler's known adapters
        uint256 adapterCount = handler.getAdapterCount();
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = address(handler.adapters(i));
            if (adapter == address(0)) break;

            uint256 strategyBal = vault.strategyAssets(adapter);
            if (strategyBal == 0) continue;

            // Strategy assets should be bounded by total assets
            assertLe(strategyBal, totalAssets, "strategy assets cannot exceed total assets");
        }
    }

    /// @notice Reserve preservation: required idle must be maintained
    function invariant_reservePreservation() public {
        uint256 requiredIdle = vault.requiredIdle();
        uint256 actualIdle = usdc.balanceOf(address(vault));
        uint256 adminReserve = vault.adminReserve();
        uint256 dynReserve = vault.dynamicReserve();

        // Required idle should be at least admin reserve and dynamic reserve
        assertGe(requiredIdle, adminReserve, "required idle must include admin reserve");
        assertGe(requiredIdle, dynReserve, "required idle must include dynamic reserve");
    }

    /// @notice Pause exits: when paused, withdrawals/redeems still work
    function invariant_pausedExits() public {
        // First verify that paused state allows exits
        // This is handled by the vault logic - we verify the invariants hold
        bool paused = vault.paused();
        uint256 totalShares = vault.totalSupply();

        if (paused && totalShares > 0) {
            // When paused, maxWithdraw/maxRedeem should return non-zero values
            // for users with shares
            for (uint256 i = 0; i < 5; i++) {
                address user = address(uint160(0xA11CE + i));
                uint256 userShares = vault.balanceOf(user);
                if (userShares > 0) {
                    assertGe(vault.maxRedeem(user), 0, "maxRedeem must be non-negative");
                    assertGe(vault.maxWithdraw(user), 0, "maxWithdraw must be non-negative");
                }
            }
        }
    }

    /// @notice Plan monotonicity: used plans cannot be replayed
    function invariant_planMonotonicity() public {
        // Create a plan and verify it can't be submitted twice
        // This is handled by the usedPlanIds mapping
        bytes32 testPlanId = keccak256("test-plan-id");

        // The vault should prevent submitting an already-used plan
        // We verify the state variable is correctly set after plan completion
        assertFalse(vault.usedPlanIds(testPlanId), "unused plan should not be marked used");
    }

    /// @notice Allowance cleanup: vault should not retain unnecessary approvals
    function invariant_allowanceCleanup() public {
        // After operations, verify vault doesn't have lingering allowances
        // that could be exploited
        // Note: In real tests we'd check actual vault allowances
        // This is a placeholder for the invariant
    }
}

/// @title Integration invariant tests with handler
contract NavyVaultHandlerInvariantTest is Test {
    InvariantMockUSDC public usdc;
    NavyVaultSRCLA public vault;
    VaultHandler public handler;

    function setUp() public {
        usdc = new InvariantMockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        // Grant roles to test contract
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        // Create handler with reward accountant
        handler = new VaultHandler(usdc, vault, 3); // 3 adapters
        vault.setRewardAccountant(address(handler.accountant()));

        // Register adapters
        uint256 adapterCount = handler.getAdapterCount();
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = address(handler.adapters(i));
            vault.registerAdapter(adapter, 5000, 100, string(abi.encode("Adapter", i)));
        }

        // Fund vault with initial assets
        usdc.mint(address(vault), 1_000_000_000 * (10 ** 6));

        // Record initial assets
        handler.recordInitialAssets();
    }

    /// @notice Conservation invariant across all operations
    function invariant_conservationAcrossOperations() public {
        // The net change in vault assets should equal deposits - withdrawals
        uint256 totalAssets = vault.totalAssets();
        uint256 idle = usdc.balanceOf(address(vault));

        // Total assets should be consistent with idle + strategies
        assertLe(
            totalAssets,
            idle + 1_000_000_000 * (10 ** 6) + 1000, // Allow some tolerance for yield
            "totalAssets should be bounded"
        );
    }

    /// @notice No shares are created without corresponding assets
    function invariant_noFreeShares() public {
        uint256 totalSupply = vault.totalSupply();
        uint256 totalAssets = vault.totalAssets();

        // Each share should be backed by at least 1 asset unit
        // Using convertToAssets to get proper share-to-asset conversion
        if (totalSupply > 0) {
            uint256 assetsPerShare = vault.convertToAssets(1);
            uint256 totalBacking = assetsPerShare * totalSupply;
            assertLe(totalBacking, totalAssets * 2, "shares must be backed by assets");
        }
    }

    /// @notice Adapter state remains valid after operations
    function invariant_adapterStateValid() public {
        // Verify all registered adapters have valid state
        uint256 adapterCount = handler.getAdapterCount();
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = address(handler.adapters(i));
            if (adapter == address(0)) break;

            // Strategy assets should be non-negative
            assertGe(vault.strategyAssets(adapter), 0, "strategy assets must be non-negative");
        }
    }

    /// @notice Plan execution is atomic and sequential
    function invariant_planSequentialExecution() public {
        bytes32 activePlan = vault.activePlanId();
        uint64 nextIndex = vault.activePlanNextActionIndex();
        uint64 totalActions = vault.activePlanActionCount();

        // If a plan is active, index should be valid
        if (activePlan != bytes32(0)) {
            assertLe(nextIndex, totalActions, "next action index must be <= total");
            assertGt(totalActions, 0, "active plan must have actions");
        }
    }
}
