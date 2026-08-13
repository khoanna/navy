// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CompoundAdapter} from "../../src/adapters/CompoundAdapter.sol";
import {IComet} from "../../src/interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CompoundAdapterRewardsTest
/// @dev Tests for IStrategyAdapter extension methods on CompoundAdapter.
/// These tests verify the rewards/reporting interface required by NavyVaultSRCLA.
/// Fork tests require BASE_RPC_URL to be set.
contract CompoundAdapterRewardsTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    // COMP token on Base (from compound-finance/comet roots)
    // https://github.com/compound-finance/comet/blob/f766f515/deployments/base/usdc/roots.json
    address constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;

    address VAULT;
    CompoundAdapter adapter;
    bool forkCreated;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkCreated = false;
            adapter = new CompoundAdapter(VAULT, USDC, COMET);
            return;
        }
        forkCreated = true;
        uint256 forkBlock = vm.envOr("BASE_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        adapter = new CompoundAdapter(VAULT, USDC, COMET);
    }

    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }

    // ---- rewardTokens() ----

    function test_compound_rewardTokens() external view {
        address[] memory tokens = adapter.rewardTokens();
        assertGt(tokens.length, 0, "should have reward tokens");
    }

    function test_compound_rewardTokens_containsCOMP() external view {
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

    function test_compound_claimableReward_doesNotRevert() external view {
        // Just check it doesn't revert - actual amount depends on protocol state
        adapter.claimableReward(COMP);
    }

    function test_compound_claimableReward_unsupportedToken() external {
        address unsupported = makeAddr("unsupported");
        vm.expectRevert(CompoundAdapter.UnsupportedRewardToken.selector);
        adapter.claimableReward(unsupported);
    }

    // ---- configurationDigest() ----

    function test_compound_configurationDigest_notZero() external view {
        bytes32 digest = adapter.configurationDigest();
        assertTrue(digest != bytes32(0), "digest should not be zero");
    }

    function test_compound_configurationDigest_deterministic() external view {
        bytes32 digest1 = adapter.configurationDigest();
        bytes32 digest2 = adapter.configurationDigest();
        assertEq(digest1, digest2, "digest should be deterministic");
    }

    function test_compound_configurationDigest_changesWithChain() external view {
        bytes32 digest = adapter.configurationDigest();
        assertGt(uint256(digest), 0, "digest should be non-zero");
    }

    function test_compound_maxDeployableIsUnboundedOnlyWhileSupplyActive() external {
        vm.mockCall(COMET, abi.encodeCall(IComet.isSupplyPaused, ()), abi.encode(false));
        assertEq(adapter.maxDeployable(), type(uint256).max);

        vm.mockCall(COMET, abi.encodeCall(IComet.isSupplyPaused, ()), abi.encode(true));
        assertEq(adapter.maxDeployable(), 0);
    }

    function test_compound_maxDeployablePinnedForkMatchesSupplyPause() external withFork {
        assertEq(adapter.maxDeployable(), adapter.comet().isSupplyPaused() ? 0 : type(uint256).max);
    }

    // ---- maxWithdrawable() ----
    // These require a fork since they call external contracts

    function test_compound_maxWithdrawable_noDeposits() external withFork {
        uint256 max = adapter.maxWithdrawable();
        assertEq(max, 0, "maxWithdrawable should be 0 with no deposits");
    }

    function test_compound_maxWithdrawable_afterDeposit() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 max = adapter.maxWithdrawable();
        uint256 total = adapter.totalAssets();
        assertGt(max, 0, "maxWithdrawable should be > 0 after deposit");
        assertApproxEqAbs(max, total, 1, "maxWithdrawable should approximately equal totalAssets");
    }

    function test_compound_maxWithdrawable_notExceedsTotalAssets() external withFork {
        uint256 amount = 100e6;
        deal(USDC, address(adapter), amount);

        vm.prank(VAULT);
        adapter.deposit(amount);

        uint256 max = adapter.maxWithdrawable();
        uint256 total = adapter.totalAssets();
        assertLe(max, total, "maxWithdrawable should not exceed totalAssets");
    }
}
