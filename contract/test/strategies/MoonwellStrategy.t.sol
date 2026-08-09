// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {MoonwellStrategy} from "../../src/strategies/MoonwellStrategy.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockMoonwell} from "../mocks/MockMoonwell.sol";

/// @notice Tests for MoonwellStrategy
contract MoonwellStrategyTest is Test {
    MockUSDC public usdc;
    MockMoonwell public mToken;
    NavyVaultSRCLA public vault;
    MoonwellStrategy public strategy;

    address public constant VAULT_ADMIN = address(0x1);
    address public constant USER = address(0x2);
    address public constant OTHER = address(0x3);

    uint256 constant USDC_DECIMALS = 1e6;
    uint256 constant INITIAL_MINT = 1000 * 1e6;

    function setUp() public {
        // Deploy MockUSDC
        usdc = new MockUSDC();

        // Deploy MockMoonwell with USDC
        mToken = new MockMoonwell(address(usdc));

        // Set a reasonable interest rate for testing
        mToken.setBaseInterestRate(5000000000000000); // ~5% annual rate

        // Deploy NavyVaultSRCLA
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));

        // Deploy MoonwellStrategy
        strategy = new MoonwellStrategy(address(vault), address(usdc), address(mToken));

        // Fund vault with USDC for testing
        usdc.mint(address(vault), 100_000 * USDC_DECIMALS);

        // Fund user with USDC
        usdc.mint(USER, INITIAL_MINT);
        usdc.mint(OTHER, INITIAL_MINT);
    }

    // Helper function to execute a deploy plan
    function _executeDeployPlan(uint256 amount) internal {
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));
        vault.registerAdapter(address(strategy), 5000, 10, "Moonwell Strategy");

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Deploy, adapter: address(strategy), amount: amount, minOut: 0
        });

        vault.executePlan(bytes32("deploy-plan"), keccak256("decision"), uint64(block.timestamp + 1 hours), actions);

        // Execute the action
        vault.executeNextAction();
    }

    // Helper function to execute a withdraw plan
    function _executeWithdrawPlan(uint256 amount) internal {
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Divest, adapter: address(strategy), amount: amount, minOut: 0
        });

        vault.executePlan(bytes32("withdraw-plan"), keccak256("decision"), uint64(block.timestamp + 1 hours), actions);

        // Execute the action
        vault.executeNextAction();
    }

    // ============================================================
    // Test 1: test_depositMintsMToken
    // ============================================================

    function test_depositMintsMToken() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Get initial mToken balance
        uint256 initialMTokens = mToken.balanceOf(address(strategy));
        assertEq(initialMTokens, 0);

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Verify mToken balance increased
        uint256 finalMTokens = mToken.balanceOf(address(strategy));
        assertGt(finalMTokens, initialMTokens);
        assertGt(finalMTokens, 0);

        // Verify strategy received mTokens
        uint256 strategyBalance = IERC20(address(mToken)).balanceOf(address(strategy));
        assertGt(strategyBalance, 0);
    }

    // ============================================================
    // Test 2: test_withdrawRedeemsUnderlying
    // ============================================================

    function test_withdrawRedeemsUnderlying() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;
        uint256 withdrawAmount = 500 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Get mToken balance after deposit
        uint256 mTokensAfterDeposit = mToken.balanceOf(address(strategy));
        assertGt(mTokensAfterDeposit, 0);

        // Get vault USDC balance before withdraw
        uint256 vaultUSDCBefore = usdc.balanceOf(address(vault));

        // Execute withdraw plan
        _executeWithdrawPlan(withdrawAmount);

        // Verify vault received USDC
        uint256 vaultUSDCAfter = usdc.balanceOf(address(vault));
        assertGt(vaultUSDCAfter, vaultUSDCBefore);

        // Verify mToken balance decreased
        uint256 mTokensAfterWithdraw = mToken.balanceOf(address(strategy));
        assertLt(mTokensAfterWithdraw, mTokensAfterDeposit);
    }

    // ============================================================
    // Test 3: test_nonzeroErrorCodeReverts
    // ============================================================

    function test_nonzeroErrorCodeReverts() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Set a non-zero error code for mint
        mToken.setMintCode(1);

        // Prepare a new deposit that should fail
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        // Try another deposit - should fail due to error code
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Deploy, adapter: address(strategy), amount: 100 * USDC_DECIMALS, minOut: 0
        });

        vault.executePlan(bytes32("error-plan"), keccak256("decision"), uint64(block.timestamp + 1 hours), actions);

        vm.expectRevert(abi.encodeWithSignature("MintFailed(uint256)", 1));
        vault.executeNextAction();

        // Reset mint code for other tests
        mToken.setMintCode(0);
    }

    // ============================================================
    // Test 4: test_totalAssetsUsesExchangeRate
    // ============================================================

    function test_totalAssetsUsesExchangeRate() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Get initial mToken balance
        uint256 mTokenBalance = mToken.balanceOf(address(strategy));
        assertGt(mTokenBalance, 0);

        // Get initial exchange rate
        uint256 initialExchangeRate = mToken.exchangeRateStored();

        // Get initial total assets
        uint256 initialAssets = strategy.totalAssets();
        assertGt(initialAssets, 0);
        assertEq(initialAssets, depositAmount); // Should be 1:1 initially

        // Accrue interest (increase exchange rate)
        mToken.accrueInterest(365 days); // Simulate 1 year

        // Total assets should now include interest
        uint256 assetsAfterInterest = strategy.totalAssets();
        assertGt(assetsAfterInterest, initialAssets);

        // Verify exchange rate increased
        uint256 finalExchangeRate = mToken.exchangeRateStored();
        assertGt(finalExchangeRate, initialExchangeRate);

        // mToken balance should remain the same
        uint256 mTokenBalanceAfter = mToken.balanceOf(address(strategy));
        assertEq(mTokenBalance, mTokenBalanceAfter);
    }

    // ============================================================
    // Test 5: test_maxWithdrawableUsesGetCash
    // ============================================================

    function test_maxWithdrawableUsesGetCash() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Get strategy position
        uint256 strategyPosition = strategy.totalAssets();
        assertGt(strategyPosition, 0);

        // Get max withdrawable
        uint256 maxWithdraw = strategy.maxWithdrawable();
        assertGt(maxWithdraw, 0);

        // maxWithdrawable should be limited by protocol cash
        uint256 protocolCash = mToken.getCash();
        assertLe(maxWithdraw, protocolCash);

        // Should not exceed actual position
        assertLe(maxWithdraw, strategyPosition);

        // Set cash to a lower value to test limit
        uint256 limitedCash = 100 * USDC_DECIMALS;
        mToken.setCash(limitedCash);

        // maxWithdrawable should now be limited by cash
        uint256 limitedMaxWithdraw = strategy.maxWithdrawable();
        assertLe(limitedMaxWithdraw, limitedCash);
    }

    // ============================================================
    // Additional Tests
    // ============================================================

    function test_onlyVaultCanDeposit() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Non-vault tries to deposit directly
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSignature("OnlyVault()"));
        strategy.deposit(depositAmount);
    }

    function test_onlyVaultCanWithdraw() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;
        uint256 withdrawAmount = 500 * USDC_DECIMALS;

        // Execute deploy plan first
        _executeDeployPlan(depositAmount);

        // Non-vault tries to withdraw directly
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSignature("OnlyVault()"));
        strategy.withdraw(withdrawAmount);
    }

    function test_zeroAmountDepositReturnsZero() public {
        // Direct deposit of 0 should return 0 (needs vault caller)
        vm.prank(address(vault));
        uint256 result = strategy.deposit(0);
        assertEq(result, 0);
    }

    function test_zeroAmountWithdrawReturnsZero() public {
        // Direct withdraw of 0 should return 0 (needs vault caller)
        vm.prank(address(vault));
        uint256 result = strategy.withdraw(0);
        assertEq(result, 0);
    }

    function test_configurationDigestIsSet() public view {
        bytes32 digest = strategy.configurationDigest();
        assertTrue(digest != bytes32(0));
    }

    function test_vaultIntegration() public {
        // Grant admin and allocator roles
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        // Register strategy with vault
        vault.registerAdapter(address(strategy), 5000, 10, "Moonwell Strategy");

        uint256 deployAmount = 100 * USDC_DECIMALS;

        // Deploy to strategy via vault
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Deploy, adapter: address(strategy), amount: deployAmount, minOut: 0
        });

        vault.executePlan(bytes32("test-plan"), keccak256("decision"), uint64(block.timestamp + 1 hours), actions);

        vault.executeNextAction();

        // Verify deployment worked
        assertTrue(vault.registeredAdapters(address(strategy)));
        assertGt(vault.strategyAssets(address(strategy)), 0);
    }

    function test_zeroMTokenBalanceReturnsZeroAssets() public {
        // No deposit, total assets should be 0
        uint256 assets = strategy.totalAssets();
        assertEq(assets, 0);

        // maxWithdrawable should also be 0
        uint256 maxWithdraw = strategy.maxWithdrawable();
        assertEq(maxWithdraw, 0);
    }

    function test_redeemPausedReverts() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Pause redeem
        mToken.setRedeemPaused(true);

        // Try to withdraw - should revert
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Divest, adapter: address(strategy), amount: 100 * USDC_DECIMALS, minOut: 0
        });

        vault.executePlan(
            bytes32("paused-withdraw-plan"), keccak256("decision"), uint64(block.timestamp + 1 hours), actions
        );

        // The execution should revert due to paused redeem
        vm.expectRevert();
        vault.executeNextAction();
    }

    function test_redeemErrorCodeReverts() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Set redeem error code
        mToken.setRedeemCode(2);

        // Try to withdraw - should revert
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Divest, adapter: address(strategy), amount: 100 * USDC_DECIMALS, minOut: 0
        });

        vault.executePlan(
            bytes32("error-redeem-plan"), keccak256("decision"), uint64(block.timestamp + 1 hours), actions
        );

        vm.expectRevert(abi.encodeWithSignature("RedeemFailed(uint256)", 2));
        vault.executeNextAction();

        // Reset redeem code
        mToken.setRedeemCode(0);
    }
}
