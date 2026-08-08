// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {NavyVaultPolicyHarness, PolicyBaseUsdc, PolicyStrategyAdapter} from "./handlers/VaultPolicyHandler.sol";

contract VaultPolicyTest is Test {
    bytes32 internal constant PROTOCOL_GROUP = keccak256("protocol-group");
    bytes32 internal constant COMMON_MODE_GROUP = keccak256("base-usdc-common-mode");

    PolicyBaseUsdc internal usdc;
    NavyVaultPolicyHarness internal vault;
    PolicyStrategyAdapter internal adapterA;
    PolicyStrategyAdapter internal adapterB;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110CA7E);
    address internal alice = address(0xA71CE);

    function setUp() public {
        usdc = new PolicyBaseUsdc();
        vault = new NavyVaultPolicyHarness(usdc, admin, allocator);
        adapterA = new PolicyStrategyAdapter(address(vault), address(usdc), keccak256("adapter-a"));
        adapterB = new PolicyStrategyAdapter(address(vault), address(usdc), keccak256("adapter-b"));

        vm.startPrank(admin);
        vault.addAdapter(address(adapterA));
        vault.addAdapter(address(adapterB));
        vault.setDependencyCap(PROTOCOL_GROUP, 10_000, type(uint256).max);
        vault.setAdapterDependencies(address(adapterA), _dependencies(PROTOCOL_GROUP));
        vault.setAdapterDependencies(address(adapterB), _dependencies(PROTOCOL_GROUP));
        vm.stopPrank();
    }

    function test_effectiveCapUsesLowestLimit() public {
        _setLimits(adapterA, 6_000, 40_000e6, 0);
        _depositAlice(100_000e6);

        assertEq(vault.effectiveAdapterCap(address(adapterA)), 40_000e6);
    }

    function test_effectiveCapShrinksWhenOtherAdapterConsumesDependencyHeadroom() public {
        _depositAlice(100_000e6);

        vm.prank(admin);
        vault.setDependencyCap(PROTOCOL_GROUP, 6_000, 60_000e6);
        _seedAdapterExposure(adapterB, 25_000e6);

        assertEq(vault.effectiveAdapterCap(address(adapterA)), 35_000e6);
    }

    function test_effectiveCapTracksPercentageAfterNavChange() public {
        _setLimits(adapterA, 5_000, type(uint256).max, 0);
        _depositAlice(100_000e6);

        assertEq(vault.effectiveAdapterCap(address(adapterA)), 50_000e6);

        vm.prank(alice);
        vault.withdraw(50_000e6, alice, alice);

        assertEq(vault.effectiveAdapterCap(address(adapterA)), 25_000e6);
    }

    function test_setAdapterDependenciesRejectsDuplicateGroupMembership() public {
        bytes32[] memory duplicated = new bytes32[](2);
        duplicated[0] = PROTOCOL_GROUP;
        duplicated[1] = PROTOCOL_GROUP;

        vm.prank(admin);
        vm.expectRevert(NavyVault.DuplicateDependencyGroup.selector);
        vault.setAdapterDependencies(address(adapterA), duplicated);
    }

    function test_commonModeGroupAcceptsHundredPercentLimit() public {
        vm.startPrank(admin);
        vault.setDependencyCap(COMMON_MODE_GROUP, 10_000, type(uint256).max);
        vault.setAdapterDependencies(address(adapterA), _dependencies(PROTOCOL_GROUP, COMMON_MODE_GROUP));
        vm.stopPrank();

        _depositAlice(80_000e6);

        assertEq(vault.dependencyCap(COMMON_MODE_GROUP), 80_000e6);
    }

    function test_setAdapterLimitsRejectsCurrentExposureAboveCap() public {
        _depositAlice(100_000e6);
        _seedAdapterExposure(adapterA, 60_000e6);

        vm.prank(admin);
        vm.expectRevert(NavyVault.AdapterCapExceeded.selector);
        vault.setAdapterLimits(address(adapterA), 5_000, 50_000e6, 0, type(uint256).max);
    }

    function test_setDependencyCapRejectsCurrentExposureAboveCap() public {
        _depositAlice(100_000e6);
        _seedAdapterExposure(adapterA, 40_000e6);
        _seedAdapterExposure(adapterB, 30_000e6);

        vm.prank(admin);
        vm.expectRevert(NavyVault.DependencyCapExceeded.selector);
        vault.setDependencyCap(PROTOCOL_GROUP, 6_000, type(uint256).max);
    }

    function test_setAdapterDependenciesRejectsMembershipThatBreachesCap() public {
        _depositAlice(100_000e6);
        _seedAdapterExposure(adapterA, 35_000e6);
        _seedAdapterExposure(adapterB, 30_000e6);

        vm.startPrank(admin);
        vault.setAdapterDependencies(address(adapterB), new bytes32[](0));
        vault.setDependencyCap(PROTOCOL_GROUP, 4_000, type(uint256).max);
        vm.expectRevert(NavyVault.DependencyCapExceeded.selector);
        vault.setAdapterDependencies(address(adapterB), _dependencies(PROTOCOL_GROUP));
        vm.stopPrank();
    }

    function test_validateProjectedDeployment_allowsExposureWithinAdapterAndDependencyHeadroom() public {
        _depositAlice(100_000e6);

        vm.prank(admin);
        vault.setDependencyCap(PROTOCOL_GROUP, 6_000, 60_000e6);
        _seedAdapterExposure(adapterB, 25_000e6);

        vault.validateProjectedDeployment(address(adapterA), 35_000e6);
    }

    function test_validateProjectedDeployment_rejectsAdapterCapBreach() public {
        _depositAlice(100_000e6);
        _setLimits(adapterA, 4_000, type(uint256).max, 0);

        vm.expectRevert(NavyVault.AdapterCapExceeded.selector);
        vault.validateProjectedDeployment(address(adapterA), 40_001e6);
    }

    function test_validateProjectedDeployment_rejectsDependencyBreach() public {
        _depositAlice(100_000e6);

        vm.prank(admin);
        vault.setDependencyCap(PROTOCOL_GROUP, 6_000, 60_000e6);
        _seedAdapterExposure(adapterB, 25_000e6);

        vm.expectRevert(NavyVault.DependencyCapExceeded.selector);
        vault.validateProjectedDeployment(address(adapterA), 35_001e6);
    }

    function test_requiredIdleUsesAdminFloorUntilPlanReserveIsHigher() public {
        vm.prank(admin);
        vault.setAdminIdleFloor(15_000e6);
        vault.setActivePlanReserveForTest(20_000e6);
        assertEq(vault.requiredIdle(), 20_000e6);

        vault.setActivePlanReserveForTest(5_000e6);
        assertEq(vault.requiredIdle(), 15_000e6);
    }

    function test_redeemAggregatesLossAcrossAdapters() public {
        _depositAlice(100_000e6);
        _setLimits(adapterA, 10_000, type(uint256).max, 100);
        _setLimits(adapterB, 10_000, type(uint256).max, 100);

        _seedAdapterExposure(adapterA, 60_000e6);
        _seedAdapterExposure(adapterB, 30_000e6);

        adapterA.setWithdrawLoss(100, 0);
        adapterB.setWithdrawLoss(100, 0);

        vm.prank(alice);
        vault.withdraw(80_000e6, alice, alice);

        uint256 idle = usdc.balanceOf(address(vault));
        assertEq(usdc.balanceOf(alice), 80_000e6);
        assertEq(vault.strategyAssets(address(adapterA)), 0);
        assertEq(vault.totalAssets(), idle + vault.strategyAssets(address(adapterB)));
        assertLe(idle, vault.LOSS_DUST() + 1);
        assertLt(vault.totalAssets(), 20_000e6);
    }

    function test_redeemToleratesDustAcrossAdapters() public {
        _depositAlice(100_000e6);
        _seedAdapterExposure(adapterA, 60_000e6);
        _seedAdapterExposure(adapterB, 30_000e6);

        adapterA.setWithdrawLoss(0, 2);
        adapterB.setWithdrawLoss(0, 2);

        vm.prank(alice);
        vault.withdraw(70_000e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 70_000e6);
    }

    function test_allocatorCannotConfigurePolicy() public {
        vm.startPrank(allocator);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setDependencyCap(PROTOCOL_GROUP, 10_000, type(uint256).max);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setAdapterDependencies(address(adapterA), _dependencies(PROTOCOL_GROUP));
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setAdminIdleFloor(1);
        vm.stopPrank();
    }

    function _depositAlice(uint256 amount) internal {
        usdc.mint(alice, amount);

        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(amount, alice);
        vm.stopPrank();
    }

    function _setLimits(PolicyStrategyAdapter adapter, uint16 capBps, uint256 absoluteCap, uint16 maxLossBps) internal {
        vm.prank(admin);
        vault.setAdapterLimits(address(adapter), capBps, absoluteCap, maxLossBps, type(uint256).max);
    }

    function _seedAdapterExposure(PolicyStrategyAdapter adapter, uint256 amount) internal {
        vm.prank(address(vault));
        usdc.transfer(address(adapter), amount);
        adapter.setReportedAssets(amount);
        adapter.setMaxWithdrawable(amount);
    }

    function _dependencies(bytes32 dependencyA) internal pure returns (bytes32[] memory dependencyIds) {
        dependencyIds = new bytes32[](1);
        dependencyIds[0] = dependencyA;
    }

    function _dependencies(bytes32 dependencyA, bytes32 dependencyB)
        internal
        pure
        returns (bytes32[] memory dependencyIds)
    {
        dependencyIds = new bytes32[](2);
        dependencyIds[0] = dependencyA;
        dependencyIds[1] = dependencyB;
    }
}
