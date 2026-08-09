// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BaseForkTest} from "./BaseForkTest.t.sol";
import {AaveV3Strategy} from "../../src/strategies/AaveV3Strategy.sol";

/// @title AaveV3BaseFork
/// @notice Fork tests for Aave V3 on Base mainnet
/// @dev Tests verify protocol contracts exist and basic operations work
contract AaveV3BaseForkTest is BaseForkTest {
    // ============================================================
    // Protocol Addresses on Base
    // ============================================================

    /// @notice Aave V3 Pool on Base
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    /// @notice aUSDC on Base
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;

    /// @notice Test vault address (EOA)
    address public testVault;

    /// @notice Strategy instance
    AaveV3Strategy public strategy;

    // ============================================================
    // Setup
    // ============================================================

    function setUp() public {
        _initFork();

        if (!forkCreated) return;

        testVault = makeAddr("testVault");
        strategy = new AaveV3Strategy(
            testVault,
            BASE_USDC,
            AAVE_POOL,
            A_USDC,
            address(0) // no incentives controller
        );
    }

    // ============================================================
    // Test 1: Aave Pool exists and is accessible
    // ============================================================

    function test_forkAavePoolExists() public skipWithoutFork {
        // Verify pool contract exists (has code)
        uint256 codeSize = address(AAVE_POOL).code.length;
        assertGt(codeSize, 0, "Aave Pool should have deployed code");

        // Try calling a view function to verify it's the Aave Pool
        // getReserveNormalizedIncome should return a positive value for USDC
        (bool success, bytes memory data) =
            AAVE_POOL.staticcall(abi.encodeWithSignature("getReserveNormalizedIncome(address)", BASE_USDC));

        assertTrue(success, "getReserveNormalizedIncome should succeed");
        uint256 income = abi.decode(data, (uint256));
        assertGt(income, 0, "USDC reserve should have positive normalized income");
    }

    // ============================================================
    // Test 2: aUSDC token exists
    // ============================================================

    function test_forkAaveATokenExists() public skipWithoutFork {
        // Verify aToken contract exists
        uint256 codeSize = address(A_USDC).code.length;
        assertGt(codeSize, 0, "aUSDC should have deployed code");

        // Verify it's an ERC20 token
        uint256 decimals = IERC20Metadata(A_USDC).decimals();
        assertEq(decimals, 6, "aUSDC should have 6 decimals");

        // Verify name contains "Aave" (Base deployment names it "Aave Base USDC")
        string memory name = IERC20Metadata(A_USDC).name();
        assertEq(name, "Aave Base USDC", "aUSDC name should be Aave Base USDC");
    }

    // ============================================================
    // Test 3: Underlying asset is USDC
    // ============================================================

    function test_forkAaveUnderlyingIsUSDC() public skipWithoutFork {
        // Verify strategy was initialized correctly
        assertEq(strategy.asset(), BASE_USDC, "Strategy asset should be Base USDC");

        // Verify USDC has 6 decimals
        uint256 usdcDecimals = IERC20Metadata(BASE_USDC).decimals();
        assertEq(usdcDecimals, 6, "USDC should have 6 decimals");
    }

    // ============================================================
    // Test 4: Basic deposit and withdraw on mainnet
    // ============================================================

    function test_forkAaveDepositAndWithdraw() public skipWithoutFork {
        // Use a small test amount (10 USDC)
        uint256 testAmount = 10 * 1e6;

        // Record initial state
        uint256 strategyAssetsBefore = strategy.totalAssets();
        uint256 aTokenBalanceBefore = IERC20(A_USDC).balanceOf(address(strategy));

        // Fund strategy with USDC (simulating what vault would do)
        deal(BASE_USDC, address(strategy), testAmount);

        // Deposit to Aave
        vm.prank(testVault);
        uint256 credited = strategy.deposit(testAmount);

        // Verify deposit worked
        assertGt(credited, 0, "Should have credited some aTokens");
        assertGe(credited, testAmount - 2, "Should credit approximately the amount deposited"); // allow small rounding

        // Verify aToken balance increased
        uint256 aTokenBalanceAfter = IERC20(A_USDC).balanceOf(address(strategy));
        assertGt(aTokenBalanceAfter, aTokenBalanceBefore, "aToken balance should increase");

        // Verify total assets increased
        uint256 strategyAssetsAfter = strategy.totalAssets();
        assertGt(strategyAssetsAfter, strategyAssetsBefore, "Strategy assets should increase");

        // Now withdraw
        uint256 withdrawAmount = credited / 2; // Withdraw half

        vm.prank(testVault);
        uint256 returned = strategy.withdraw(withdrawAmount);

        // Verify withdrawal worked
        assertGt(returned, 0, "Should have returned some USDC");

        // Verify aToken balance decreased
        uint256 aTokenBalanceFinal = IERC20(A_USDC).balanceOf(address(strategy));
        assertLt(aTokenBalanceFinal, aTokenBalanceAfter, "aToken balance should decrease after withdraw");
    }

    // ============================================================
    // Test 5: Supply rate is reasonable
    // ============================================================

    function test_forkAaveSupplyRateIsReasonable() public skipWithoutFork {
        // The strategy doesn't have a direct supplyRatePerYear, but we can
        // verify the pool's normalized income is positive and accrues forward
        (bool success1, bytes memory data1) =
            AAVE_POOL.staticcall(abi.encodeWithSignature("getReserveNormalizedIncome(address)", BASE_USDC));
        assertTrue(success1, "getReserveNormalizedIncome should succeed");

        uint256 income1 = abi.decode(data1, (uint256));
        assertGt(income1, 0, "USDC reserve normalized income should be positive");

        // Warp time forward; Aave's liquidity index accrues with the block timestamp
        vm.roll(block.number + 100);
        vm.warp(block.timestamp + 1 hours);

        (bool success2, bytes memory data2) =
            AAVE_POOL.staticcall(abi.encodeWithSignature("getReserveNormalizedIncome(address)", BASE_USDC));
        assertTrue(success2, "getReserveNormalizedIncome should succeed after warp");

        uint256 income2 = abi.decode(data2, (uint256));
        assertGt(income2, 0, "USDC reserve normalized income should be positive after warp");
        assertGe(income2, income1, "Normalized income should not decrease after warping forward");

        console.log("Income before:", income1);
        console.log("Income after:", income2);
    }

    // ============================================================
    // Test 6: Configuration digest is set
    // ============================================================

    function test_forkAaveConfigurationDigestIsSet() public skipWithoutFork {
        bytes32 digest = strategy.configurationDigest();
        assertTrue(digest != bytes32(0), "Configuration digest should be set");
    }
}

/// @notice Minimal interface for IERC20 metadata
interface IERC20Metadata {
    function decimals() external view returns (uint8);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}
