// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseForkTest} from "./BaseForkTest.t.sol";
import {CompoundV3Strategy} from "../../src/strategies/CompoundV3Strategy.sol";

/// @title CompoundV3BaseFork
/// @notice Fork tests for Compound V3 on Base mainnet
/// @dev Tests verify protocol contracts exist and basic operations work
contract CompoundV3BaseForkTest is BaseForkTest {
    // ============================================================
    // Protocol Addresses on Base
    // ============================================================

    /// @notice Compound V3 Comet on Base (USDC market)
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    /// @notice Test vault address (EOA)
    address public testVault;

    /// @notice Strategy instance
    CompoundV3Strategy public strategy;

    // ============================================================
    // Setup
    // ============================================================

    function setUp() public {
        _initFork();

        if (!forkCreated) return;

        testVault = makeAddr("testVault");
        strategy = new CompoundV3Strategy(testVault, BASE_USDC, COMET);
    }

    // ============================================================
    // Test 1: Comet exists and is accessible
    // ============================================================

    function test_forkCometExists() public skipWithoutFork {
        // Verify Comet contract exists (has code)
        uint256 codeSize = address(COMET).code.length;
        assertGt(codeSize, 0, "Compound Comet should have deployed code");

        // The deployed Base USDC Comet (v1) has no getCash() accessor — verify the market via
        // getUtilization(), which returns the current utilization as 1e18-scaled.
        (bool success, bytes memory data) = COMET.staticcall(abi.encodeWithSignature("getUtilization()"));

        assertTrue(success, "getUtilization() should succeed");
        uint256 utilization = abi.decode(data, (uint256));
        console.log("Comet utilization:", utilization);

        // Utilization must be within [0, 1e18] on a healthy market
        assertLe(utilization, 1e18, "Utilization should not exceed 100%");
    }

    // ============================================================
    // Test 2: Base token is USDC
    // ============================================================

    function test_forkCometBaseTokenIsUSDC() public skipWithoutFork {
        // Call baseToken() on the Comet
        (bool success, bytes memory data) = COMET.staticcall(abi.encodeWithSignature("baseToken()"));

        assertTrue(success, "baseToken() should succeed");
        address baseToken = abi.decode(data, (address));

        assertEq(baseToken, BASE_USDC, "Base token should be USDC on Base");

        // Also verify via strategy
        assertEq(strategy.asset(), BASE_USDC, "Strategy asset should be Base USDC");
    }

    // ============================================================
    // Test 3: Supply and withdraw on mainnet
    // ============================================================

    function test_forkCometSupplyAndWithdraw() public skipWithoutFork {
        // Use a small test amount (10 USDC)
        uint256 testAmount = 10 * 1e6;

        // Record initial state
        uint256 strategyAssetsBefore = strategy.totalAssets();

        // Fund strategy with USDC (simulating what vault would do)
        deal(BASE_USDC, address(strategy), testAmount);

        // Deposit to Compound
        vm.prank(testVault);
        uint256 credited = strategy.deposit(testAmount);

        // Verify deposit worked
        assertGt(credited, 0, "Should have credited some cTokens");
        assertGe(credited, testAmount - 2, "Should credit approximately the amount deposited"); // allow small rounding

        // Verify total assets increased
        uint256 strategyAssetsAfter = strategy.totalAssets();
        assertGt(strategyAssetsAfter, strategyAssetsBefore, "Strategy assets should increase");

        // Verify we have a positive balance in the Comet
        int256 cometBalance = _getCometBalance(address(strategy));
        assertGt(cometBalance, 0, "Should have positive balance in Comet");

        // Now withdraw
        uint256 withdrawAmount = credited / 2; // Withdraw half

        vm.prank(testVault);
        uint256 returned = strategy.withdraw(withdrawAmount);

        // Verify withdrawal worked
        assertGt(returned, 0, "Should have returned some USDC");

        // Verify strategy balance decreased
        uint256 strategyAssetsFinal = strategy.totalAssets();
        assertLt(strategyAssetsFinal, strategyAssetsAfter, "Strategy assets should decrease after withdraw");
    }

    // ============================================================
    // Test 4: maxWithdrawable is bounded by protocol cash
    // ============================================================

    function test_forkCometMaxWithdrawableBoundedByCash() public skipWithoutFork {
        // The deployed Base Comet has no getCash(); protocol cash is the Comet's USDC balance
        uint256 protocolCash = IERC20(BASE_USDC).balanceOf(COMET);

        // If we have funds deposited, verify maxWithdrawable respects cash
        uint256 maxWithdrawable = strategy.maxWithdrawable();

        // maxWithdrawable should not exceed protocol cash
        assertLe(maxWithdrawable, protocolCash + 1, "maxWithdrawable should be bounded by protocol cash");
    }

    // ============================================================
    // Test 5: Configuration digest is set
    // ============================================================

    function test_forkCometConfigurationDigestIsSet() public skipWithoutFork {
        bytes32 digest = strategy.configurationDigest();
        assertTrue(digest != bytes32(0), "Configuration digest should be set");
    }

    // ============================================================
    // Helper functions
    // ============================================================

    /// @dev Get the Comet balance for an account
    function _getCometBalance(address account) internal view returns (int256) {
        (bool success, bytes memory data) = COMET.staticcall(abi.encodeWithSignature("balanceOf(address)", account));

        if (success) {
            return abi.decode(data, (int256));
        }
        return 0;
    }
}
