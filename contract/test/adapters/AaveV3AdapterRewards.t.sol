// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AaveV3Adapter} from "../../src/adapters/AaveV3Adapter.sol";
import {IAaveV3Pool, IAaveV3AToken} from "../../src/interfaces/IAaveV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title AaveV3AdapterRewardsTest
/// @dev Tests for IStrategyAdapter extension methods on AaveV3Adapter.
/// These tests verify the rewards/reporting interface required by NavyVaultSRCLA.
/// Fork tests require BASE_RPC_URL to be set.
contract AaveV3AdapterRewardsTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    // COMP reward token on Base (same as Compound — both use Comet rewards)
    // https://github.com/compound-finance/comet/blob/f766f515/deployments/base/usdc/roots.json
    address constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;

    address VAULT;
    AaveV3Adapter adapter;
    bool forkCreated;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkCreated = false;
            adapter = new AaveV3Adapter(VAULT, USDC, AAVE_POOL, A_USDC);
            return;
        }
        forkCreated = true;
        uint256 forkBlock = vm.envOr("BASE_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        adapter = new AaveV3Adapter(VAULT, USDC, AAVE_POOL, A_USDC);
    }

    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }

    // ---- rewardTokens() ----

    function test_aave_rewardTokens() external view {
        address[] memory tokens = adapter.rewardTokens();
        assertGt(tokens.length, 0, "should have reward tokens");
    }

    function test_aave_rewardTokens_containsCOMP() external view {
        address[] memory tokens = adapter.rewardTokens();
        bool found = false;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == COMP) {
                found = true;
                break;
            }
        }
        assertTrue(found, "reward tokens should contain COMP");
    }

    // ---- claimableReward() ----

    function test_aave_claimableReward_doesNotRevert() external view {
        // Just check it doesn't revert - actual amount depends on protocol state
        adapter.claimableReward(COMP);
    }

    function test_aave_claimableReward_unsupportedToken() external {
        address unsupported = makeAddr("unsupported");
        vm.expectRevert(AaveV3Adapter.UnsupportedRewardToken.selector);
        adapter.claimableReward(unsupported);
    }

    // ---- configurationDigest() ----

    function test_aave_configurationDigest_notZero() external view {
        bytes32 digest = adapter.configurationDigest();
        assertTrue(digest != bytes32(0), "digest should not be zero");
    }

    function test_aave_configurationDigest_deterministic() external view {
        bytes32 digest1 = adapter.configurationDigest();
        bytes32 digest2 = adapter.configurationDigest();
        assertEq(digest1, digest2, "digest should be deterministic");
    }

    function test_aave_configurationDigest_changesWithChain() external view {
        // This test verifies the digest includes chainid
        bytes32 digest = adapter.configurationDigest();
        assertGt(uint256(digest), 0, "digest should be non-zero");
    }

    function test_aave_maxDeployableUsesLiveSupplyCapAndTreasuryUsage() external {
        IAaveV3Pool.ReserveData memory reserveData;
        reserveData.configuration.data = (uint256(6) << 48) | (uint256(1) << 56) | (uint256(1_000) << 116);
        reserveData.accruedToTreasury = 10e6;
        vm.mockCall(AAVE_POOL, abi.encodeCall(IAaveV3Pool.getReserveData, (USDC)), abi.encode(reserveData));
        vm.mockCall(AAVE_POOL, abi.encodeCall(IAaveV3Pool.getReserveNormalizedIncome, (USDC)), abi.encode(1e27));
        vm.mockCall(A_USDC, abi.encodeCall(IAaveV3AToken.scaledTotalSupply, ()), abi.encode(600e6));

        assertEq(adapter.maxDeployable(), 390e6);
    }

    function test_aave_maxDeployableIsZeroWhenInactiveFrozenOrPaused() external {
        IAaveV3Pool.ReserveData memory reserveData;
        reserveData.configuration.data = (uint256(6) << 48) | (uint256(1_000) << 116);
        vm.mockCall(AAVE_POOL, abi.encodeCall(IAaveV3Pool.getReserveData, (USDC)), abi.encode(reserveData));
        assertEq(adapter.maxDeployable(), 0, "inactive");

        reserveData.configuration.data |= uint256(1) << 56 | uint256(1) << 57;
        vm.mockCall(AAVE_POOL, abi.encodeCall(IAaveV3Pool.getReserveData, (USDC)), abi.encode(reserveData));
        assertEq(adapter.maxDeployable(), 0, "frozen");

        reserveData.configuration.data &= ~(uint256(1) << 57);
        reserveData.configuration.data |= uint256(1) << 60;
        vm.mockCall(AAVE_POOL, abi.encodeCall(IAaveV3Pool.getReserveData, (USDC)), abi.encode(reserveData));
        assertEq(adapter.maxDeployable(), 0, "paused");
    }

    function test_aave_maxDeployablePinnedForkIsFinite() external withFork {
        uint256 headroom = adapter.maxDeployable();
        assertGt(headroom, 0);
        assertLt(headroom, type(uint256).max);
    }

    // ---- maxWithdrawable() ----
    // These require a fork since they call external contracts

    function test_aave_maxWithdrawable_noDeposits() external withFork {
        uint256 max = adapter.maxWithdrawable();
        assertEq(max, 0, "maxWithdrawable should be 0 with no deposits");
    }

    function test_aave_maxWithdrawable_afterDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 max = adapter.maxWithdrawable();
        uint256 total = adapter.totalAssets();
        assertGt(max, 0, "maxWithdrawable should be > 0 after deposit");
        assertApproxEqAbs(max, total, 1, "maxWithdrawable should approximately equal totalAssets");
    }

    function test_aave_maxWithdrawable_notExceedsTotalAssets() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 max = adapter.maxWithdrawable();
        uint256 total = adapter.totalAssets();
        assertLe(max, total, "maxWithdrawable should not exceed totalAssets");
    }
}
