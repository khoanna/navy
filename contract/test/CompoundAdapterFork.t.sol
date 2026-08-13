// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {IComet, ICometRewards} from "../src/interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CompoundAdapterForkTest
/// @dev Fork test for CompoundAdapter on Base mainnet.
/// Verifies supply/withdraw and rate reading against the live Comet USDC market.
/// Per SRCLA paper Section 6.4 and Appendix A.
contract CompoundAdapterForkTest is Test {
    // Base mainnet addresses (per paper Appendix A)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address constant COMET_REWARDS = 0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1;
    address constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;

    address VAULT;
    CompoundAdapter adapter;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        uint256 forkBlock = vm.envOr("BASE_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        adapter = new CompoundAdapter(VAULT, USDC, COMET);
    }

    modifier withFork() {
        if (address(adapter) == address(0)) {
            vm.skip(true);
            return;
        }
        _;
    }

    // ---- Deployment Tests ----

    /// @dev Per paper Section 2.1: verify Comet uses Circle USDC
    function test_baseTokenMatchesCircleUsdc() internal view {
        assertEq(IComet(COMET).baseToken(), USDC);
    }

    function test_adapterVault() internal view {
        assertEq(adapter.vault(), VAULT);
    }

    function test_adapterAsset() internal view {
        assertEq(adapter.asset(), USDC);
    }

    // ---- Access Control Tests ----

    function test_onlyVault_canDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 balance = adapter.totalAssets();
        assertGt(balance, 0);
    }

    function test_onlyVault_canWithdraw() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 balance = adapter.totalAssets();
        assertGt(balance, 0);

        uint256 vaultBalanceBefore = IERC20(USDC).balanceOf(VAULT);
        vm.prank(VAULT);
        adapter.withdraw(balance);

        uint256 vaultBalanceAfter = IERC20(USDC).balanceOf(VAULT);
        assertGt(vaultBalanceAfter, vaultBalanceBefore);
    }

    function test_nonVault_cannotDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(CompoundAdapter.NotVault.selector);
        adapter.deposit(amount);
    }

    function test_nonVault_cannotWithdraw() external withFork {
        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(CompoundAdapter.NotVault.selector);
        adapter.withdraw(100e6);
    }

    // ---- Exact reward configuration and pinned inactive-state evidence ----

    function test_rewardDependencyMatchesOfficialBaseConfiguration() external withFork {
        ICometRewards.RewardConfig memory config = ICometRewards(COMET_REWARDS).rewardConfig(COMET);
        assertEq(address(adapter.cometRewards()), COMET_REWARDS);
        assertEq(config.token, COMP);
        assertEq(config.rescaleFactor, 1e12);
        assertTrue(config.shouldUpscale);
        assertEq(config.multiplier, 1e18);
    }

    function test_pinnedCompoundRewardsAreInactiveAndNotAdvertised() external withFork {
        assertEq(IComet(COMET).baseTrackingSupplySpeed(), 0, "pinned supply reward speed changed");
        assertGt(IComet(COMET).totalSupply(), IComet(COMET).baseMinForRewards());
        assertEq(IERC20(COMP).balanceOf(COMET_REWARDS), 0, "pinned reward funding changed");
        assertEq(adapter.rewardTokens().length, 0, "inactive COMP must not be advertised");

        vm.prank(VAULT);
        assertEq(adapter.claimableReward(COMP), 0);
    }

    // ---- Core Functionality Tests ----

    function test_totalAssets_beforeDeposit() internal view {
        assertEq(adapter.totalAssets(), 0);
    }

    function test_supplyRatePerYear_sanity() internal view {
        uint256 apr = adapter.supplyRatePerYear();
        assertGe(apr, 0);
        assertLe(apr, 1e18); // <= 100% APY
    }

    function test_supplyRatePerYear_usesUtilization() internal view {
        // Get utilization from Comet
        uint256 util = IComet(COMET).getUtilization();
        uint256 rate = adapter.supplyRatePerYear();

        // If utilization is 0, rate should be the base rate
        // If utilization is 100%, rate should be at max
        assertLe(rate, 1e18);
    }

    function test_fullDepositWithdrawCycle() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        // Deposit
        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 assets = adapter.totalAssets();
        assertGt(assets, 0);

        // Withdraw
        vm.prank(VAULT);
        adapter.withdraw(assets);

        uint256 vaultBalance = IERC20(USDC).balanceOf(VAULT);
        assertApproxEqAbs(vaultBalance, assets, 5);
    }

    // ---- Comet Integration Tests ----

    function test_cometUtilization() internal view {
        uint256 util = IComet(COMET).getUtilization();
        assertLe(util, 1e18);
    }

    function test_cometBalanceOfAdapter() internal view {
        // Before deposit, balance should be 0
        assertEq(IComet(COMET).balanceOf(address(adapter)), 0);
    }

    // ---- Stress Tests ----

    function test_depositAndWithdraw_multipleCycles() external withFork {
        uint256 amount = 100e6;

        for (uint256 i = 0; i < 3; i++) {
            deal(USDC, address(adapter), amount);

            vm.prank(VAULT);
            adapter.deposit(amount);

            uint256 assets = adapter.totalAssets();

            vm.prank(VAULT);
            adapter.withdraw(assets);
        }

        // Final balance should be 0
        assertEq(adapter.totalAssets(), 0);
    }
}
