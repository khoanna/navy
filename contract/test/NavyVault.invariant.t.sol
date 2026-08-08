// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {
    NavyVaultPolicyHarness,
    PolicyBaseUsdc,
    PolicyStrategyAdapter,
    VaultPolicyHandler
} from "./handlers/VaultPolicyHandler.sol";

contract NavyVaultInvariantTest is Test {
    bytes32 internal constant PROTOCOL_GROUP = keccak256("protocol-group");

    PolicyBaseUsdc internal usdc;
    NavyVaultPolicyHarness internal vault;
    PolicyStrategyAdapter internal adapterA;
    PolicyStrategyAdapter internal adapterB;
    VaultPolicyHandler internal handler;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110CA7E);
    address internal actor = address(0xA71CE);

    function setUp() public {
        usdc = new PolicyBaseUsdc();
        vault = new NavyVaultPolicyHarness(usdc, admin, allocator);
        adapterA = new PolicyStrategyAdapter(address(vault), address(usdc), keccak256("adapter-a"));
        adapterB = new PolicyStrategyAdapter(address(vault), address(usdc), keccak256("adapter-b"));

        vm.startPrank(admin);
        vault.addAdapter(address(adapterA));
        vault.addAdapter(address(adapterB));
        vault.setAdapterLimits(address(adapterA), 7_000, type(uint256).max, 0, type(uint256).max);
        vault.setAdapterLimits(address(adapterB), 7_000, type(uint256).max, 0, type(uint256).max);
        vault.setDependencyCap(PROTOCOL_GROUP, 9_000, type(uint256).max);
        vault.setAdapterDependencies(address(adapterA), _dependencies(PROTOCOL_GROUP));
        vault.setAdapterDependencies(address(adapterB), _dependencies(PROTOCOL_GROUP));
        vm.stopPrank();

        handler = new VaultPolicyHandler(usdc, vault, adapterA, adapterB, admin, allocator, actor);
        targetContract(address(handler));
    }

    function invariant_exposureNeverExceedsAdapterOrDependencyCaps() public view {
        assertLe(vault.strategyAssets(address(adapterA)), vault.effectiveAdapterCap(address(adapterA)));
        assertLe(vault.strategyAssets(address(adapterB)), vault.effectiveAdapterCap(address(adapterB)));
        assertLe(vault.dependencyExposure(PROTOCOL_GROUP), vault.dependencyCap(PROTOCOL_GROUP));
    }

    function invariant_requiredIdleAlwaysTracksHigherFloor() public view {
        uint256 expected =
            vault.adminIdleFloor() > vault.activePlanReserve() ? vault.adminIdleFloor() : vault.activePlanReserve();
        assertEq(vault.requiredIdle(), expected);
    }

    function _dependencies(bytes32 dependencyA) internal pure returns (bytes32[] memory dependencyIds) {
        dependencyIds = new bytes32[](1);
        dependencyIds[0] = dependencyA;
    }
}

contract NavyVaultFuzzTest is Test {
    bytes32 internal constant PROTOCOL_GROUP = keccak256("protocol-group");

    PolicyBaseUsdc internal usdc;
    NavyVaultPolicyHarness internal vault;
    PolicyStrategyAdapter internal adapterA;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110CA7E);
    address internal alice = address(0xA71CE);

    function setUp() public {
        usdc = new PolicyBaseUsdc();
        vault = new NavyVaultPolicyHarness(usdc, admin, allocator);
        adapterA = new PolicyStrategyAdapter(address(vault), address(usdc), keccak256("adapter-a"));

        vm.startPrank(admin);
        vault.addAdapter(address(adapterA));
        vault.setDependencyCap(PROTOCOL_GROUP, 10_000, type(uint256).max);
        vault.setAdapterDependencies(address(adapterA), _dependencies(PROTOCOL_GROUP));
        vm.stopPrank();
    }

    function testFuzz_requiredIdleReturnsMax(uint96 adminFloor, uint96 planReserve) public {
        uint256 boundedAdminFloor = bound(uint256(adminFloor), 0, 250_000e6);
        uint256 boundedPlanReserve = bound(uint256(planReserve), 0, 250_000e6);

        vm.prank(admin);
        vault.setAdminIdleFloor(boundedAdminFloor);
        vault.setActivePlanReserveForTest(boundedPlanReserve);

        assertEq(vault.requiredIdle(), Math.max(boundedAdminFloor, boundedPlanReserve));
    }

    function testFuzz_effectiveAdapterCapUsesCurrentNav(uint96 depositAmount, uint16 capBps, uint96 absoluteCap)
        public
    {
        uint256 boundedDeposit = bound(uint256(depositAmount), 1e6, 250_000e6);
        uint16 boundedCapBps = uint16(bound(uint256(capBps), 0, 10_000));
        uint256 boundedAbsoluteCap = bound(uint256(absoluteCap), 0, 250_000e6);

        vm.prank(admin);
        vault.setAdapterLimits(address(adapterA), boundedCapBps, boundedAbsoluteCap, 0, type(uint256).max);

        usdc.mint(alice, boundedDeposit);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(boundedDeposit, alice);
        vm.stopPrank();

        uint256 expectedCap = Math.min(Math.mulDiv(vault.totalAssets(), boundedCapBps, 10_000), boundedAbsoluteCap);
        assertEq(vault.effectiveAdapterCap(address(adapterA)), expectedCap);
    }

    function testFuzz_dependencyCapUsesCurrentNav(uint96 depositAmount, uint16 capBps, uint96 absoluteCap) public {
        uint256 boundedDeposit = bound(uint256(depositAmount), 1e6, 250_000e6);
        uint16 boundedCapBps = uint16(bound(uint256(capBps), 0, 10_000));
        uint256 boundedAbsoluteCap = bound(uint256(absoluteCap), 0, 250_000e6);

        vm.prank(admin);
        vault.setDependencyCap(PROTOCOL_GROUP, boundedCapBps, boundedAbsoluteCap);

        usdc.mint(alice, boundedDeposit);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(boundedDeposit, alice);
        vm.stopPrank();

        uint256 expectedCap = Math.min(Math.mulDiv(vault.totalAssets(), boundedCapBps, 10_000), boundedAbsoluteCap);
        assertEq(vault.dependencyCap(PROTOCOL_GROUP), expectedCap);
    }

    function _dependencies(bytes32 dependencyA) internal pure returns (bytes32[] memory dependencyIds) {
        dependencyIds = new bytes32[](1);
        dependencyIds[0] = dependencyA;
    }
}
