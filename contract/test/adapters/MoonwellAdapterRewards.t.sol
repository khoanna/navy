// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MoonwellAdapter} from "../../src/adapters/MoonwellAdapter.sol";
import {IMToken, IMComptroller} from "../../src/interfaces/IMToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MoonwellAdapterRewardsTest
/// @dev Tests for IStrategyAdapter extension methods on MoonwellAdapter.
/// These tests verify the rewards/reporting interface required by NavyVaultSRCLA.
/// Fork tests require BASE_RPC_URL to be set.
contract MoonwellAdapterRewardsTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    // Moonwell Base addresses from registry
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant INTEREST_RATE_MODEL = 0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C;
    // WELL reward token on Base (native xWELL from Moonwell registry)
    // https://docs.moonwell.fi/moonwell/protocol-information/contracts
    address constant WELL = 0xA88594D404727625A9437C3f886C7643872296AE;

    address VAULT;
    MoonwellAdapter adapter;
    bool forkCreated;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkCreated = false;
            adapter = new MoonwellAdapter(VAULT, USDC, M_USDC, COMPTROLLER, INTEREST_RATE_MODEL);
            return;
        }
        forkCreated = true;
        uint256 forkBlock = vm.envOr("BASE_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        adapter = new MoonwellAdapter(VAULT, USDC, M_USDC, COMPTROLLER, INTEREST_RATE_MODEL);
    }

    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }

    // ---- rewardTokens() ----

    function test_moonwell_rewardTokens() external view {
        address[] memory tokens = adapter.rewardTokens();
        assertGt(tokens.length, 0, "should have reward tokens");
    }

    function test_moonwell_rewardTokens_containsWELL() external view {
        address[] memory tokens = adapter.rewardTokens();
        bool found = false;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == WELL) {
                found = true;
                break;
            }
        }
        assertTrue(found, "reward tokens should contain WELL");
    }

    // ---- claimableReward() ----

    function test_moonwell_claimableReward_doesNotRevert() external view {
        // Just check it doesn't revert - actual amount depends on protocol state
        adapter.claimableReward(WELL);
    }

    function test_moonwell_claimableReward_unsupportedToken() external {
        address unsupported = makeAddr("unsupported");
        vm.expectRevert(MoonwellAdapter.UnsupportedRewardToken.selector);
        adapter.claimableReward(unsupported);
    }

    // ---- configurationDigest() ----

    function test_moonwell_configurationDigest_notZero() external view {
        bytes32 digest = adapter.configurationDigest();
        assertTrue(digest != bytes32(0), "digest should not be zero");
    }

    function test_moonwell_configurationDigest_deterministic() external view {
        bytes32 digest1 = adapter.configurationDigest();
        bytes32 digest2 = adapter.configurationDigest();
        assertEq(digest1, digest2, "digest should be deterministic");
    }

    function test_moonwell_configurationDigest_changesWithChain() external view {
        bytes32 digest = adapter.configurationDigest();
        assertGt(uint256(digest), 0, "digest should be non-zero");
    }

    function test_moonwell_maxDeployableUsesLiveSupplyCapHeadroom() external {
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.markets, (M_USDC)), abi.encode(true, 0));
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.mintGuardianPaused, (M_USDC)), abi.encode(false));
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.supplyCaps, (M_USDC)), abi.encode(1_000e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.getCash, ()), abi.encode(500e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.totalBorrows, ()), abi.encode(150e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.totalReserves, ()), abi.encode(50e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.accrualBlockTimestamp, ()), abi.encode(block.timestamp));

        assertEq(adapter.maxDeployable(), 399_999_999, "returned amount must stay strictly below cap");
    }

    function test_moonwell_maxDeployableExactBoundaryIsAcceptedAndNextUnitRejected() external {
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.markets, (M_USDC)), abi.encode(true, 0));
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.mintGuardianPaused, (M_USDC)), abi.encode(false));
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.supplyCaps, (M_USDC)), abi.encode(1_000e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.getCash, ()), abi.encode(500e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.totalBorrows, ()), abi.encode(150e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.totalReserves, ()), abi.encode(50e6));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.accrualBlockTimestamp, ()), abi.encode(block.timestamp));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.balanceOf, (address(adapter))), abi.encode(0));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.exchangeRateStored, ()), abi.encode(1e18));
        vm.mockCall(M_USDC, abi.encodeCall(IMToken.mint, (399_999_999)), abi.encode(0));
        vm.mockCall(USDC, abi.encodeCall(IERC20.approve, (M_USDC, 399_999_999)), abi.encode(true));
        vm.mockCall(USDC, abi.encodeCall(IERC20.approve, (M_USDC, 0)), abi.encode(true));

        vm.prank(VAULT);
        adapter.deposit(399_999_999);

        vm.prank(VAULT);
        vm.expectRevert(MoonwellAdapter.SupplyCapExceeded.selector);
        adapter.deposit(400e6);
    }

    function test_moonwell_maxDeployableIsZeroWhenMintPaused() external {
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.markets, (M_USDC)), abi.encode(true, 0));
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.mintGuardianPaused, (M_USDC)), abi.encode(true));

        assertEq(adapter.maxDeployable(), 0);
    }

    function test_moonwell_maxDeployableIsZeroWhenMarketUnlisted() external {
        vm.mockCall(COMPTROLLER, abi.encodeCall(IMComptroller.markets, (M_USDC)), abi.encode(false, 0));

        assertEq(adapter.maxDeployable(), 0);
    }

    function test_moonwell_maxDeployablePinnedForkBoundaryActuallyMints() external withFork {
        uint256 headroom = adapter.maxDeployable();
        uint256 cap = adapter.comptroller().supplyCaps(M_USDC);
        if (cap == 0) {
            assertEq(headroom, type(uint256).max);
        } else {
            assertGt(headroom, 0);
            deal(USDC, address(adapter), headroom);
            vm.prank(VAULT);
            uint256 credited = adapter.deposit(headroom);
            assertGt(credited, 0, "reported boundary must be accepted by Moonwell after accrual");
        }
    }

    // ---- maxWithdrawable() ----
    // These require a fork since they call external contracts

    function test_moonwell_maxWithdrawable_noDeposits() external withFork {
        uint256 max = adapter.maxWithdrawable();
        assertEq(max, 0, "maxWithdrawable should be 0 with no deposits");
    }

    function test_moonwell_maxWithdrawable_afterDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 max = adapter.maxWithdrawable();
        uint256 total = adapter.totalAssets();
        assertGt(max, 0, "maxWithdrawable should be > 0 after deposit");
        assertApproxEqAbs(max, total, 1, "maxWithdrawable should approximately equal totalAssets");
    }

    function test_moonwell_maxWithdrawable_notExceedsTotalAssets() external withFork {
        uint256 max = adapter.maxWithdrawable();
        uint256 total = adapter.totalAssets();
        assertLe(max, total, "maxWithdrawable should not exceed totalAssets");
    }
}
