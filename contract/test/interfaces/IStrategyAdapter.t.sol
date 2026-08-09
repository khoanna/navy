// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";
import {MockAdapter} from "../mocks/MockAdapter.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract IStrategyAdapterTest is Test {
    MockAdapter public adapter;
    MockUSDC public usdc;
    address public vault;
    bytes32 public configDigest;

    function setUp() public {
        usdc = new MockUSDC();
        vault = makeAddr("vault");
        configDigest = keccak256("test configuration");

        adapter = new MockAdapter(vault, address(usdc), configDigest);
    }

    function test_vault_returnsConfiguredVault() public view {
        assertEq(adapter.vault(), vault);
    }

    function test_asset_returnsConfiguredAsset() public view {
        assertEq(adapter.asset(), address(usdc));
    }

    function test_configurationDigest_returnsConfiguredDigest() public view {
        assertEq(adapter.configurationDigest(), configDigest);
    }

    function test_totalAssets_returnsReportedAssets() public {
        adapter.setReportedAssets(1000e6);
        assertEq(adapter.totalAssets(), 1000e6);
    }

    function test_maxWithdrawable_returnsWithdrawableAssets() public {
        adapter.setMaxWithdrawable(500e6);
        assertEq(adapter.maxWithdrawable(), 500e6);
    }

    function test_rewardTokens_returnsConfiguredTokens() public {
        address[] memory tokens = new address[](2);
        tokens[0] = makeAddr("reward1");
        tokens[1] = makeAddr("reward2");
        adapter.setRewardTokens(tokens);

        address[] memory result = adapter.rewardTokens();
        assertEq(result.length, 2);
        assertEq(result[0], tokens[0]);
        assertEq(result[1], tokens[1]);
    }

    function test_claimableReward_returnsConfiguredReward() public {
        address rewardToken = makeAddr("rewardToken");
        adapter.setClaimableReward(rewardToken, 100e18);

        assertEq(adapter.claimableReward(rewardToken), 100e18);
    }

    function test_deposit_succeedsFromVault() public {
        uint256 depositAmount = 1000e6;

        // MockAdapter doesn't pull tokens on deposit, just updates internal state
        vm.prank(vault);
        uint256 credited = adapter.deposit(depositAmount);

        assertEq(credited, depositAmount);
        assertEq(adapter.totalAssets(), depositAmount);
        assertEq(adapter.maxWithdrawable(), depositAmount);
    }

    function test_deposit_revertsIfNotVault() public {
        uint256 depositAmount = 1000e6;

        vm.expectRevert(MockAdapter.NotVault.selector);
        adapter.deposit(depositAmount);
    }

    function test_withdraw_succeedsFromVault() public {
        uint256 initialAssets = 1000e6;
        adapter.setReportedAssets(initialAssets);
        adapter.setMaxWithdrawable(initialAssets);

        usdc.mint(address(adapter), initialAssets);

        uint256 vaultBalanceBefore = usdc.balanceOf(vault);

        vm.prank(vault);
        uint256 returned = adapter.withdraw(500e6);

        assertEq(returned, 500e6);
        assertEq(usdc.balanceOf(vault), vaultBalanceBefore + 500e6);
    }

    function test_withdraw_revertsIfNotVault() public {
        vm.expectRevert(MockAdapter.NotVault.selector);
        adapter.withdraw(500e6);
    }

    function test_setConfigurationDigest_updatesDigest() public {
        bytes32 newDigest = keccak256("new configuration");
        adapter.setConfigurationDigest(newDigest);

        assertEq(adapter.configurationDigest(), newDigest);
    }

    function test_interfaceSelectors_areStable() public pure {
        assertEq(IStrategyAdapter.vault.selector, bytes4(keccak256("vault()")));
        assertEq(IStrategyAdapter.asset.selector, bytes4(keccak256("asset()")));
        assertEq(IStrategyAdapter.deposit.selector, bytes4(keccak256("deposit(uint256)")));
        assertEq(IStrategyAdapter.withdraw.selector, bytes4(keccak256("withdraw(uint256)")));
        assertEq(IStrategyAdapter.totalAssets.selector, bytes4(keccak256("totalAssets()")));
        assertEq(IStrategyAdapter.maxWithdrawable.selector, bytes4(keccak256("maxWithdrawable()")));
        assertEq(IStrategyAdapter.configurationDigest.selector, bytes4(keccak256("configurationDigest()")));
        assertEq(IStrategyAdapter.rewardTokens.selector, bytes4(keccak256("rewardTokens()")));
        assertEq(IStrategyAdapter.claimableReward.selector, bytes4(keccak256("claimableReward(address)")));
    }
}
