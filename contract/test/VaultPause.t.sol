// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {VaultTypes} from "../src/libraries/VaultTypes.sol";
import {PlanHash} from "../src/libraries/PlanHash.sol";
import {MockStrategyAdapter} from "./mocks/MockStrategyAdapter.sol";
import {MockBaseUsdc} from "./BaseNavyVault.t.sol";

/// @notice Tests for pause/unpause semantics in NavyVault
/// @dev Pause should block deposit/mint/executeDeploy but allow withdraw/redeem/divest
contract VaultPauseTest is Test {
    MockBaseUsdc usdc;
    NavyVault vault;
    MockStrategyAdapter adapter;

    address admin = address(0xA11CE);
    address allocator = address(0xA110CA7E);
    address alice = address(0xA71CE);

    function setUp() public {
        usdc = new MockBaseUsdc();
        vault = new NavyVault(IERC20(address(usdc)), admin, allocator);
        adapter = new MockStrategyAdapter(address(vault), address(usdc), keccak256("adapter-config"));

        // Register adapter and fund alice with USDC for deposit/mint tests
        vm.prank(admin);
        vault.addAdapter(address(adapter));

        usdc.mint(alice, 1000e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    // -------------------------------------------------------------------------
    // test_pauseBlocksDeposit
    // -------------------------------------------------------------------------

    function test_pauseBlocksDeposit() public {
        // Pause the vault
        vm.prank(admin);
        vault.setPaused(true);

        assertTrue(vault.paused());

        // Alice cannot deposit when paused
        vm.prank(alice);
        vm.expectRevert(NavyVault.EnforcedPause.selector);
        vault.deposit(100e6, alice);
    }

    // -------------------------------------------------------------------------
    // test_pauseBlocksMint
    // -------------------------------------------------------------------------

    function test_pauseBlocksMint() public {
        // Pause the vault
        vm.prank(admin);
        vault.setPaused(true);

        assertTrue(vault.paused());

        // Alice cannot mint when paused
        vm.prank(alice);
        vm.expectRevert(NavyVault.EnforcedPause.selector);
        vault.mint(100e6, alice);
    }

    // -------------------------------------------------------------------------
    // test_pauseAllowsWithdraw
    // -------------------------------------------------------------------------

    function test_pauseAllowsWithdraw() public {
        // Alice deposits first (not paused yet)
        vm.prank(alice);
        vault.deposit(100e6, alice);

        assertGt(vault.balanceOf(alice), 0);

        // Pause the vault
        vm.prank(admin);
        vault.setPaused(true);

        assertTrue(vault.paused());

        // Alice CAN withdraw when paused
        uint256 maxWithdraw = vault.maxWithdraw(alice);

        vm.prank(alice);
        vault.withdraw(maxWithdraw, alice, alice);

        assertEq(vault.balanceOf(alice), 0);
    }

    // -------------------------------------------------------------------------
    // test_pauseAllowsRedeem
    // -------------------------------------------------------------------------

    function test_pauseAllowsRedeem() public {
        // Alice deposits first (not paused yet)
        vm.prank(alice);
        vault.deposit(100e6, alice);

        assertGt(vault.balanceOf(alice), 0);

        // Pause the vault
        vm.prank(admin);
        vault.setPaused(true);

        assertTrue(vault.paused());

        // Alice CAN redeem when paused
        uint256 maxRedeem = vault.maxRedeem(alice);

        vm.prank(alice);
        vault.redeem(maxRedeem, alice, alice);

        assertEq(vault.balanceOf(alice), 0);
    }

    // -------------------------------------------------------------------------
    // test_pauseBlocksNewPlans
    // -------------------------------------------------------------------------

    function test_pauseBlocksNewPlans() public {
        // Fund the vault so executeDeploy has idle USDC
        usdc.mint(address(vault), 200e6);

        // Register and activate a plan with the allocator
        VaultTypes.PlanHeader memory header = _buildValidPlanHeader(1);
        bytes32 actionHash = _hashAction(
            VaultTypes.Action({
                planId: 1,
                kind: VaultTypes.ActionKind.Deploy,
                index: 0,
                adapter: address(adapter),
                amount: 100e6,
                minOut: 0
            })
        );

        vm.prank(allocator);
        vault.registerPlan(header, actionHash);

        // Pause the vault
        vm.prank(admin);
        vault.setPaused(true);

        assertTrue(vault.paused());

        // Allocator cannot execute deploy when paused
        VaultTypes.Action memory action = _buildDeployAction(1, 0, address(adapter), 100e6);
        vm.prank(allocator);
        vm.expectRevert(NavyVault.EnforcedPause.selector);
        vault.executeDeploy(action, new bytes32[](0));
    }

    // -------------------------------------------------------------------------
    // test_unpauseAllowsDeposits
    // -------------------------------------------------------------------------

    function test_unpauseAllowsDeposits() public {
        // Pause the vault
        vm.prank(admin);
        vault.setPaused(true);

        assertTrue(vault.paused());

        // Alice cannot deposit when paused
        vm.prank(alice);
        vm.expectRevert(NavyVault.EnforcedPause.selector);
        vault.deposit(100e6, alice);

        // Unpause the vault
        vm.prank(admin);
        vault.setPaused(false);

        assertFalse(vault.paused());

        // Alice CAN deposit after unpause
        vm.prank(alice);
        uint256 shares = vault.deposit(100e6, alice);

        assertGt(shares, 0);
        assertEq(vault.balanceOf(alice), shares);
    }

    // -------------------------------------------------------------------------
    // Helper functions
    // -------------------------------------------------------------------------

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
    ) internal pure returns (VaultTypes.Action memory) {
        return VaultTypes.Action({
            planId: planId,
            kind: VaultTypes.ActionKind.Deploy,
            index: index,
            adapter: adapterAddr,
            amount: amount,
            minOut: 0
        });
    }

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
