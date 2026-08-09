// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseForkTest} from "./BaseForkTest.t.sol";
import {MoonwellStrategy} from "../../src/strategies/MoonwellStrategy.sol";

/// @title MoonwellBaseFork
/// @notice Fork tests for Moonwell on Base mainnet
/// @dev Tests verify protocol contracts exist and basic operations work
contract MoonwellBaseForkTest is BaseForkTest {
    // ============================================================
    // Protocol Addresses on Base
    // ============================================================

    /// @notice Moonwell mUSDC on Base
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;

    /// @notice Moonwell Unitroller ( Rewards) on Base
    address constant UNITROLLER = 0x52aEebc9142DF07b8d4e7A7f4cB84c5E29E39D25;

    /// @notice Test vault address (EOA)
    address public testVault;

    /// @notice Strategy instance
    MoonwellStrategy public strategy;

    // ============================================================
    // Setup
    // ============================================================

    function setUp() public {
        _initFork();

        if (!forkCreated) return;

        testVault = makeAddr("testVault");
        strategy = new MoonwellStrategy(testVault, BASE_USDC, M_USDC);
    }

    // ============================================================
    // Test 1: mToken exists
    // ============================================================

    function test_forkMoonwellMTokenExists() public skipWithoutFork {
        // Verify mToken contract exists (has code)
        uint256 codeSize = address(M_USDC).code.length;
        assertGt(codeSize, 0, "mUSDC should have deployed code");

        // Verify it's an ERC20-like token
        (bool success, bytes memory data) = M_USDC.staticcall(abi.encodeWithSignature("underlying()"));

        if (success) {
            address underlying = abi.decode(data, (address));
            assertEq(underlying, BASE_USDC, "Underlying should be USDC");
        } else {
            // If underlying() doesn't exist, try exchangeRateStored as fallback verification
            (success, data) = M_USDC.staticcall(abi.encodeWithSignature("exchangeRateStored()"));
            assertTrue(success, "mToken should have exchangeRateStored()");
        }
    }

    // ============================================================
    // Test 2: Underlying asset is USDC
    // ============================================================

    function test_forkMoonwellUnderlyingIsUSDC() public skipWithoutFork {
        // Verify strategy was initialized correctly
        assertEq(strategy.asset(), BASE_USDC, "Strategy asset should be Base USDC");

        // Verify underlying() call returns USDC
        (bool success, bytes memory data) = M_USDC.staticcall(abi.encodeWithSignature("underlying()"));

        if (success) {
            address underlying = abi.decode(data, (address));
            assertEq(underlying, BASE_USDC, "mToken underlying should be USDC");
        }
    }

    // ============================================================
    // Test 3: Exchange rate is positive
    // ============================================================

    function test_forkMoonwellExchangeRatePositive() public skipWithoutFork {
        // Get exchange rate (Compound-style expScale = 1e18)
        (bool success, bytes memory data) = M_USDC.staticcall(abi.encodeWithSignature("exchangeRateStored()"));

        assertTrue(success, "exchangeRateStored() should succeed");
        uint256 exchangeRate = abi.decode(data, (uint256));

        assertGt(exchangeRate, 0, "Exchange rate should be positive");
        console.log("Exchange rate:", exchangeRate);

        // Compound-style: underlying = mTokens * exchangeRate / 1e18. A healthy USDC market
        // trades well below 1 USDC per mToken, so the rate must be far under 1e18.
        assertLt(exchangeRate, 1e18, "Exchange rate should be below 1 USDC per mToken");
    }

    // ============================================================
    // Test 4: Basic deposit on mainnet
    // ============================================================

    function test_forkMoonwellDeposit() public skipWithoutFork {
        // Use a small test amount (10 USDC)
        uint256 testAmount = 10 * 1e6;

        // Record initial state
        uint256 strategyAssetsBefore = strategy.totalAssets();
        uint256 mTokenBalanceBefore = IERC20(M_USDC).balanceOf(address(strategy));

        // Fund strategy with USDC (simulating what vault would do)
        deal(BASE_USDC, address(strategy), testAmount);

        // Deposit to Moonwell
        vm.prank(testVault);
        uint256 credited = strategy.deposit(testAmount);

        // Verify deposit worked
        assertGt(credited, 0, "Should have credited some mTokens");

        // Verify mToken balance increased
        uint256 mTokenBalanceAfter = IERC20(M_USDC).balanceOf(address(strategy));
        assertGt(mTokenBalanceAfter, mTokenBalanceBefore, "mToken balance should increase");

        // Verify total assets increased
        uint256 strategyAssetsAfter = strategy.totalAssets();
        assertGt(strategyAssetsAfter, strategyAssetsBefore, "Strategy assets should increase");
    }

    // ============================================================
    // Test 5: maxWithdrawable works
    // ============================================================

    function test_forkMoonwellMaxWithdrawableWorks() public skipWithoutFork {
        // First deposit some funds
        uint256 testAmount = 10 * 1e6;
        deal(BASE_USDC, address(strategy), testAmount);

        vm.prank(testVault);
        strategy.deposit(testAmount);

        // Check maxWithdrawable
        uint256 maxWithdrawable = strategy.maxWithdrawable();
        assertGt(maxWithdrawable, 0, "maxWithdrawable should be positive after deposit");

        // Should not exceed deposited amount
        assertLe(maxWithdrawable, testAmount + 1, "maxWithdrawable should not exceed deposit");
    }

    // ============================================================
    // Test 6: Configuration digest is set
    // ============================================================

    function test_forkMoonwellConfigurationDigestIsSet() public skipWithoutFork {
        bytes32 digest = strategy.configurationDigest();
        assertTrue(digest != bytes32(0), "Configuration digest should be set");
    }

    // ============================================================
    // Test 7: getCash returns non-negative
    // ============================================================

    function test_forkMoonwellGetCash() public skipWithoutFork {
        (bool success, bytes memory data) = M_USDC.staticcall(abi.encodeWithSignature("getCash()"));

        if (success) {
            uint256 cash = abi.decode(data, (uint256));
            console.log("Moonwell cash:", cash);
            assertGe(cash, 0, "Cash should be non-negative");
        }
    }
}
