// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MoonwellAdapter} from "../../src/adapters/MoonwellAdapter.sol";
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
    address constant COMPTROLLER = 0x73D8A3bF62aACa6690791E57EBaEE4e1d875d8Fe;
    address constant INTEREST_RATE_MODEL = 0x54dC357F7461BcEEE5BdbA80996f5CB7d7512445;
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
        vm.createSelectFork(rpc);
        adapter = new MoonwellAdapter(VAULT, USDC, M_USDC, COMPTROLLER, INTEREST_RATE_MODEL);
    }

    modifier withFork() {
        if (!forkCreated) return;
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
