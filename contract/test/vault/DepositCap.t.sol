// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {IVaultEvents} from "../../src/interfaces/IVaultEvents.sol";
import {MockERC20} from "../../src/MockERC20.sol";

/// @notice P37 G5: the admin-set deposit cap bounds deposits and mints, never
///         withdrawals, and an uncapped vault behaves exactly as before.
contract DepositCapTest is Test {
    uint256 internal constant CAP = 1_000_000e6;

    MockERC20 internal usdc;
    NavyVaultSRCLA internal vault;

    address internal admin = makeAddr("admin");
    address internal allocator = makeAddr("allocator");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        usdc.mint(who, assets);
        vm.startPrank(who);
        usdc.approve(address(vault), assets);
        shares = vault.deposit(assets, who);
        vm.stopPrank();
    }

    function test_depositCapDefaultsToUncapped() public {
        assertEq(vault.depositCap(), type(uint256).max, "a new vault is uncapped");
        _deposit(alice, 5_000_000e6);
        assertEq(vault.maxDeposit(bob), type(uint256).max, "an uncapped vault keeps advertising unlimited deposits");
        assertEq(vault.maxMint(bob), type(uint256).max, "and unlimited mints");
    }

    function test_onlyAdminCanSetTheDepositCap() public {
        bytes32 adminRole = vault.ADMIN_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole)
        );
        vault.setDepositCap(CAP);

        vm.prank(allocator);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, allocator, adminRole)
        );
        vault.setDepositCap(CAP);
    }

    function test_setDepositCapEmitsDepositCapSet() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit IVaultEvents.DepositCapSet(type(uint256).max, CAP);
        vm.prank(admin);
        vault.setDepositCap(CAP);

        assertEq(vault.depositCap(), CAP, "the cap is stored");
    }

    function test_maxDepositAndMaxMintAreTheRoomBelowTheCap() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        _deposit(alice, 400_000e6);

        assertEq(vault.maxDeposit(bob), 600_000e6, "room is the cap minus totalAssets");
        assertEq(vault.maxMint(bob), vault.convertToShares(600_000e6), "maxMint is the room in shares, rounded down");
    }

    function test_depositUpToTheCapSucceedsAndOneMoreUnitReverts() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        _deposit(alice, CAP);

        assertEq(vault.totalAssets(), CAP, "a deposit of exactly the room fills the cap");
        assertEq(vault.maxDeposit(bob), 0, "a full vault advertises no room");

        usdc.mint(bob, 1);
        vm.startPrank(bob);
        usdc.approve(address(vault), 1);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1, 0));
        vault.deposit(1, bob);
        vm.stopPrank();
    }

    function test_mintAboveMaxMintReverts() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        _deposit(alice, 400_000e6);

        uint256 maxShares = vault.maxMint(bob);
        uint256 shares = maxShares + 1;
        uint256 assetsNeeded = vault.previewMint(shares);
        usdc.mint(bob, assetsNeeded);

        vm.startPrank(bob);
        usdc.approve(address(vault), assetsNeeded);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxMint.selector, bob, shares, maxShares));
        vault.mint(shares, bob);
        vm.stopPrank();
    }

    function test_yieldMayCarryAssetsPastTheCapAndOnlyClosesDeposits() public {
        vm.prank(admin);
        vault.setDepositCap(CAP);
        uint256 shares = _deposit(alice, CAP);

        usdc.mint(address(vault), 10_000e6); // accrued yield, no shares minted
        assertGt(vault.totalAssets(), CAP, "yield is not clamped by the cap");
        assertEq(vault.maxDeposit(bob), 0, "deposits close above the cap");
        assertEq(vault.maxMint(bob), 0, "mints close above the cap");

        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares / 2, alice, alice);
        assertGt(assetsOut, 0, "withdrawals are unaffected by the cap");
    }

    function test_loweringTheCapBelowNavClosesDepositsButNotWithdrawals() public {
        uint256 shares = _deposit(alice, 500_000e6);

        vm.prank(admin);
        vault.setDepositCap(100_000e6);
        assertEq(vault.maxDeposit(bob), 0, "a cap below NAV admits nothing");

        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares / 10, alice, alice);
        assertGt(assetsOut, 0, "a cap below NAV never blocks a redemption");
    }

    function test_theExistingZeroCasesStillWinBelowTheCap() public {
        vm.startPrank(admin);
        vault.setDepositCap(CAP);
        vault.pause();
        vm.stopPrank();

        assertEq(vault.maxDeposit(bob), 0, "a paused vault advertises no deposits even below its cap");
        assertEq(vault.maxMint(bob), 0, "nor mints");
    }

    function test_settingTheCapBackToMaxRestoresUncapped() public {
        vm.startPrank(admin);
        vault.setDepositCap(CAP);
        vault.setDepositCap(type(uint256).max);
        vm.stopPrank();

        _deposit(alice, 5_000_000e6);
        assertEq(vault.maxDeposit(bob), type(uint256).max, "type(uint256).max is uncapped, not netted against NAV");
        assertEq(vault.maxMint(bob), type(uint256).max, "and maxMint does not overflow converting it");
    }

    function testFuzz_depositNeverTakesAssetsPastTheCap(uint256 cap, uint256 first, uint256 second) public {
        cap = bound(cap, 1, 1_000_000_000e6);
        first = bound(first, 1, cap);
        second = bound(second, 1, 2_000_000_000e6);

        vm.prank(admin);
        vault.setDepositCap(cap);
        _deposit(alice, first);

        uint256 room = vault.maxDeposit(bob);
        assertEq(room, cap - first, "room is the cap minus what is already in");

        usdc.mint(bob, second);
        vm.startPrank(bob);
        usdc.approve(address(vault), second);
        if (second > room) {
            vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, second, room));
        }
        vault.deposit(second, bob);
        vm.stopPrank();

        assertLe(vault.totalAssets(), cap, "deposits alone never carry totalAssets past the cap");
    }

    function testFuzz_maxMintNeverAdmitsMoreAssetsThanMaxDeposit(uint256 cap, uint256 first, uint256 yield_)
        public
    {
        cap = bound(cap, 1, 1_000_000_000e6);
        first = bound(first, 1, cap);
        yield_ = bound(yield_, 0, 1_000_000e6);

        vm.prank(admin);
        vault.setDepositCap(cap);
        _deposit(alice, first);
        usdc.mint(address(vault), yield_);

        uint256 shares = vault.maxMint(bob);
        uint256 assetsNeeded = vault.previewMint(shares);
        assertLe(assetsNeeded, vault.maxDeposit(bob), "minting maxMint shares never needs more than maxDeposit");

        if (shares > 0) {
            usdc.mint(bob, assetsNeeded);
            vm.startPrank(bob);
            usdc.approve(address(vault), assetsNeeded);
            vault.mint(shares, bob);
            vm.stopPrank();
            assertLe(vault.totalAssets(), cap, "a mint of maxMint shares stays within the cap");
        }
    }
}
