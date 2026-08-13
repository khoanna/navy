// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {IMToken, IMComptroller, IMInterestRateModel} from "../src/interfaces/IMToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MoonwellAdapterForkTest
/// @dev Fork test for MoonwellAdapter on Base mainnet.
/// Verifies supply/withdraw, rate reading, and onlyVault access control.
/// Per SRCLA paper Section 6.5.
contract MoonwellAdapterForkTest is Test {
    // Base mainnet addresses (per paper Appendix A)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;

    // Moonwell Base Comptroller and Interest Rate Model
    // Per Moonwell registry: https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/chains/8453.json
    address constant COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant INTEREST_MODEL = 0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C;

    address VAULT;
    MoonwellAdapter adapter;
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

        adapter = new MoonwellAdapter(VAULT, USDC, M_USDC, COMPTROLLER, INTEREST_MODEL);
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
        assertEq(adapter.mToken(), M_USDC, "mToken mismatch");
    }

    function test_deployment_verifyUsdcIsCircle() external withFork {
        // Verify Moonwell uses Circle's canonical USDC (per paper Section 2.1)
        assertEq(IMToken(M_USDC).underlying(), USDC, "must use Circle USDC");
    }

    function test_deployment_mintNotPaused() external withFork {
        // Verify minting is not paused (required for deposits)
        assertFalse(adapter.isMintPaused(), "mint should not be paused");
    }

    // ---- Access Control Tests ----

    function test_onlyVault_canDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 mUsdcBalance = IMToken(M_USDC).balanceOf(address(adapter));
        assertGt(mUsdcBalance, 0, "should have mUSDC");
    }

    function test_onlyVault_canWithdraw() external withFork {
        uint256 depositAmount = 100e6;
        deal(USDC, address(adapter), depositAmount);

        vm.prank(VAULT);
        adapter.deposit(depositAmount);

        uint256 vaultBalanceBefore = IERC20(USDC).balanceOf(VAULT);
        vm.prank(VAULT);
        adapter.withdraw(depositAmount);

        uint256 vaultBalanceAfter = IERC20(USDC).balanceOf(VAULT);
        assertGt(vaultBalanceAfter, vaultBalanceBefore, "should receive USDC");
    }

    function test_nonVault_cannotDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(MoonwellAdapter.NotVault.selector);
        adapter.deposit(amount);
    }

    function test_nonVault_cannotWithdraw() external withFork {
        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert(MoonwellAdapter.NotVault.selector);
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
        assertGt(assets, 0, "should have mUSDC");

        // Withdraw
        vm.prank(VAULT);
        adapter.withdraw(assets);

        uint256 vaultBalance = IERC20(USDC).balanceOf(VAULT);
        assertApproxEqAbs(vaultBalance, assets, 5, "should return USDC");
    }

    // ---- Exchange Rate Tests ----

    function test_exchangeRate_stored() external withFork {
        uint256 exchangeRate = IMToken(M_USDC).exchangeRateStored();
        assertGt(exchangeRate, 0, "exchange rate should be positive");
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
