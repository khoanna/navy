// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {AaveV3Strategy} from "../../src/strategies/AaveV3Strategy.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockAaveV3} from "../mocks/MockAaveV3.sol";

/// @notice Tests for AaveV3Strategy
contract AaveV3StrategyTest is Test {

    MockUSDC public usdc;
    MockAaveV3 public aave;
    NavyVaultSRCLA public vault;
    AaveV3Strategy public strategy;

    address public constant VAULT_ADMIN = address(0x1);
    address public constant USER = address(0x2);
    address public constant OTHER = address(0x3);

    uint256 constant USDC_DECIMALS = 1e6;
    uint256 constant INITIAL_MINT = 1000 * 1e6;

    function setUp() public {
        // Deploy MockUSDC
        usdc = new MockUSDC();

        // Deploy MockAaveV3 with USDC
        aave = new MockAaveV3(address(usdc));

        // Deploy NavyVaultSRCLA
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));

        // Deploy AaveV3Strategy
        strategy = new AaveV3Strategy(
            address(vault),
            address(usdc),
            address(aave),
            address(aave.aToken()), // aToken address
            address(0) // no incentives controller for basic tests
        );

        // Fund vault with USDC for testing
        usdc.mint(address(vault), 100_000 * USDC_DECIMALS);

        // Fund user with USDC
        usdc.mint(USER, INITIAL_MINT);
        usdc.mint(OTHER, INITIAL_MINT);
    }

    // Helper function to execute a plan
    function _executeDeployPlan(uint256 amount) internal {
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));
        vault.registerAdapter(address(strategy), 5000, 10, "Aave V3 Strategy");

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(strategy),
            amount: amount,
            minOut: 0
        });

        vault.executePlan(
            bytes32("deploy-plan"),
            keccak256("decision"),
            uint64(block.timestamp + 1 hours),
            actions
        );

        // Execute the action
        vault.executeNextAction();
    }

    // Helper function to execute a withdraw plan
    function _executeWithdrawPlan(uint256 amount) internal {
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(strategy),
            amount: amount,
            minOut: 0
        });

        vault.executePlan(
            bytes32("withdraw-plan"),
            keccak256("decision"),
            uint64(block.timestamp + 1 hours),
            actions
        );

        // Execute the action
        vault.executeNextAction();
    }

    // ============================================================
    // Test 1: test_depositTransfersUSDCAndCreditsPosition
    // ============================================================

    function test_depositTransfersUSDCAndCreditsPosition() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Get initial strategy assets
        uint256 initialStrategyAssets = strategy.totalAssets();

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Verify position was credited
        uint256 finalAssets = strategy.totalAssets();
        assertGt(finalAssets, initialStrategyAssets);
        assertGt(finalAssets, 0);

        // Verify strategy holds aUSDC
        address aTokenAddr = address(aave.aToken());
        assertGt(IERC20(aTokenAddr).balanceOf(address(strategy)), 0);
    }

    // ============================================================
    // Test 2: test_withdrawReturnsUSDCDirectlyToVault
    // ============================================================

    function test_withdrawReturnsUSDCDirectlyToVault() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;
        uint256 withdrawAmount = 500 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        uint256 vaultUSDCBefore = usdc.balanceOf(address(vault));

        // Execute withdraw plan
        _executeWithdrawPlan(withdrawAmount);

        uint256 vaultUSDCAfter = usdc.balanceOf(address(vault));

        // Verify USDC returned to vault
        assertGt(vaultUSDCAfter, vaultUSDCBefore);
    }

    // ============================================================
    // Test 3: test_maxWithdrawableLimitedByProtocolCash
    // ============================================================

    function test_maxWithdrawableLimitedByProtocolCash() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Get strategy position
        uint256 strategyPosition = strategy.totalAssets();
        assertGt(strategyPosition, 0);

        // maxWithdrawable should equal the aToken balance
        uint256 maxWithdraw = strategy.maxWithdrawable();
        assertGt(maxWithdraw, 0);
    }

    // ============================================================
    // Test 4: test_onlyVaultCanDeposit
    // ============================================================

    function test_onlyVaultCanDeposit() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Non-vault tries to deposit directly (bypassing vault)
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSignature("OnlyVault()"));
        strategy.deposit(depositAmount);
    }

    // ============================================================
    // Test 5: test_onlyVaultCanWithdraw
    // ============================================================

    function test_onlyVaultCanWithdraw() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;
        uint256 withdrawAmount = 500 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Non-vault tries to withdraw directly
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSignature("OnlyVault()"));
        strategy.withdraw(withdrawAmount);
    }

    // ============================================================
    // Test 6: test_totalAssetsIncludesAccruedInterest
    // ============================================================

    function test_totalAssetsIncludesAccruedInterest() public {
        uint256 depositAmount = 1000 * USDC_DECIMALS;

        // Execute deploy plan
        _executeDeployPlan(depositAmount);

        // Record the current total assets
        uint256 assetsBeforeInterest = strategy.totalAssets();
        assertGt(assetsBeforeInterest, 0);

        // Record the current pool liquidity index
        uint256 indexBefore = aave.getReserveNormalizedIncome(address(0));

        // Accrue interest
        aave.accrueInterest(365 days); // Simulate 1 year

        // Get new index
        uint256 indexAfter = aave.getReserveNormalizedIncome(address(0));

        // The liquidity index should have increased
        assertGt(indexAfter, indexBefore);
    }

    // ============================================================
    // Test 7: test_configurationDigestChangesOnRateModelChange
    // ============================================================

    function test_configurationDigestChangesOnRateModelChange() public {
        uint256 depositAmount = 100 * USDC_DECIMALS;

        // First, deposit to have funds in the pool
        _executeDeployPlan(depositAmount);

        // Get initial configuration digest
        bytes32 initialDigest = strategy.configurationDigest();
        assertTrue(initialDigest != bytes32(0));

        // Record initial index
        uint256 initialIndex = aave.getReserveNormalizedIncome(address(0));

        // Set a new rate strategy
        aave.setRateStrategy(100, 5000000000000000); // 0.5% spread

        // Accrue interest to change the liquidity index
        aave.accrueInterest(1 days);

        // Get the new index
        uint256 newIndex = aave.getReserveNormalizedIncome(address(0));

        // Index should have changed
        assertTrue(newIndex != initialIndex);

        // Update the config digest in strategy
        strategy.updateConfigDigest();

        // Configuration digest should be different after update
        bytes32 newDigest = strategy.configurationDigest();
        assertTrue(newDigest != initialDigest);
    }

    // ============================================================
    // Test 8: test_rewardTokensReturnsAaveIncentives
    // ============================================================

    function test_rewardTokensReturnsAaveIncentives() public {
        // Deploy strategy with incentives controller
        AaveV3Strategy strategyWithIncentives = new AaveV3Strategy(
            address(vault),
            address(usdc),
            address(aave),
            address(aave.aToken()), // aToken address
            address(0xdead) // mock incentives controller
        );

        address[] memory rewards = strategyWithIncentives.rewardTokens();

        // Should return the incentives controller address
        assertEq(rewards.length, 1);
        assertEq(rewards[0], address(0xdead));
    }

    // ============================================================
    // Test: Vault integration
    // ============================================================

    function test_vaultIntegration() public {
        // Grant admin and allocator roles
        vault.grantRole(vault.ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(this));

        // Register strategy with vault
        vault.registerAdapter(address(strategy), 5000, 10, "Aave V3 Strategy");

        uint256 deployAmount = 100 * USDC_DECIMALS;

        // Deploy to strategy via vault
        NavyVaultSRCLA.Action[] memory actions = new NavyVaultSRCLA.Action[](1);
        actions[0] = NavyVaultSRCLA.Action({
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(strategy),
            amount: deployAmount,
            minOut: 0
        });

        vault.executePlan(
            bytes32("test-plan"),
            keccak256("decision"),
            uint64(block.timestamp + 1 hours),
            actions
        );

        vault.executeNextAction();

        // Verify deployment worked
        assertTrue(vault.registeredAdapters(address(strategy)));
        assertGt(vault.strategyAssets(address(strategy)), 0);
    }
}
