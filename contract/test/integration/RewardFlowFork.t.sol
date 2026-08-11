// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVaultSRCLA} from "src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "src/adapters/AaveV3Adapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title RewardFlowForkTest
/// @dev Integration test for the SRCLA system on Base mainnet.
/// Tests: adapter deposits, plan execution, action types (Deploy/Withdraw/Harvest).
contract RewardFlowForkTest is Test {
    // Base mainnet addresses (per paper Appendix A)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;

    NavyVaultSRCLA vault;
    AaveV3Adapter aaveAdapter;
    address VAULT_ADDRESS;
    address ALLOCATOR;
    bool forkCreated;

    function setUp() public {
        ALLOCATOR = makeAddr("allocator");
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkCreated = false;
            return;
        }
        forkCreated = true;
        vm.createSelectFork(rpc);

        VAULT_ADDRESS = address(this);

        // Deploy vault
        vault = new NavyVaultSRCLA(IERC20(USDC));

        // Deploy Aave adapter
        aaveAdapter = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);

        // Set up vault
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.setAdapterState(address(aaveAdapter), 1); // Active

        // Grant roles
        vault.grantRole(vault.ALLOCATOR_ROLE(), ALLOCATOR);
    }

    modifier withFork() {
        if (!forkCreated) return;
        _;
    }

    // ============================================
    // Adapter Integration Tests
    // ============================================

    /// @dev Test that vault can track adapter deposits
    function test_vault_tracksAdapterDeposits() external withFork {
        uint256 depositAmount = 10e6;

        // Deal USDC to vault
        deal(USDC, address(vault), depositAmount);

        // Approve adapter to spend
        vm.prank(address(vault));
        IERC20(USDC).approve(address(aaveAdapter), depositAmount);

        // Execute deploy action (simulated)
        vm.prank(address(vault));
        aaveAdapter.deposit(depositAmount);

        // Check adapter has assets
        uint256 adapterAssets = aaveAdapter.totalAssets();
        assertGt(adapterAssets, 0, "adapter should have assets after deposit");
    }

    /// @dev Test harvest action execution via plan
    function test_harvestAction_executesViaPlan() external withFork {
        // Setup: deposit to adapter first
        uint256 depositAmount = 100e6;
        deal(USDC, address(aaveAdapter), depositAmount);

        vm.prank(address(vault));
        aaveAdapter.deposit(depositAmount);

        // Create harvest action
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("harvest-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(aaveAdapter),
            amount: 0,
            minOut: 0
        });

        bytes32 planId = keccak256("harvest-plan");

        // Submit plan
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 3600), actions);

        // Execute harvest action
        vm.prank(ALLOCATOR);
        vault.executeNextAction();

        // Verify plan completed
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should be completed");
    }

    /// @dev Test that harvest handles zero claimable rewards gracefully
    function test_harvest_handlesZeroClaimableRewards() external withFork {
        // Setup: deposit to adapter
        uint256 depositAmount = 10e6;
        deal(USDC, address(aaveAdapter), depositAmount);

        vm.prank(address(vault));
        aaveAdapter.deposit(depositAmount);

        // Create harvest action
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("harvest-zero")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(aaveAdapter),
            amount: 0,
            minOut: 0
        });

        bytes32 planId = keccak256("harvest-zero");

        // Submit plan
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 3600), actions);

        // Execute - should not revert even with 0 claimable
        vm.prank(ALLOCATOR);
        vault.executeNextAction();

        // Plan should complete (no rewards to claim)
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should complete even with 0 rewards");
    }

    /// @dev Test deploy action execution
    function test_deployAction_executesCorrectly() external withFork {
        uint256 deployAmount = 50e6;
        deal(USDC, address(vault), deployAmount);

        // Create deploy action
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("deploy-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aaveAdapter),
            amount: deployAmount,
            minOut: 0
        });

        bytes32 planId = keccak256("deploy-plan");

        // Submit plan
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 3600), actions);

        // Execute deploy
        vm.prank(ALLOCATOR);
        vault.executeNextAction();

        // Verify adapter received funds
        uint256 adapterAssets = aaveAdapter.totalAssets();
        assertGt(adapterAssets, 0, "adapter should have assets after deploy");
    }

    /// @dev Test divest action execution
    function test_divestAction_executesCorrectly() external withFork {
        // First deploy
        uint256 initialDeposit = 50e6;
        deal(USDC, address(aaveAdapter), initialDeposit);
        vm.prank(address(vault));
        aaveAdapter.deposit(initialDeposit);

        // Create withdraw action for half
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("withdraw-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(aaveAdapter),
            amount: initialDeposit / 2,
            minOut: 0
        });

        bytes32 planId = keccak256("withdraw-plan");

        // Submit plan
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 3600), actions);

        uint256 vaultBalanceBefore = IERC20(USDC).balanceOf(address(vault));

        // Execute withdraw
        vm.prank(ALLOCATOR);
        vault.executeNextAction();

        uint256 vaultBalanceAfter = IERC20(USDC).balanceOf(address(vault));
        assertGt(vaultBalanceAfter, vaultBalanceBefore, "vault should receive withdrawn funds");
    }

    /// @dev Test multiple actions in single plan
    function test_multipleActions_inSinglePlan() external withFork {
        uint256 amount = 20e6;

        // Create plan with deploy and withdraw
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](2);

        // Action 1: Deploy to Aave
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("multi-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aaveAdapter),
            amount: amount,
            minOut: 0
        });

        // Action 2: Divest from Aave
        actions[1] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("multi-plan")),
            index: 1,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(aaveAdapter),
            amount: amount,
            minOut: 0
        });

        bytes32 planId = keccak256("multi-plan");

        // Submit plan
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 7200), actions);

        // Execute both actions
        vm.prank(ALLOCATOR);
        vault.executeNextAction();

        vm.prank(ALLOCATOR);
        vault.executeNextAction();
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should be completed");
    }

    /// @dev Test plan expiration
    function test_plan_expiresAfterTimeout() external withFork {
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("expire-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(aaveAdapter),
            amount: 0,
            minOut: 0
        });

        bytes32 planId = keccak256("expire-plan");
        uint64 expiresAt = uint64(block.timestamp + 1); // Expires in 1 second

        // Submit plan with short expiration
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), expiresAt, actions);

        // Warp past expiration
        vm.warp(block.timestamp + 2);

        // Try to execute action - should revert
        vm.prank(ALLOCATOR);
        vm.expectRevert(NavyVaultSRCLA.PlanExecutionExpired.selector);
        vault.executeNextAction();
    }

    /// @dev Test invalid adapter reverts
    function test_invalidAdapter_reverts() external withFork {
        address invalidAdapter = makeAddr("invalid");

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("invalid-adapter")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: invalidAdapter,
            amount: 100e6,
            minOut: 0
        });

        bytes32 planId = keccak256("invalid-adapter");

        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 3600), actions);

        vm.prank(ALLOCATOR);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
        vault.executeNextAction();
    }

    /// @dev Test unauthorized execution reverts
    function test_nonAllocator_cannotExecute() external withFork {
        address nonAllocator = makeAddr("non-allocator");

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("unauthorized")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Harvest,
            adapter: address(aaveAdapter),
            amount: 0,
            minOut: 0
        });

        bytes32 planId = keccak256("unauthorized");

        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 3600), actions);

        // Non-allocator tries to execute
        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.executeNextAction();
    }
}
