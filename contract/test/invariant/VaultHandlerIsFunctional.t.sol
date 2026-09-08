// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {InvariantMockUSDC, VaultHandler} from "./NavyVaultInvariant.t.sol";

/// @title VaultHandlerIsFunctionalTest
/// @notice Guards the invariant campaign's handler, deterministically.
///
/// `VaultHandler.deploy()` and `divest()` wrap the whole plan flow in
/// try/catch, so a handler that CANNOT execute a plan reports zero reverts and
/// looks perfectly healthy while doing nothing at all. That is what happened:
///   1. ALLOCATOR_ROLE was granted to the invariant TEST contract, never to the
///      handler - but the handler is the caller (its `vm.prank(address(this))`
///      pranks itself), so every `submitPlan` reverted AccessControl and the
///      `catch` swallowed it; and
///   2. plan ids were derived from `block.timestamp`, which an invariant
///      campaign does not advance, so with three adapters only three plan ids
///      ever existed and the first failed attempt on each burned it through
///      `cancelPlan`'s `usedPlanIds` write.
/// Every invariant that assumes funds were deployed was therefore being checked
/// against a vault that had never deployed anything.
///
/// This is a deterministic unit test rather than an `afterInvariant` assertion
/// because the campaign reverts to the post-setUp snapshot, so the handler's
/// own counters read zero afterwards regardless of what happened during a run.
contract VaultHandlerIsFunctionalTest is Test {
    InvariantMockUSDC usdc; NavyVaultSRCLA vault; VaultHandler handler;
    function setUp() public {
        usdc = new InvariantMockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));
        handler = new VaultHandler(usdc, vault, 3);
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(handler));
        vault.setRewardAccountant(address(handler.accountant()));
        handler.accountant().setVault(address(vault));
        for (uint256 i = 0; i < handler.getAdapterCount(); i++) {
            vault.registerAdapter(address(handler.adapters(i)), 5000, 100, "A");
        }
        usdc.mint(address(vault), 1_000_000_000 * (10 ** 6));
        handler.recordInitialAssets();
    }
    /// @dev Mutant check: removing the ALLOCATOR_ROLE grant below, or
    ///      restoring the block.timestamp-derived plan id, drops
    ///      totalDeployments back to 0 and every assertion here fails.
    function test_theHandlerCanActuallyDeploy() public {
        address adapter0 = address(handler.adapters(0));
        assertEq(vault.strategyAssets(adapter0), 0, "precondition: nothing deployed");

        handler.deploy(0, 1_000e6);

        assertEq(handler.totalDeployments(), 1_000e6, "the handler executed the plan");
        assertEq(vault.strategyAssets(adapter0), 1_000e6, "and the funds reached the adapter");
        assertEq(vault.activePlanId(), bytes32(0), "the single-action plan completed");
    }

    /// @dev A second deploy must also land. Plan ids used to collide because
    ///      they hashed block.timestamp, which does not advance between calls
    ///      here either - so this is the direct regression guard for that.
    function test_consecutiveDeploysToTheSameAdapterDoNotCollideOnPlanId() public {
        // The SAME adapter twice, deliberately: the old plan id hashed
        // (block.timestamp, adapterIndex), and block.timestamp does not advance
        // between these two calls, so both attempts produced the identical plan
        // id and the second failed PlanAlreadyUsed. Two DIFFERENT adapters
        // would not have collided and would not detect the regression.
        handler.deploy(0, 1_000e6);
        handler.deploy(0, 2_000e6);

        assertEq(handler.totalDeployments(), 3_000e6, "both plans executed");
        assertEq(vault.strategyAssets(address(handler.adapters(0))), 3_000e6, "both deploys reached the adapter");
    }

    function test_theHandlerCanActuallyDivest() public {
        address adapter0 = address(handler.adapters(0));
        handler.deploy(0, 5_000e6);
        assertEq(vault.strategyAssets(adapter0), 5_000e6, "precondition: funds are deployed");

        handler.divest(0, 2_000e6);

        assertLt(vault.strategyAssets(adapter0), 5_000e6, "the divest reduced the position");
    }
}
