// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../src/libraries/VaultTypes.sol";

/// @title Mock USDC for testing
contract MockUSDCForSRCLA {
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

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
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

/// @title Mock Strategy Adapter for testing
contract MockAdapterForSRCLA {
    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    mapping(address => uint256) public rewards;
    address[] private _rewardTokens;

    constructor(address vault_, address asset_, bytes32 config_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        configuration = config_;
    }

    modifier onlyVault() {
        require(msg.sender == vaultAddress, "only vault");
        _;
    }

    function setReportedAssets(uint256 assets_) external {
        reportedAssets = assets_;
        if (withdrawableAssets > assets_) {
            withdrawableAssets = assets_;
        }
    }

    function setWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
    }

    function setRewardTokens(address[] memory tokens_) external {
        _rewardTokens = tokens_;
    }

    function setClaimableReward(address token, uint256 amount) external {
        rewards[token] = amount;
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
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
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
        MockUSDCForSRCLA(assetAddress).transfer(vaultAddress, returnedAssets);
    }
}

/// @title Core tests for NavyVaultSRCLA
contract NavyVaultSRCLACoreTest is Test {
    MockUSDCForSRCLA usdc;
    NavyVaultSRCLA vault;
    MockAdapterForSRCLA adapter;

    address admin = address(0xA11CE);
    address allocator = address(0xA110CA7E);
    address alice = address(0xA71CE);
    address bob = address(0xB0B);

    function setUp() public {
        usdc = new MockUSDCForSRCLA();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        adapter = new MockAdapterForSRCLA(address(vault), address(usdc), keccak256("adapter-config"));

        // Grant roles
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        // Register adapter
        vm.prank(admin);
        vault.registerAdapter(address(adapter), 5000, 100, "Test Adapter");
    }

    function _singleActionPlan(NavyVaultSRCLA.Action memory action, bytes32 decisionHash)
        internal
        view
        returns (VaultTypes.PlanHeader memory header, bytes32 leaf)
    {
        header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: decisionHash,
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
        leaf = vault.hashPlanAction(vault.planDomain(header), action);
    }

    function _submitSingleAction(NavyVaultSRCLA.Action memory action, bytes32 decisionHash) internal {
        (VaultTypes.PlanHeader memory header, bytes32 leaf) = _singleActionPlan(action, decisionHash);
        vm.prank(allocator);
        vault.submitPlan(header, leaf);
    }

    function _executeSingleAction(NavyVaultSRCLA.Action memory action) internal {
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    // ---- Deposit Tests ----

    function test_depositMintsShares() public {
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);

        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);

        vm.prank(alice);
        uint256 shares = vault.deposit(depositAmount, alice);

        assertGt(shares, 0, "should mint shares");
        assertEq(vault.balanceOf(alice), shares, "alice balance should equal shares");
        assertEq(usdc.balanceOf(alice), 0, "alice USDC should be transferred");
        assertEq(usdc.balanceOf(address(vault)), depositAmount, "vault should receive USDC");
    }

    function test_convertToAssetsIncludesYield() public {
        // First, alice deposits 1000e6
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);
        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);
        vm.prank(alice);
        uint256 shares = vault.deposit(depositAmount, alice);

        // Simulate yield by deploying to adapter and generating returns
        // For simplicity, we use recognizedRewards to show yield
        usdc.mint(address(vault), 100e6); // This represents idle yield

        // Now withdraw and check the value includes yield
        vm.prank(alice);
        uint256 assetsBack = vault.redeem(shares, alice, alice);

        // Alice should get back more than she deposited due to yield
        assertGt(assetsBack, depositAmount, "should include yield in withdrawal");
    }

    function test_cannotDepositWhenPaused() public {
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);

        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);

        vm.prank(admin);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert(NavyVaultSRCLA.DepositPaused.selector);
        vault.deposit(depositAmount, alice);
    }

    // ---- Mint Tests ----

    function test_mintRevertsWhenPaused() public {
        // First, do a normal deposit to have assets in the vault
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);
        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);
        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        // Now pause the vault
        vm.prank(admin);
        vault.pause();

        uint256 mintAmount = 500e6;
        usdc.mint(bob, mintAmount);
        vm.prank(bob);
        usdc.approve(address(vault), mintAmount);

        vm.prank(bob);
        vm.expectRevert(NavyVaultSRCLA.DepositPaused.selector);
        vault.mint(mintAmount, bob);

        assertEq(vault.balanceOf(bob), 0, "paused mint must not create shares");
    }

    // ---- Withdraw Tests ----

    function test_withdrawBurnsSharesAndReturnsAssets() public {
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);

        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);

        vm.prank(alice);
        uint256 shares = vault.deposit(depositAmount, alice);

        // Withdraw
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 sharesBurned = vault.withdraw(depositAmount, alice, alice);

        assertEq(sharesBurned, shares, "withdraw returns the shares burned");
        assertEq(usdc.balanceOf(alice), aliceBalanceBefore + depositAmount, "alice should receive USDC");
        assertEq(vault.balanceOf(alice), 0, "alice shares should be burned");
    }

    function test_withdrawStillWorksWhenPaused() public {
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);

        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);

        vm.prank(alice);
        uint256 shares = vault.deposit(depositAmount, alice);

        // Pause the vault
        vm.prank(admin);
        vault.pause();

        // Withdraw should still work (ERC-4626 spec)
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 sharesBurned = vault.withdraw(depositAmount, alice, alice);

        assertEq(sharesBurned, shares, "paused withdrawal returns shares burned");
        assertEq(usdc.balanceOf(alice), aliceBalanceBefore + depositAmount, "alice should receive USDC");
    }

    // ---- Redeem Tests ----

    function test_redeemRemainsAvailableWhenPaused() public {
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);

        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);

        vm.prank(alice);
        vault.deposit(depositAmount, alice);

        // Pause
        vm.prank(admin);
        vault.pause();

        uint256 shares = vault.balanceOf(alice);
        assertEq(vault.maxRedeem(alice), shares, "pause must not disable exits");

        vm.prank(alice);
        uint256 assets = vault.redeem(shares, alice, alice);
        assertEq(assets, depositAmount, "redeem should remain available while paused");
    }

    // ---- Adapter Tests ----

    function test_registerAdapter_verifiesAssetAndVault() public {
        MockUSDCForSRCLA wrongUsdc = new MockUSDCForSRCLA();
        MockAdapterForSRCLA wrongAssetAdapter =
            new MockAdapterForSRCLA(address(vault), address(wrongUsdc), keccak256("wrong"));

        vm.prank(admin);
        vm.expectRevert(NavyVaultSRCLA.AdapterAssetMismatch.selector);
        vault.registerAdapter(address(wrongAssetAdapter), 5000, 100, "Wrong");
    }

    function test_registerAdapter_rejectsDuplicateActiveAdapter() public {
        vm.prank(admin);
        vm.expectRevert(NavyVaultSRCLA.AdapterAlreadyRegistered.selector);
        vault.registerAdapter(address(adapter), 5000, 100, "Duplicate");
    }

    function test_registerAdapter_rejectsInvalidBps() public {
        MockAdapterForSRCLA another = new MockAdapterForSRCLA(address(vault), address(usdc), keccak256("another"));

        vm.prank(admin);
        vm.expectRevert(NavyVaultSRCLA.AdapterConfigInvalid.selector);
        vault.registerAdapter(address(another), 10_001, 100, "Invalid cap");
    }

    function test_adapterCanBeDisabled() public {
        // Simply verify that we can set the adapter state to disabled without errors
        vm.prank(admin);
        vault.setAdapterState(address(adapter), 1); // Disabled

        // Success if no revert
        assertTrue(true, "adapter should be disabled successfully");
    }

    // ---- Plan Execution Tests ----

    function test_executePlan_createsActivePlan() public {
        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("plan-1")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: 0,
            minOut: 0
        });

        bytes32 planId = keccak256("plan-1");
        bytes32 decisionHash = keccak256("decision");

        vm.prank(allocator);
        _submitSingleAction(action, decisionHash);

        assertEq(vault.getActivePlanPlanId(), planId, "planId should be set");
        assertEq(vault.getActivePlanDecisionHash(), decisionHash, "decisionHash should be set");
        assertEq(vault.getActivePlanUsedNonce(), 0, "usedNonce should start at 0");
    }

    function test_executePlan_rejectsActivePlan() public {
        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("plan-1")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: 0,
            minOut: 0
        });

        vm.prank(allocator);
        _submitSingleAction(action, keccak256("decision"));

        // Try to create another plan while one is active
        (VaultTypes.PlanHeader memory header, bytes32 leaf) = _singleActionPlan(action, keccak256("decision2"));
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanAlreadyActive.selector);
        vault.submitPlan(header, leaf);
    }

    function test_executeNextAction_executesPlanAction() public {
        // Setup plan with harvest action
        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("plan-1")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: 0,
            minOut: 0
        });

        bytes32 planId = keccak256("plan-1");

        vm.prank(allocator);
        _submitSingleAction(action, keccak256("decision"));

        vm.prank(allocator);
        _executeSingleAction(action);

        // Plan should be completed (single action)
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should be completed and cleared");
    }

    function test_cancelPlan_clearsActivePlan() public {
        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("plan-1")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(adapter),
            amount: 0,
            minOut: 0
        });

        bytes32 planId = keccak256("plan-1");

        vm.prank(allocator);
        _submitSingleAction(action, keccak256("decision"));

        vm.prank(allocator);
        vault.cancelPlan();

        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should be cleared");
    }

    // ---- Synchronous Liquidity Tests ----

    function test_synchronousLiquidity_includesIdleOnly() public {
        // Mint directly to vault (idle funds)
        usdc.mint(address(vault), 500e6);

        uint256 sync = vault.synchronousLiquidity();
        assertEq(sync, 500e6, "should include idle only when no strategy assets");
    }

    // ---- Pause/Unpause Tests ----

    function test_pause_setsPausedTrue() public {
        vm.prank(admin);
        vault.pause();

        assertTrue(vault.paused(), "paused should be true");
    }

    function test_unpause_setsPausedFalse() public {
        vm.prank(admin);
        vault.pause();
        vm.prank(admin);
        vault.unpause();

        assertFalse(vault.paused(), "paused should be false");
    }

    function test_maxDepositZeroWhenPaused() public {
        vm.prank(admin);
        vault.pause();

        assertEq(vault.maxDeposit(alice), 0, "maxDeposit should be 0 when paused");
    }

    // ---- Share Conversion Tests ----

    function test_shareValue_increasesWithYield() public {
        uint256 depositAmount = 1000e6;
        usdc.mint(alice, depositAmount);

        vm.prank(alice);
        usdc.approve(address(vault), depositAmount);

        vm.prank(alice);
        uint256 shares = vault.deposit(depositAmount, alice);

        // Simulate yield - mint additional funds to vault as yield
        usdc.mint(address(vault), 100e6); // 10% yield on 1000e6 deposit

        uint256 assetsBack = vault.convertToAssets(shares);
        assertGt(assetsBack, depositAmount, "share value should increase with yield");
    }

    function test_withdrawOneAssetAfterYieldBurnsShares() public {
        uint256 depositAmount = 100e6;
        usdc.mint(alice, depositAmount);
        vm.startPrank(alice);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, alice);
        vm.stopPrank();
        usdc.mint(address(vault), 10e6);

        uint256 sharesBefore = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 burned = vault.withdraw(1, alice, alice);

        assertGt(burned, 0, "positive withdrawal must burn shares");
        assertEq(vault.balanceOf(alice), sharesBefore - burned);
    }

    function test_withdrawSourcesAdvertisedAdapterLiquidity() public {
        uint256 depositAmount = 1_000e6;
        usdc.mint(alice, depositAmount);
        vm.startPrank(alice);
        usdc.approve(address(vault), depositAmount);
        vault.deposit(depositAmount, alice);
        vm.stopPrank();

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("deploy-liquidity")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 400e6,
            minOut: 400e6
        });
        _submitSingleAction(action, keccak256("deploy-decision"));
        vm.prank(allocator);
        _executeSingleAction(action);

        assertEq(usdc.balanceOf(address(vault)), 600e6);
        assertGe(vault.maxWithdraw(alice), 800e6);

        vm.prank(alice);
        vault.withdraw(800e6, alice, alice);
        assertEq(usdc.balanceOf(alice), 800e6, "advertised strategy liquidity must execute");
    }

    function test_redeemSyncsAccruedStrategyYieldBeforePricing() public {
        usdc.mint(alice, 100e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 100e6);
        vault.deposit(100e6, alice);
        vm.stopPrank();

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("yield-sync")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 50e6,
            minOut: 50e6
        });
        _submitSingleAction(action, keccak256("yield-sync-decision"));
        vm.prank(allocator);
        _executeSingleAction(action);

        adapter.setReportedAssets(60e6);
        adapter.setWithdrawable(60e6);
        usdc.mint(address(adapter), 10e6);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares, alice, alice);

        assertGt(assetsOut, 100e6, "redeemer must receive accrued strategy yield");
    }

    function test_donationCannotMakeVictimDepositMintZeroShares() public {
        usdc.mint(alice, 1_000_001);
        vm.startPrank(alice);
        usdc.approve(address(vault), 1);
        vault.deposit(1, alice);
        usdc.transfer(address(vault), 1_000_000);
        vm.stopPrank();

        usdc.mint(bob, 500_000);
        vm.startPrank(bob);
        usdc.approve(address(vault), 500_000);
        uint256 victimShares = vault.deposit(500_000, bob);
        vm.stopPrank();

        assertGt(victimShares, 0, "donation must not zero-round victim shares");
    }
}
