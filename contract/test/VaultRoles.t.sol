// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {VaultTypes} from "../src/libraries/VaultTypes.sol";
import {PlanHash} from "../src/libraries/PlanHash.sol";
import {MockStrategyAdapter} from "./mocks/MockStrategyAdapter.sol";
import {MockBaseUsdc} from "./BaseNavyVault.t.sol";

/// @notice Tests for role-based access control in NavyVault
contract VaultRolesTest is Test {
    MockBaseUsdc usdc;
    NavyVault vault;
    MockStrategyAdapter adapter;

    address admin = address(0xA11CE);
    address allocator = address(0xA110CA7E);
    address stranger = address(0xBAD);

    function setUp() public {
        usdc = new MockBaseUsdc();
        vault = new NavyVault(IERC20(address(usdc)), admin, allocator);
        adapter = new MockStrategyAdapter(address(vault), address(usdc), keccak256("adapter-config"));
    }

    // -------------------------------------------------------------------------
    // Admin-only: addAdapter
    // -------------------------------------------------------------------------

    function test_onlyAdminCanRegisterAdapter() public {
        // stranger cannot register
        vm.prank(stranger);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.addAdapter(address(adapter));

        // admin can register
        vm.prank(admin);
        vault.addAdapter(address(adapter));

        assertEq(vault.configuredAdapters().length, 1);
    }

    // -------------------------------------------------------------------------
    // Admin-only: setAdapterStatus
    // -------------------------------------------------------------------------

    function test_onlyAdminCanChangeAdapterState() public {
        // Register adapter first (admin-only)
        vm.prank(admin);
        vault.addAdapter(address(adapter));

        // stranger cannot change adapter status
        vm.prank(stranger);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Disabled);

        // allocator cannot change adapter status (not owner)
        vm.prank(allocator);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Disabled);

        // admin can change adapter status
        vm.prank(admin);
        vault.setAdapterStatus(address(adapter), VaultTypes.AdapterStatus.Disabled);

        assertEq(uint8(vault.adapterStatus(address(adapter))), uint8(VaultTypes.AdapterStatus.Disabled));
    }

    // -------------------------------------------------------------------------
    // Admin-only: setPaused
    // -------------------------------------------------------------------------

    function test_onlyAdminCanPause() public {
        // stranger cannot pause
        vm.prank(stranger);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setPaused(true);

        // allocator cannot pause
        vm.prank(allocator);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.setPaused(true);

        // admin can pause
        vm.prank(admin);
        vault.setPaused(true);

        assertTrue(vault.paused());
    }

    // -------------------------------------------------------------------------
    // Allocator-only: registerPlan
    // -------------------------------------------------------------------------

    function test_onlyAllocatorCanRegisterPlan() public {
        VaultTypes.PlanHeader memory header = _buildValidPlanHeader(1);

        // admin (owner) cannot register plan
        vm.prank(admin);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.registerPlan(header, keccak256("actions-root"));

        // stranger cannot register plan
        vm.prank(stranger);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.registerPlan(header, keccak256("actions-root"));

        // allocator can register plan
        vm.prank(allocator);
        vault.registerPlan(header, keccak256("actions-root"));
    }

    // -------------------------------------------------------------------------
    // Allocator-only: executeDeploy
    // -------------------------------------------------------------------------

    function test_onlyAllocatorCanExecuteDeploy() public {
        // Register adapter and fund vault with idle USDC for deploy
        vm.prank(admin);
        vault.addAdapter(address(adapter));
        usdc.mint(address(vault), 200e6);

        VaultTypes.Action memory actionMem = _buildDeployAction(1, 0, address(adapter), 100e6);
        bytes32 actionHash = _hashAction(actionMem);
        _registerPlanWithActionHash(actionHash);

        // admin (owner) cannot execute deploy
        vm.prank(admin);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.executeDeploy(actionMem, new bytes32[](0));

        // stranger cannot execute deploy
        vm.prank(stranger);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.executeDeploy(actionMem, new bytes32[](0));

        // allocator can execute deploy
        vm.prank(allocator);
        vault.executeDeploy(actionMem, new bytes32[](0));
    }

    // -------------------------------------------------------------------------
    // Allocator-only: executeDivest
    // -------------------------------------------------------------------------

    function test_onlyAllocatorCanExecuteDivest() public {
        // Register adapter and fund it with USDC
        vm.prank(admin);
        vault.addAdapter(address(adapter));
        adapter.setReportedAssets(100e6);
        adapter.setMaxWithdrawable(100e6);
        // Give adapter USDC to return during divest
        usdc.mint(address(adapter), 100e6);

        VaultTypes.Action memory actionMem = _buildDivestAction(1, 0, address(adapter), 50e6);
        bytes32 actionHash = _hashAction(actionMem);
        _registerPlanWithActionHash(actionHash);

        // admin (owner) cannot execute divest
        vm.prank(admin);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.executeDivest(actionMem, new bytes32[](0));

        // stranger cannot execute divest
        vm.prank(stranger);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.executeDivest(actionMem, new bytes32[](0));

        // allocator can execute divest
        vm.prank(allocator);
        vault.executeDivest(actionMem, new bytes32[](0));
    }

    // -------------------------------------------------------------------------
    // Admin cannot execute plan (explicit test per brief)
    // -------------------------------------------------------------------------

    function test_adminCannotExecutePlan() public {
        _registerAdapterAndPlan();

        // Admin explicitly cannot execute deploy plan
        VaultTypes.Action memory deployAction = _buildDeployAction(1, 0, address(adapter), 100e6);
        vm.prank(admin);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.executeDeploy(deployAction, new bytes32[](0));

        // Admin explicitly cannot execute divest plan
        VaultTypes.Action memory divestAction = _buildDivestAction(1, 0, address(adapter), 100e6);
        vm.prank(admin);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.executeDivest(divestAction, new bytes32[](0));

        // Admin explicitly cannot register plan
        VaultTypes.PlanHeader memory header = _buildValidPlanHeader(2);
        vm.prank(admin);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        vault.registerPlan(header, keccak256("other-actions-root"));
    }

    // -------------------------------------------------------------------------
    // Helper functions
    // -------------------------------------------------------------------------

    function _registerAdapterAndPlan() internal {
        vm.prank(admin);
        vault.addAdapter(address(adapter));

        VaultTypes.PlanHeader memory header = _buildValidPlanHeader(1);
        vm.prank(allocator);
        vault.registerPlan(header, keccak256("actions-root"));
    }

    /// @dev Registers a plan with a valid actionsRoot (adapter already registered)
    function _registerPlanWithActionHash(bytes32 actionHash) internal {
        VaultTypes.PlanHeader memory header = _buildValidPlanHeader(1);
        vm.prank(allocator);
        vault.registerPlan(header, actionHash);
    }

    function _buildValidPlanHeader(uint256 planId) internal view returns (VaultTypes.PlanHeader memory) {
        return VaultTypes.PlanHeader({
            planId: planId,
            policyVersion: vault.policyVersion(),
            createdAt: uint64(block.timestamp - 1),
            expiresAt: uint64(block.timestamp + 1 days),
            actionCount: 1,
            snapshotBlockNumber: 0,
            snapshotHash: bytes32(0),
            decisionHash: bytes32(0),
            configurationDigest: vault.configurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
    }

    function _buildDeployAction(
        uint256 planId,
        uint32 index,
        address adapterAddr,
        uint256 amount
    ) internal view returns (VaultTypes.Action memory) {
        return VaultTypes.Action({
            planId: planId,
            kind: VaultTypes.ActionKind.Deploy,
            index: index,
            adapter: adapterAddr,
            amount: amount,
            minOut: 0
        });
    }

    function _buildDivestAction(
        uint256 planId,
        uint32 index,
        address adapterAddr,
        uint256 amount
    ) internal view returns (VaultTypes.Action memory) {
        return VaultTypes.Action({
            planId: planId,
            kind: VaultTypes.ActionKind.Divest,
            index: index,
            adapter: adapterAddr,
            amount: amount,
            minOut: 0
        });
    }

    /// @dev Compute action hash matching the vault's PlanHash logic
    function _hashAction(VaultTypes.Action memory action) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                VaultTypes.ACTION_TYPEHASH,
                action.planId,
                action.index,
                action.kind,
                action.adapter,
                action.amount,
                action.minOut
            )
        );
    }
}
