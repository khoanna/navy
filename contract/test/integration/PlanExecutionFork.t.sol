// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVaultSRCLA} from "src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "src/adapters/AaveV3Adapter.sol";
import {CompoundAdapter} from "src/adapters/CompoundAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title PlanExecutionForkTest
/// @dev E2E test for plan execution on Base mainnet.
contract PlanExecutionForkTest is Test {
    // Base mainnet addresses (per paper Appendix A)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    NavyVaultSRCLA vault;
    AaveV3Adapter aaveAdapter;
    CompoundAdapter compoundAdapter;
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

        // Deploy vault
        vault = new NavyVaultSRCLA(IERC20(USDC));

        // Deploy adapters
        aaveAdapter = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        compoundAdapter = new CompoundAdapter(address(vault), USDC, COMET);

        // Set up adapters
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.setAdapterState(address(aaveAdapter), 1);
        vault.setAdapterState(address(compoundAdapter), 1);

        // Grant allocator role
        vault.grantRole(vault.ALLOCATOR_ROLE(), ALLOCATOR);
    }

    modifier withFork() {
        if (!forkCreated) return;
        _;
    }

    // ============================================
    // E2E Plan Execution Tests
    // ============================================

    /// @dev Test full E2E plan execution across multiple adapters
    function test_fullPlanExecutionFlow() external withFork {
        // Deal USDC to vault
        deal(USDC, address(vault), 200e6);

        // Build plan with Deploy actions for both adapters
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](2);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("e2e-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aaveAdapter),
            amount: 100e6,
            minOut: 0
        });
        actions[1] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("e2e-plan")),
            index: 1,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(compoundAdapter),
            amount: 100e6,
            minOut: 0
        });

        bytes32 planId = keccak256("e2e-plan");

        // Submit plan
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 7200), actions);

        // Verify allocations after both actions
        assertGt(aaveAdapter.totalAssets(), 0, "Aave should have assets");
        assertGt(compoundAdapter.totalAssets(), 0, "Compound should have assets");

        // Verify plan is complete
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should be completed");
    }

    /// @dev Test plan execution with Deploy then Divest
    function test_deployDivestFlow() external withFork {
        // Deal USDC to vault
        deal(USDC, address(vault), 100e6);

        // Build plan: Deploy to Aave, then Divest
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](2);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("divest-plan")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aaveAdapter),
            amount: 100e6,
            minOut: 0
        });
        actions[1] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("divest-plan")),
            index: 1,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(aaveAdapter),
            amount: 100e6,
            minOut: 0
        });

        bytes32 planId = keccak256("divest-plan");

        // Submit and execute plan
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 7200), actions);

        // After full cycle, adapter should be empty
        assertEq(aaveAdapter.totalAssets(), 0, "Aave should be empty after divest");
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "plan should be completed");
    }

    /// @dev Test plan expiration
    function test_planExpiration() external withFork {
        // Deal USDC to vault
        deal(USDC, address(vault), 100e6);

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("expiry")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aaveAdapter),
            amount: 100e6,
            minOut: 0
        });

        bytes32 planId = keccak256("expiry");

        // Submit plan with very short expiration
        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 1), actions);

        // Warp past expiration
        vm.warp(block.timestamp + 2);

        // Try to execute - should fail
        vm.prank(ALLOCATOR);
        vm.expectRevert();
        vault.executeNextAction();
    }

    /// @dev Test only allocator can submit plans
    function test_onlyAllocatorCanSubmitPlan() external withFork {
        address nonAllocator = makeAddr("non-allocator");

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("unauthorized")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aaveAdapter),
            amount: 100e6,
            minOut: 0
        });

        bytes32 planId = keccak256("unauthorized");

        // Non-allocator tries to submit - should fail
        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 7200), actions);
    }

    /// @dev Test plan with no actions
    function test_emptyPlan() external withFork {
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](0);

        bytes32 planId = keccak256("empty");

        vm.prank(ALLOCATOR);
        vault.executePlan(planId, keccak256("decision"), uint64(block.timestamp + 7200), actions);

        // Empty plan completes immediately
        assertEq(vault.getActivePlanPlanId(), bytes32(0), "empty plan should complete immediately");
    }

    /// @dev Test sequential plans
    function test_sequentialPlans() external withFork {
        deal(USDC, address(vault), 200e6);

        // First plan: Deploy to Aave
        NavyVaultSRCLA.Action[] memory actions1 = new NavyVaultSRCLA.Action[](1);
        actions1[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("plan-1")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aaveAdapter),
            amount: 100e6,
            minOut: 0
        });

        vm.prank(ALLOCATOR);
        vault.executePlan(keccak256("plan-1"), keccak256("decision1"), uint64(block.timestamp + 7200), actions1);

        // Second plan: Deploy to Compound
        NavyVaultSRCLA.Action[] memory actions2 = new NavyVaultSRCLA.Action[](1);
        actions2[0] = NavyVaultSRCLA.Action({
            planId: uint256(keccak256("plan-2")),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(compoundAdapter),
            amount: 100e6,
            minOut: 0
        });

        vm.prank(ALLOCATOR);
        vault.executePlan(keccak256("plan-2"), keccak256("decision2"), uint64(block.timestamp + 7200), actions2);

        // Both should have assets
        assertGt(aaveAdapter.totalAssets(), 0, "Aave should have assets");
        assertGt(compoundAdapter.totalAssets(), 0, "Compound should have assets");
    }
}
