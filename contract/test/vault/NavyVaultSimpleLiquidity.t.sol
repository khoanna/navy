// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {NavyVaultSimple} from "../../src/NavyVaultSimple.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @title NavyVaultSimpleLiquidityTest
/// @notice NEW-25. `NavyVaultSimple` is what the documented Anvil bring-up
///         deploys, and it had NO tests of any kind. Two defects on the
///         withdrawal path are pinned here:
///
///         1. `maxRedeem` was not overridden, so it inherited ERC-4626's
///            default - the owner's entire share balance, ignoring synchronous
///            liquidity - contradicting paper 5.2 ("`maxWithdraw` AND
///            `maxRedeem` are capped by Q^sync") and making `be`'s
///            EXCEEDS_MAX_REDEEM precheck wave through a redeem that reverts
///            after the user has paid gas.
///         2. `_withdraw`'s parameters were named (owner, receiver, _) against
///            ERC-4626's actual (caller, receiver, owner) order, so an
///            approved third-party redeem spent the OWNER's allowance and then
///            burned the CALLER's shares.
abstract contract NavyVaultSimpleBase is Test {
    NavyVaultSimple internal vault;
    MockUSDC internal usdc;

    address internal user = address(0xB0B);
    address internal spender = address(0x5EED);
    /// @dev `registerAdapter` performs no interface check and
    ///      `testDepositToAdapter` is a plain transfer, so a bare address is a
    ///      sufficient sink for parking assets outside the idle balance.
    address internal adapter = address(0xADA9);

    uint256 internal constant DEPOSIT = 1_000e6;
    uint256 internal constant PARKED = 900e6;
    uint256 internal constant IDLE = DEPOSIT - PARKED;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new NavyVaultSimple(IERC20(address(usdc)));
        vault.registerAdapter(adapter, 10_000, 500);

        usdc.mint(user, DEPOSIT);
        vm.startPrank(user);
        usdc.approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT, user);
        vm.stopPrank();
    }

    /// @dev Park most of the pool outside the vault so NAV stays at DEPOSIT
    ///      while the synchronously available balance falls to IDLE.
    function _park() internal {
        vault.testDepositToAdapter(adapter, PARKED);
        assertEq(vault.synchronousLiquidity(), IDLE, "precondition: only IDLE is synchronously available");
        assertEq(vault.totalAssets(), DEPOSIT, "precondition: NAV is unchanged - the assets moved, not vanished");
    }

}

/// @notice Paper 5.2's redeem ceiling on the simple vault.
contract NavyVaultSimpleMaxRedeemTest is NavyVaultSimpleBase {
    // ==================================================================
    // NEW-25 - maxRedeem must be capped by synchronous liquidity
    // ==================================================================

    /// @notice The defect itself. `maxRedeem` must report what the vault can
    ///         actually pay today, not the owner's whole balance.
    /// @dev Mutant check: deleting the `maxRedeem` override (falling back to
    ///      ERC-4626's default) makes `maxRedeem` equal `balanceOf` and both
    ///      the strict-inequality and the exact-value assertions fail.
    function test_maxRedeemIsCappedBySynchronousLiquidityNotTheShareBalance() public {
        _park();

        uint256 shares = vault.balanceOf(user);
        uint256 capped = vault.maxRedeem(user);

        assertLt(capped, shares, "maxRedeem must be STRICTLY below the full share balance while assets are parked");
        assertEq(capped, vault.convertToShares(IDLE), "and must equal the share value of the synchronous liquidity");
        assertLe(vault.convertToAssets(capped), IDLE, "converting it back must never exceed what the vault holds");
    }

    /// @notice The user-visible consequence: without the cap, an ERC-4626
    ///         client that trusts `maxRedeem` sends a transaction that reverts
    ///         only once it tries to move USDC the vault does not hold.
    /// @dev Mutant check: without the override this call reverts with
    ///      MockUSDC's "insufficient balance" string instead of
    ///      ERC4626ExceededMaxRedeem, so the expectRevert fails - which is
    ///      exactly the difference between a precheckable cap and a wasted
    ///      transaction.
    function test_redeemingTheFullBalanceIsRejectedByTheCapNotByAFailedTransfer() public {
        _park();

        // Read every value BEFORE arming expectRevert: each of these is its own
        // external call and would otherwise absorb the cheatcode.
        uint256 shares = vault.balanceOf(user);
        uint256 capped = vault.maxRedeem(user);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, user, shares, capped)
        );
        vault.redeem(shares, user, user);
    }

    /// @notice The cap is honest in the other direction too: redeeming exactly
    ///         `maxRedeem` succeeds and is fully paid out.
    /// @dev Mutant check: a `maxRedeem` that returns 0, or that rounds UP when
    ///      converting liquidity to shares, fails here.
    function test_redeemingExactlyMaxRedeemSucceedsAndIsPaidInFull() public {
        _park();

        uint256 capped = vault.maxRedeem(user);
        assertGt(capped, 0, "precondition: the cap is not degenerate");

        vm.prank(user);
        uint256 assets = vault.redeem(capped, user, user);

        assertEq(usdc.balanceOf(user), assets, "the user was paid the assets redeem reported");
        assertEq(assets, IDLE, "and that is the whole synchronous balance");
        assertEq(usdc.balanceOf(address(vault)), 0, "the vault paid out of idle, to the last unit");
    }

    /// @notice The cap is a cap, not a block: with no assets parked, the owner
    ///         can still redeem everything.
    /// @dev Mutant check: `maxRedeem` hard-returning `synchronousLiquidity()`
    ///      (assets, not shares) or 0 fails here.
    function test_withFullIdleTheCapIsTheWholeShareBalance() public {
        uint256 shares = vault.balanceOf(user);
        assertEq(vault.maxRedeem(user), shares, "nothing is parked, so nothing is capped");

        // Hoisted: vm.prank binds to the literal next external call, and an
        // inline vault.balanceOf(user) argument would have absorbed it.
        vm.prank(user);
        uint256 assets = vault.redeem(shares, user, user);
        assertEq(assets, DEPOSIT, "the full position is redeemable");
        assertEq(vault.balanceOf(user), 0, "and the shares are gone");
    }

    /// @notice Paper 5.2 treats the two ceilings as one invariant. Pin that
    ///         they agree rather than each being capped by a different figure.
    function test_maxRedeemAndMaxWithdrawAgreeUnderTheSameLiquidity() public {
        _park();

        uint256 maxAssets = vault.maxWithdraw(user);
        uint256 maxShares = vault.maxRedeem(user);

        assertEq(maxAssets, IDLE, "maxWithdraw is capped by synchronous liquidity");
        assertLe(vault.convertToAssets(maxShares), maxAssets, "maxRedeem cannot exceed maxWithdraw in asset terms");
        assertLt(maxAssets, vault.convertToAssets(vault.balanceOf(user)), "and both are below the unrestricted claim");
    }

    /// @notice A fuzzed liquidity level AND a fuzzed share price: the cap must
    ///         hold everywhere, not just at the one hand-picked split above and
    ///         not just at a 1:1 price. The donated yield is what makes the
    ///         Floor/Ceil choice inside `maxRedeem` observable - at 1:1 the two
    ///         roundings agree, so a unit-price-only test cannot see it.
    /// @dev Deliberately terse: via_ir runs out of stack slots on a longer body.
    ///      Mutant check: `Math.Rounding.Ceil` in `maxRedeem` advertises one
    ///      share more than the idle balance can pay for and this fails.
    function testFuzz_maxRedeemIsNeverMoreThanTheVaultCanPay(uint96 parkSeed, uint96 yieldSeed) public {
        usdc.mint(address(vault), uint256(yieldSeed) % (16 * DEPOSIT));
        vault.testDepositToAdapter(adapter, uint256(parkSeed) % (DEPOSIT + 1));
        uint256 capped = vault.maxRedeem(user);
        assertLe(vault.previewRedeem(capped), vault.synchronousLiquidity());
        assertLe(capped, vault.balanceOf(user));
        if (capped == 0) return;
        vm.prank(user);
        vault.redeem(capped, user, user); // must not revert
    }

}

/// @notice ERC-4626 withdraw-path ownership on the simple vault.
contract NavyVaultSimpleWithdrawOwnerTest is NavyVaultSimpleBase {
    // ==================================================================
    // _withdraw burned from the caller instead of the owner
    // ==================================================================

    /// @notice An approved third-party redeem must burn the OWNER's shares.
    /// @dev The spender is given its own position first, so the pre-fix
    ///      `_burn(caller, ...)` would SUCCEED silently rather than reverting
    ///      on a zero balance - the assertions, not a revert, are what catch
    ///      it. Mutant check: restoring `_burn(<first parameter>, shares)`
    ///      leaves the owner's shares intact and destroys the spender's, so
    ///      both balance assertions fail.
    function test_anApprovedRedeemBurnsTheOwnersSharesNotTheCallers() public {
        usdc.mint(spender, DEPOSIT);
        vm.startPrank(spender);
        usdc.approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT, spender);
        vm.stopPrank();

        uint256 ownerSharesBefore = vault.balanceOf(user);
        uint256 spenderSharesBefore = vault.balanceOf(spender);
        uint256 redeemShares = ownerSharesBefore / 4;

        vm.prank(user);
        vault.approve(spender, redeemShares);

        vm.prank(spender);
        vault.redeem(redeemShares, spender, user);

        assertEq(vault.balanceOf(user), ownerSharesBefore - redeemShares, "the owner's shares were burned");
        assertEq(vault.balanceOf(spender), spenderSharesBefore, "the caller's own shares were untouched");
        assertEq(vault.allowance(user, spender), 0, "and the owner's allowance was consumed");
    }

    /// @notice An unapproved caller cannot redeem someone else's position.
    function test_anUnapprovedCallerCannotRedeemAnothersShares() public {
        uint256 shares = vault.balanceOf(user);

        vm.prank(spender);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, spender, 0, shares)
        );
        vault.redeem(shares, spender, user);
    }

    /// @notice ERC-4626's `Withdraw` event was dropped by the old override.
    ///         `be`'s vault watcher reconciles against it, so pin that it is
    ///         emitted with the standard argument order.
    /// @dev Mutant check: an override that burns and transfers without calling
    ///      `super._withdraw` emits nothing and this fails.
    function test_redeemEmitsTheStandardWithdrawEvent() public {
        uint256 shares = vault.balanceOf(user);
        uint256 assets = vault.previewRedeem(shares);

        vm.expectEmit(true, true, true, true, address(vault));
        emit IERC4626.Withdraw(user, user, user, assets, shares);

        vm.prank(user);
        vault.redeem(shares, user, user);
    }
}
