// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {IAaveV3Pool, IAaveV3AToken} from "../src/interfaces/IAaveV3.sol";
import {IComet} from "../src/interfaces/IComet.sol";
import {IMToken} from "../src/interfaces/IMToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title AllProtocolsForkTest
/// @dev Verifies all three SRCLA protocol adapters work on Base mainnet.
/// Per paper Appendix A: Aave V3, Compound III, and Moonwell all use Circle USDC.
contract AllProtocolsForkTest is Test {
    // Base mainnet addresses (per paper Appendix A)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Aave V3 (Section 6.3)
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;

    // Compound III (Section 6.4)
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    // Moonwell (Section 6.5)
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant COMPTROLLER = 0x73D8A3bF62aACa6690791E57EBaEE4e1d875d8Fe;
    address constant INTEREST_MODEL = 0x54dC357F7461BcEEE5BdbA80996f5CB7d7512445;

    AaveV3Adapter aaveAdapter;
    CompoundAdapter compoundAdapter;
    MoonwellAdapter moonwellAdapter;
    address VAULT;
    bool forkCreated;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkCreated = false;
            return;
        }
        forkCreated = true;
        vm.createSelectFork(rpc);

        // Deploy all three adapters
        aaveAdapter = new AaveV3Adapter(VAULT, USDC, AAVE_POOL, A_USDC);
        compoundAdapter = new CompoundAdapter(VAULT, USDC, COMET);
        moonwellAdapter = new MoonwellAdapter(VAULT, USDC, M_USDC, COMPTROLLER, INTEREST_MODEL);
    }

    modifier withFork() {
        if (!forkCreated) return;
        _;
    }

    // ============================================
    // Paper Requirement: Same USDC Verification
    // ============================================

    /// @dev Per paper Section 2.1: verify all three protocols use the same Circle USDC
    function test_allProtocols_useSameCircleUsdc() external withFork {
        // Aave V3 uses Circle USDC
        assertEq(
            IAaveV3AToken(A_USDC).UNDERLYING_ASSET_ADDRESS(),
            USDC,
            "Aave must use Circle USDC"
        );

        // Compound III uses Circle USDC
        assertEq(
            IComet(COMET).baseToken(),
            USDC,
            "Compound must use Circle USDC"
        );

        // Moonwell uses Circle USDC
        assertEq(
            IMToken(M_USDC).underlying(),
            USDC,
            "Moonwell must use Circle USDC"
        );
    }

    // ============================================
    // Deployment Tests
    // ============================================

    function test_aaveAdapter_deployment() external withFork {
        assertEq(aaveAdapter.vault(), VAULT, "vault mismatch");
        assertEq(aaveAdapter.asset(), USDC, "asset mismatch");
        assertEq(aaveAdapter.aToken(), A_USDC, "aToken mismatch");
        assertEq(aaveAdapter.aavePool(), AAVE_POOL, "pool mismatch");
    }

    function test_compoundAdapter_deployment() external withFork {
        assertEq(compoundAdapter.vault(), VAULT, "vault mismatch");
        assertEq(compoundAdapter.asset(), USDC, "asset mismatch");
    }

    function test_moonwellAdapter_deployment() external withFork {
        assertEq(moonwellAdapter.vault(), VAULT, "vault mismatch");
        assertEq(moonwellAdapter.asset(), USDC, "asset mismatch");
        assertEq(moonwellAdapter.mToken(), M_USDC, "mToken mismatch");
    }

    // ============================================
    // Rate Reading Tests
    // ============================================

    function test_allAdapters_haveValidRates() external withFork {
        uint256 aaveRate = aaveAdapter.supplyRatePerYear();
        uint256 compoundRate = compoundAdapter.supplyRatePerYear();
        uint256 moonwellRate = moonwellAdapter.supplyRatePerYear();

        // All rates should be valid (0 to 100% APY)
        assertLe(aaveRate, 1e18, "Aave rate should be <= 100%");
        assertLe(compoundRate, 1e18, "Compound rate should be <= 100%");
        assertLe(moonwellRate, 1e18, "Moonwell rate should be <= 100%");

        // All rates should be non-negative
        assertGe(aaveRate, 0, "Aave rate should be >= 0");
        assertGe(compoundRate, 0, "Compound rate should be >= 0");
        assertGe(moonwellRate, 0, "Moonwell rate should be >= 0");
    }

    // ============================================
    // Access Control Tests
    // ============================================

    function test_aave_onlyVaultCanDeposit() external withFork {
        deal(USDC, address(aaveAdapter), 100e6);
        address alice = makeAddr("alice");

        vm.prank(alice);
        vm.expectRevert(AaveV3Adapter.NotVault.selector);
        aaveAdapter.deposit(100e6);
    }

    function test_compound_onlyVaultCanDeposit() external withFork {
        deal(USDC, address(compoundAdapter), 100e6);
        address alice = makeAddr("alice");

        vm.prank(alice);
        vm.expectRevert(CompoundAdapter.NotVault.selector);
        compoundAdapter.deposit(100e6);
    }

    function test_moonwell_onlyVaultCanDeposit() external withFork {
        deal(USDC, address(moonwellAdapter), 100e6);
        address alice = makeAddr("alice");

        vm.prank(alice);
        vm.expectRevert(MoonwellAdapter.NotVault.selector);
        moonwellAdapter.deposit(100e6);
    }

    // ============================================
    // Full Integration Tests
    // ============================================

    function test_aave_fullDepositWithdrawCycle() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(aaveAdapter), amount);

        // Deposit
        vm.prank(VAULT);
        aaveAdapter.deposit(amount);

        uint256 assets = aaveAdapter.totalAssets();
        assertGt(assets, 0, "should have aUSDC balance");

        // Withdraw
        vm.prank(VAULT);
        aaveAdapter.withdraw(assets, VAULT);

        uint256 vaultBalance = IERC20(USDC).balanceOf(VAULT);
        assertApproxEqAbs(vaultBalance, assets, 5);
    }

    function test_compound_fullDepositWithdrawCycle() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(compoundAdapter), amount);

        // Deposit
        vm.prank(VAULT);
        compoundAdapter.deposit(amount);

        uint256 assets = compoundAdapter.totalAssets();
        assertGt(assets, 0, "should have Comet balance");

        // Withdraw
        vm.prank(VAULT);
        compoundAdapter.withdraw(assets, VAULT);

        uint256 vaultBalance = IERC20(USDC).balanceOf(VAULT);
        assertApproxEqAbs(vaultBalance, assets, 5);
    }

    function test_moonwell_fullDepositWithdrawCycle() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(moonwellAdapter), amount);

        // Deposit
        vm.prank(VAULT);
        moonwellAdapter.deposit(amount);

        uint256 assets = moonwellAdapter.totalAssets();
        assertGt(assets, 0, "should have mUSDC balance");

        // Withdraw
        vm.prank(VAULT);
        moonwellAdapter.withdraw(assets, VAULT);

        uint256 vaultBalance = IERC20(USDC).balanceOf(VAULT);
        assertApproxEqAbs(vaultBalance, assets, 5);
    }

    // ============================================
    // Reserve Data Verification
    // ============================================

    function test_aave_reserveData() external withFork {
        IAaveV3Pool.ReserveData memory data = IAaveV3Pool(AAVE_POOL).getReserveData(USDC);

        assertEq(data.aTokenAddress, A_USDC, "aToken mismatch");
        assertGt(data.liquidityIndex, 0, "liquidity index should be positive");
    }

    function test_compound_utilization() external withFork {
        uint256 util = IComet(COMET).getUtilization();
        assertLe(util, 1e18, "utilization should be <= 100%");
    }

    function test_moonwell_exchangeRate() external withFork {
        uint256 rate = IMToken(M_USDC).exchangeRateStored();
        assertGt(rate, 0, "exchange rate should be positive");
    }

    // ============================================
    // Zero Balance Tests
    // ============================================

    function test_allAdapters_zeroBalanceBeforeDeposit() external withFork {
        assertEq(aaveAdapter.totalAssets(), 0, "Aave should have 0 before deposit");
        assertEq(compoundAdapter.totalAssets(), 0, "Compound should have 0 before deposit");
        assertEq(moonwellAdapter.totalAssets(), 0, "Moonwell should have 0 before deposit");
    }

    // ============================================
    // Multiple Cycle Tests
    // ============================================

    function test_depositAndWithdraw_multipleCycles_allAdapters() external withFork {
        uint256 amount = 50e6;

        // Aave cycles
        deal(USDC, address(aaveAdapter), amount);
        vm.prank(VAULT);
        aaveAdapter.deposit(amount);
        uint256 aaveAssets = aaveAdapter.totalAssets();
        vm.prank(VAULT);
        aaveAdapter.withdraw(aaveAssets, VAULT);
        assertEq(aaveAdapter.totalAssets(), 0, "Aave should be 0 after withdraw");

        // Compound cycles
        deal(USDC, address(compoundAdapter), amount);
        vm.prank(VAULT);
        compoundAdapter.deposit(amount);
        uint256 compoundAssets = compoundAdapter.totalAssets();
        vm.prank(VAULT);
        compoundAdapter.withdraw(compoundAssets, VAULT);
        assertEq(compoundAdapter.totalAssets(), 0, "Compound should be 0 after withdraw");

        // Moonwell cycles
        deal(USDC, address(moonwellAdapter), amount);
        vm.prank(VAULT);
        moonwellAdapter.deposit(amount);
        uint256 moonwellAssets = moonwellAdapter.totalAssets();
        vm.prank(VAULT);
        moonwellAdapter.withdraw(moonwellAssets, VAULT);
        assertEq(moonwellAdapter.totalAssets(), 0, "Moonwell should be 0 after withdraw");
    }
}
