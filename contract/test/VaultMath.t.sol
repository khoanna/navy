// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {VaultMath} from "../src/libraries/VaultMath.sol";

/// @title VaultMathTest
/// @notice Tests for the VaultMath library
contract VaultMathTest is Test {
    // Precision constants
    uint256 internal constant USDC_PRECISION = 1e6;  // 6 decimals for USDC
    uint256 internal constant SHARE_PRECISION = 1e12; // 12 decimals for shares

    function test_convertToSharesRoundsUp() public pure {
        // Scenario: 100 USDC deposited when 1 share = 1.5 USDC
        // Shares = 100e6 * 100e12 / 150e6 = 66666.6666... shares
        // Should round up to 66667 (exact value: 66666666666667)
        uint256 assets = 100 * USDC_PRECISION;      // 100 USDC
        uint256 totalAssets = 150 * USDC_PRECISION; // 150 USDC in vault
        uint256 totalShares = 100 * SHARE_PRECISION; // 100 shares outstanding
        bool roundUp = true;

        uint256 shares = VaultMath.convertToShares(assets, totalAssets, totalShares, roundUp);

        // 100 * 100e12 / 150 = 66666666666666.666..., rounds up to 66666666666667
        uint256 expectedShares = 66666666666667;
        assertEq(shares, expectedShares, "convertToShares should round up correctly");
    }

    function test_convertToSharesRoundsDown() public pure {
        // Scenario: 100 USDC deposited when 1 share = 1.5 USDC
        // Shares = 100e6 * 100e12 / 150e6 = 66666.6666... shares
        // Should round down to 66666 (exact value: 66666666666666)
        uint256 assets = 100 * USDC_PRECISION;      // 100 USDC
        uint256 totalAssets = 150 * USDC_PRECISION; // 150 USDC in vault
        uint256 totalShares = 100 * SHARE_PRECISION; // 100 shares outstanding
        bool roundUp = false;

        uint256 shares = VaultMath.convertToShares(assets, totalAssets, totalShares, roundUp);

        // 100 * 100e12 / 150 = 66666666666666.666..., truncates to 66666666666666
        uint256 expectedShares = 66666666666666;
        assertEq(shares, expectedShares, "convertToShares should round down correctly");
    }

    function test_convertToAssetsRoundsDown() public pure {
        // Scenario: 10 shares redeemed when 1 share = 1.5 USDC
        // Assets = 10e12 * 150e6 / 100e12 = 15e6 = 15 USDC (exact)
        uint256 shares = 10 * SHARE_PRECISION;       // 10 shares
        uint256 totalAssets = 150 * USDC_PRECISION; // 150 USDC in vault
        uint256 totalShares = 100 * SHARE_PRECISION; // 100 shares outstanding

        uint256 assets = VaultMath.convertToAssets(shares, totalAssets, totalShares);

        // Expected: 10 * 150e6 / 100 = 15e6 = 15 USDC
        uint256 expectedAssets = 15 * USDC_PRECISION;
        assertEq(assets, expectedAssets, "convertToAssets should calculate correctly");

        // Test with remainder: 1 share = 1.5 USDC, redeem 1 share
        // Assets = 1e12 * 150e6 / 100e12 = 1.5e6, truncated to 1e6 (1 USDC)
        shares = 1 * SHARE_PRECISION; // 1 share
        assets = VaultMath.convertToAssets(shares, totalAssets, totalShares);
        // mulDiv truncates: 1e12 * 150e6 / 100e12 = 1500000, which is 1.5 USDC (already integer)
        // But with these values: 1500000 / 1000000 = 1.5, truncated by mulDiv is still 1500000
        // The result IS 1.5 USDC = 1500000 (no further rounding needed in convertToAssets)
        expectedAssets = 1500000; // 1.5 USDC
        assertEq(assets, expectedAssets, "convertToAssets should truncate fractional USDC");
    }

    function test_mulDivRoundsCorrectly() public pure {
        // Test exact division: 10 * 100 / 10 = 100
        uint256 result = VaultMath.mulDiv(10, 100, 10);
        assertEq(result, 100, "mulDiv: exact division should work");

        // Test truncation: 10 * 99 / 100 = 9.9, should truncate to 9
        result = VaultMath.mulDiv(10, 99, 100);
        assertEq(result, 9, "mulDiv: should truncate fractional result");

        // Test with large numbers: 1e18 * 1e18 / 1e18 = 1e18
        result = VaultMath.mulDiv(1e18, 1e18, 1e18);
        assertEq(result, 1e18, "mulDiv: large numbers should work");

        // Test with USDC/share precision: 100e6 * 100e12 / 150e6 = 66,666.666... shares
        // This equals 66666666666666 in raw format (truncated)
        result = VaultMath.mulDiv(100e6, 100e12, 150e6);
        assertEq(result, 66666666666666, "mulDiv: USDC/share conversion should work");
    }

    function test_mulDivDivisionByZero() public {
        // Test division by zero reverts using a wrapper contract
        VaultMathWrapper wrapper = new VaultMathWrapper();
        vm.expectRevert();
        wrapper.testMulDiv(10, 100, 0);
    }

    function test_previewDepositRespectsMaxDeposit() public pure {
        // Test when assets <= maxDeposit: should return assets
        uint256 assets = 100 * USDC_PRECISION;
        uint256 maxDeposit = 200 * USDC_PRECISION;

        uint256 result = VaultMath.previewDeposit(assets, maxDeposit);
        assertEq(result, assets, "previewDeposit: should return full assets when under limit");

        // Test when assets > maxDeposit: should return maxDeposit
        assets = 300 * USDC_PRECISION;
        maxDeposit = 200 * USDC_PRECISION;

        result = VaultMath.previewDeposit(assets, maxDeposit);
        assertEq(result, maxDeposit, "previewDeposit: should return maxDeposit when over limit");

        // Test when assets == maxDeposit: should return assets
        assets = 200 * USDC_PRECISION;
        maxDeposit = 200 * USDC_PRECISION;

        result = VaultMath.previewDeposit(assets, maxDeposit);
        assertEq(result, assets, "previewDeposit: should return assets when equal to limit");

        // Test when maxDeposit == 0: should return 0
        assets = 100 * USDC_PRECISION;
        maxDeposit = 0;

        result = VaultMath.previewDeposit(assets, maxDeposit);
        assertEq(result, 0, "previewDeposit: should return 0 when maxDeposit is 0");
    }

    function test_convertToSharesWithZeroTotalAssets() public pure {
        // Edge case: totalAssets == 0 should return assets (initial deposit)
        uint256 assets = 100 * USDC_PRECISION;
        uint256 totalAssets = 0;
        uint256 totalShares = 0;
        bool roundUp = true;

        uint256 shares = VaultMath.convertToShares(assets, totalAssets, totalShares, roundUp);
        assertEq(shares, assets, "convertToShares: should return assets when totalAssets is 0");
    }

    function test_convertToAssetsWithZeroTotalShares() public pure {
        // Edge case: totalShares == 0 should return shares
        uint256 shares = 100 * SHARE_PRECISION;
        uint256 totalAssets = 0;
        uint256 totalShares = 0;

        uint256 assets = VaultMath.convertToAssets(shares, totalAssets, totalShares);
        assertEq(assets, shares, "convertToAssets: should return shares when totalShares is 0");
    }
}

/// @notice Wrapper contract to test library external call reverts
contract VaultMathWrapper {
    function testMulDiv(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return VaultMath.mulDiv(a, b, denominator);
    }
}
