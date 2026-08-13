// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {IMToken, IMComptroller, IMultiRewardDistributor} from "../src/interfaces/IMToken.sol";
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
    address constant REWARD_DISTRIBUTOR = 0xe9005b078701e2A0948D2EaC43010D35870Ad9d2;
    address constant WORMHOLE_WELL = 0xFF8adeC2221f9f4D8dfbAFa6B9a297d17603493D;
    address constant WELL = 0xA88594D404727625A9437C3f886C7643872296AE;
    uint256 constant PINNED_BLOCK = 49_926_094;
    bytes32 constant PINNED_BLOCK_HASH = 0xb0814321bf0e80894112f59df791bc1e471d6d63d0adfe5ff23f4b8eecaf004c;
    uint256 constant PINNED_TIMESTAMP = 1_786_641_535;

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
        uint256 forkBlock = vm.envOr("BASE_FORK_BLOCK", PINNED_BLOCK);
        require(forkBlock == PINNED_BLOCK, "Moonwell fork must use the audited pinned block");
        forkCreated = true;
        vm.createSelectFork(rpc, forkBlock);

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

    function test_forkIsTheAuditedPinnedBlockHashAndTimestamp() external withFork {
        assertEq(block.number, PINNED_BLOCK);
        assertEq(block.timestamp, PINNED_TIMESTAMP);
        vm.rollFork(PINNED_BLOCK + 1);
        assertEq(blockhash(PINNED_BLOCK), PINNED_BLOCK_HASH);
    }

    function test_rewardDependenciesAreDerivedFromMUsdcAndComptroller() external withFork {
        assertEq(IMToken(M_USDC).comptroller(), COMPTROLLER);
        assertEq(IMComptroller(COMPTROLLER).rewardDistributor(), REWARD_DISTRIBUTOR);
        assertEq(address(adapter.rewardDistributor()), REWARD_DISTRIBUTOR);
        assertEq(IMultiRewardDistributor(REWARD_DISTRIBUTOR).comptroller(), COMPTROLLER);
        assertFalse(IMultiRewardDistributor(REWARD_DISTRIBUTOR).paused());
    }

    function test_pinnedRewardEnumerationHasThreeExactStreamsAndNativeWellIsTimeActive() external withFork {
        IMultiRewardDistributor.MarketConfig[] memory configs =
            IMultiRewardDistributor(REWARD_DISTRIBUTOR).getAllMarketConfigs(M_USDC);
        assertEq(configs.length, 3);

        assertEq(configs[0].emissionToken, WORMHOLE_WELL);
        assertEq(configs[0].supplyEmissionsPerSec, 0);
        assertEq(configs[0].endTime, 1_713_564_000);

        assertEq(configs[1].emissionToken, USDC);
        assertEq(configs[1].supplyEmissionsPerSec, 24_801);
        assertEq(configs[1].endTime, 1_733_781_600);
        assertGt(block.timestamp, configs[1].endTime, "stored USDC speed belongs to an ended stream");

        assertEq(configs[2].emissionToken, WELL);
        assertEq(configs[2].supplyEmissionsPerSec, 505_295_011_690_177_700);
        assertEq(configs[2].endTime, 1_786_752_000);
        assertLt(block.timestamp, configs[2].endTime, "native WELL was active only at the pinned timestamp");

        vm.prank(VAULT);
        assertEq(adapter.claimableReward(WELL), 0, "a fresh adapter has no historical rewards");
        assertEq(
            adapter.rewardTokens().length, 0, "positive emissions alone are insufficient without outstanding rewards"
        );
    }

    function test_pinnedClaimApiAccruesAndTransfersOnlyExactNativeWellForFreshSupplier() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);
        vm.prank(VAULT);
        adapter.deposit(amount);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(VAULT);
        uint256 claimable = adapter.claimableReward(WELL);
        assertGt(claimable, 0, "fresh pinned supplier should accrue native WELL before the observed end");

        address[] memory tokens = adapter.rewardTokens();
        assertEq(tokens.length, 1);
        assertEq(tokens[0], WELL);

        uint256 vaultWellBefore = IERC20(WELL).balanceOf(VAULT);
        vm.prank(VAULT);
        uint256 claimed = adapter.claimReward(WELL, type(uint256).max, VAULT);
        assertGt(claimed, 0);
        assertEq(IERC20(WELL).balanceOf(VAULT) - vaultWellBefore, claimed);
        assertLe(claimed, claimable, "measured claim cannot exceed the pre-claim exact outstanding amount");
        assertEq(adapter.pendingRewards(WELL), 0);
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
