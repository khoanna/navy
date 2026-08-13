// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {IAaveV3Pool, IAaveV3AToken, IAaveV3RewardsController} from "../src/interfaces/IAaveV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title AaveV3AdapterForkTest
/// @dev Fork test for AaveV3Adapter on Base mainnet.
/// Verifies supply/withdraw, rate reading, and onlyVault access control.
/// Per SRCLA paper Section 6.3.
contract AaveV3AdapterForkTest is Test {
    // Base mainnet addresses (per paper Appendix A)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant INCENTIVES_CONTROLLER = 0xf9cc4F0D883F1a1eb2c253bdb46c254Ca51E1F44;
    address constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;
    uint256 constant PINNED_BLOCK = 49_926_094;

    address VAULT;
    AaveV3Adapter adapter;
    bool forkCreated;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkCreated = false;
            return;
        }
        forkCreated = true;
        uint256 forkBlock = vm.envOr("BASE_FORK_BLOCK", PINNED_BLOCK);
        vm.createSelectFork(rpc, forkBlock);
        adapter = new AaveV3Adapter(VAULT, USDC, AAVE_POOL, A_USDC);
    }

    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }

    // ---- Deployment Tests ----

    function test_deployment_addresses() external withFork {
        assertEq(adapter.vault(), VAULT, "vault mismatch");
        assertEq(adapter.asset(), USDC, "asset mismatch");
        assertEq(adapter.aToken(), A_USDC, "aToken mismatch");
        assertEq(adapter.aavePool(), AAVE_POOL, "pool mismatch");
    }

    function test_deployment_verifyUsdcIsCircle() external withFork {
        // Verify Aave uses Circle's canonical USDC (per paper Section 2.1)
        assertEq(IAaveV3AToken(A_USDC).UNDERLYING_ASSET_ADDRESS(), USDC, "must use Circle USDC");
    }

    function test_pinned_controllerIdentityIsDerivedFromAUsdc() external withFork {
        assertEq(IAaveV3AToken(A_USDC).getIncentivesController(), INCENTIVES_CONTROLLER);
        assertEq(address(adapter.incentivesController()), INCENTIVES_CONTROLLER);
    }

    function test_pinned_rewardEnumerationContainsEndedAUsdcAndNeverFalseComp() external withFork {
        address[] memory configured = IAaveV3RewardsController(INCENTIVES_CONTROLLER).getRewardsByAsset(A_USDC);
        assertEq(configured.length, 1);
        assertEq(configured[0], A_USDC);
        assertTrue(configured[0] != COMP);

        (, uint256 emissionPerSecond,, uint256 distributionEnd) =
            IAaveV3RewardsController(INCENTIVES_CONTROLLER).getRewardsData(A_USDC, A_USDC);
        assertEq(emissionPerSecond, 23_148);
        assertEq(distributionEnd, 1_725_375_600);
        assertGt(block.timestamp, distributionEnd);

        address[] memory active = adapter.rewardTokens();
        assertEq(active.length, 0, "ended aUSDC must not be advertised");
        assertEq(adapter.claimableReward(A_USDC), 0, "ended aUSDC must contribute zero");

        vm.expectRevert(AaveV3Adapter.UnsupportedRewardToken.selector);
        adapter.claimableReward(COMP);
    }

    // ---- Access Control Tests ----

    function test_onlyVault_canDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 aUsdcBalance = IAaveV3AToken(A_USDC).balanceOf(address(adapter));
        assertGt(aUsdcBalance, 0, "should have aUSDC");
    }

    function test_onlyVault_canWithdraw() external withFork {
        uint256 depositAmount = 100e6;
        deal(USDC, address(adapter), depositAmount);

        vm.prank(VAULT);
        adapter.deposit(depositAmount);

        uint256 aUsdcBalance = IAaveV3AToken(A_USDC).balanceOf(address(adapter));

        uint256 vaultBalanceBefore = IERC20(USDC).balanceOf(VAULT);
        vm.prank(VAULT);
        adapter.withdraw(aUsdcBalance);

        uint256 vaultBalanceAfter = IERC20(USDC).balanceOf(VAULT);
        assertGt(vaultBalanceAfter, vaultBalanceBefore, "should receive USDC");
    }

    function test_nonVault_cannotDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(AaveV3Adapter.NotVault.selector);
        adapter.deposit(amount);
    }

    function test_nonVault_cannotWithdraw() external withFork {
        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(AaveV3Adapter.NotVault.selector);
        adapter.withdraw(100e6);
    }

    // ---- Core Functionality Tests ----

    function test_totalAssets_beforeDeposit() external withFork {
        assertEq(adapter.totalAssets(), 0, "should be 0 before deposit");
    }

    function test_supplyRatePerYear_sanity() external withFork {
        uint256 apr = adapter.supplyRatePerYear();
        assertGe(apr, 0, "rate should be >= 0");
        assertLe(apr, 1e18, "rate should be <= 100%");
    }

    function test_fullDepositWithdrawCycle() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        // Deposit
        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 assets = adapter.totalAssets();
        assertGt(assets, 0, "should have aUSDC");

        // Withdraw
        vm.prank(VAULT);
        adapter.withdraw(assets);

        uint256 vaultBalance = IERC20(USDC).balanceOf(VAULT);
        assertApproxEqAbs(vaultBalance, assets, 5, "should return USDC");
    }

    // ---- Reserve Data Verification ----

    function test_aaveReserveData_matchesUsdc() external withFork {
        IAaveV3Pool.ReserveData memory data = IAaveV3Pool(AAVE_POOL).getReserveData(USDC);

        assertEq(data.aTokenAddress, A_USDC, "aToken mismatch");
        assertGt(data.liquidityIndex, 0, "liquidity index should be positive");
    }

    // ---- Multiple Cycles ----

    function test_depositWithdraw_multipleCycles() external withFork {
        uint256 amount = 50e6;

        for (uint256 i = 0; i < 3; i++) {
            deal(USDC, address(adapter), amount);
            vm.prank(VAULT);
            adapter.deposit(amount);
            uint256 assets = adapter.totalAssets();
            vm.prank(VAULT);
            adapter.withdraw(assets);
        }

        assertEq(adapter.totalAssets(), 0, "should be 0 after cycles");
    }
}
