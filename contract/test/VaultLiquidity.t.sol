// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {MockRewardAccountant} from "./mocks/MockRewardAccountant.sol";
import {MockStrategyAdapter} from "./mocks/MockStrategyAdapter.sol";

contract LiquidityBaseUsdc is ERC20 {
    constructor() ERC20("Base USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VaultLiquidityTest is Test {
    using SafeERC20 for IERC20;

    LiquidityBaseUsdc internal usdc;
    NavyVault internal vault;
    MockStrategyAdapter internal adapterA;
    MockStrategyAdapter internal adapterB;
    MockRewardAccountant internal rewardAccountant;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110CA7E);
    address internal alice = address(0xA71CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        usdc = new LiquidityBaseUsdc();
        vault = new NavyVault(IERC20(address(usdc)), admin, allocator);
        adapterA = new MockStrategyAdapter(address(vault), address(usdc), keccak256("adapter-a"));
        adapterB = new MockStrategyAdapter(address(vault), address(usdc), keccak256("adapter-b"));
        rewardAccountant = new MockRewardAccountant();

        vm.startPrank(admin);
        vault.addAdapter(address(adapterA));
        vault.addAdapter(address(adapterB));
        vm.stopPrank();
    }

    function test_maxWithdrawExcludesAccountingAssetsThatCannotExitNow() public {
        _deposit(alice, 100_000e6);
        _seedAdapter(adapterA, 80_000e6, 10_000e6);

        assertEq(vault.maxWithdraw(alice), 30_000e6);
        assertLt(vault.maxRedeem(alice), vault.balanceOf(alice));
        assertLe(vault.previewRedeem(vault.maxRedeem(alice)), 30_000e6);
    }

    function test_pauseBlocksIssuanceButAllowsBoundedRedeem() public {
        _deposit(alice, 100_000e6);
        _seedAdapter(adapterA, 80_000e6, 80_000e6);

        vm.prank(admin);
        vault.setPaused(true);

        assertEq(vault.maxDeposit(bob), 0);
        assertEq(vault.maxMint(bob), 0);

        usdc.mint(bob, 1e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(NavyVault.EnforcedPause.selector);
        vault.deposit(1e6, bob);
        vm.stopPrank();

        uint256 shares = vault.maxRedeem(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);

        assertEq(vault.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), 100_000e6);
    }

    function test_rewardNavIsExcludedFromSynchronousLiquidity() public {
        _deposit(alice, 100_000e6);
        _seedAdapter(adapterA, 90_000e6, 0);

        vm.prank(admin);
        vault.setRewardAccountant(address(rewardAccountant));
        rewardAccountant.setRecognized(15_000e6);

        assertEq(vault.totalAssets(), 115_000e6);
        assertEq(vault.maxWithdraw(alice), 10_000e6);
    }

    function test_staleRewardAccountantClosesIssuanceButNotRedeem() public {
        _deposit(alice, 100_000e6);

        vm.prank(admin);
        vault.setRewardAccountant(address(rewardAccountant));
        rewardAccountant.setRevertRecognizedRead(true);
        rewardAccountant.setRevertSync(true);

        usdc.mint(bob, 1e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        assertEq(vault.maxDeposit(bob), 0);
        vm.expectRevert(bytes("mock sync revert"));
        vault.deposit(1e6, bob);
        vm.stopPrank();

        uint256 initialShares = vault.balanceOf(alice);
        uint256 shares = vault.previewWithdraw(10_000e6);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);

        assertEq(usdc.balanceOf(alice), 10_000e6);
        assertEq(vault.balanceOf(alice), initialShares - shares);
    }

    function test_setWithdrawalOrderControlsDeterministicAdapterSequence() public {
        _deposit(alice, 100_000e6);
        _seedAdapter(adapterA, 40_000e6, 40_000e6);
        _seedAdapter(adapterB, 40_000e6, 40_000e6);

        address[] memory order = new address[](2);
        order[0] = address(adapterB);
        order[1] = address(adapterA);
        vm.prank(admin);
        vault.setWithdrawalOrder(order);

        vm.prank(alice);
        vault.withdraw(60_000e6, alice, alice);

        assertEq(adapterB.withdrawCallCount(), 1);
        assertEq(adapterB.lastWithdrawRequest(), 40_000e6);
        assertEq(adapterA.withdrawCallCount(), 0);
    }

    function test_withdrawSkipsRevertingAdapterWhenLaterLiquiditySuffices() public {
        _deposit(alice, 100_000e6);
        _seedAdapter(adapterA, 40_000e6, 40_000e6);
        _seedAdapter(adapterB, 40_000e6, 40_000e6);
        adapterB.setRevertWithdrawals(true);

        address[] memory order = new address[](2);
        order[0] = address(adapterB);
        order[1] = address(adapterA);
        vm.prank(admin);
        vault.setWithdrawalOrder(order);

        vm.prank(alice);
        vault.withdraw(60_000e6, alice, alice);

        assertEq(adapterB.withdrawCallCount(), 0);
        assertEq(adapterA.withdrawCallCount(), 1);
        assertEq(usdc.balanceOf(alice), 60_000e6);
    }

    function test_previewWithdrawDoesNotGuaranteeLiquidity() public {
        _deposit(alice, 100_000e6);
        _seedAdapter(adapterA, 80_000e6, 10_000e6);

        uint256 shares = vault.previewWithdraw(50_000e6);
        assertGt(shares, 0);
        assertEq(vault.maxWithdraw(alice), 30_000e6);

        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(50_000e6, alice, alice);
    }

    function test_setWithdrawalOrderRejectsMissingOrDuplicateAdapters() public {
        address[] memory duplicate = new address[](2);
        duplicate[0] = address(adapterA);
        duplicate[1] = address(adapterA);

        vm.prank(admin);
        vm.expectRevert(NavyVault.InvalidWithdrawalOrder.selector);
        vault.setWithdrawalOrder(duplicate);

        address[] memory missing = new address[](1);
        missing[0] = address(adapterA);

        vm.prank(admin);
        vm.expectRevert(NavyVault.InvalidWithdrawalOrder.selector);
        vault.setWithdrawalOrder(missing);
    }

    function _deposit(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(amount, user);
        vm.stopPrank();
    }

    function _seedAdapter(MockStrategyAdapter adapter, uint256 reportedAssets, uint256 withdrawableAssets) internal {
        uint256 idle = usdc.balanceOf(address(vault));
        if (reportedAssets > idle) revert("insufficient idle for seed");

        vm.prank(address(vault));
        IERC20(address(usdc)).safeTransfer(address(adapter), reportedAssets);
        adapter.setReportedAssets(reportedAssets);
        adapter.setMaxWithdrawable(withdrawableAssets);
    }
}
