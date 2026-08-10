// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {RewardExecutor} from "../src/RewardExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockChainlink} from "./mocks/MockChainlink.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";
import {IRewardSource} from "../src/interfaces/IRewardSource.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockRewardSource {
    mapping(address => uint256) public rewards;

    function setReward(address token, uint256 amount) external {
        rewards[token] = amount;
    }

    function claimReward(address token, uint256 maxAmount) external returns (uint256) {
        uint256 available = rewards[token];
        uint256 toClaim = available < maxAmount ? available : maxAmount;
        if (toClaim > 0) {
            rewards[token] = available - toClaim;
            // Transfer tokens from this contract to the caller
            IERC20(token).transfer(msg.sender, toClaim);
        }
        return toClaim;
    }
}

contract RewardExecutorTest is Test {
    RewardExecutor executor;
    MockERC20 usdc;
    MockERC20 rewardToken;
    MockChainlink oracle;
    MockSwapRouter router;
    MockRewardSource rewardSource;
    address admin = address(0xA11);
    address allocator = address(0xA110C);
    address vault = address(0xC001);

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        rewardToken = new MockERC20("REWARD", "REWARD", 18);
        oracle = new MockChainlink(8, 1e8); // 1 USD
        router = new MockSwapRouter();
        rewardSource = new MockRewardSource();

        executor = new RewardExecutor(
            vault,
            admin,
            address(router),
            address(usdc)
        );

        executor.grantRole(executor.ALLOCATOR_ROLE(), allocator);
    }

    function test_adminCanRegisterRoute() public {
        vm.prank(admin);
        executor.setRoute(
            bytes32("TEST_ROUTE"),
            RewardExecutor.Route({
                inputToken: address(rewardToken),
                path: abi.encodePacked(address(rewardToken), uint24(3000), address(usdc)),
                outputToken: address(usdc),
                oracleFeed: address(oracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 50,
                maxDailyNotional: 100_000e6,
                enabled: true
            })
        );

        assertTrue(executor.routeEnabled(bytes32("TEST_ROUTE")));
    }

    function test_nonAdminCannotRegisterRoute() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        executor.setRoute(
            bytes32("TEST_ROUTE"),
            RewardExecutor.Route({
                inputToken: address(rewardToken),
                path: "",
                outputToken: address(usdc),
                oracleFeed: address(oracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 50,
                maxDailyNotional: 100_000e6,
                enabled: true
            })
        );
    }

    function test_adminCanDisableRoute() public {
        vm.prank(admin);
        executor.setRoute(
            bytes32("TEST_ROUTE"),
            RewardExecutor.Route({
                inputToken: address(rewardToken),
                path: "",
                outputToken: address(usdc),
                oracleFeed: address(oracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 50,
                maxDailyNotional: 100_000e6,
                enabled: false
            })
        );

        assertTrue(!executor.routeEnabled(bytes32("TEST_ROUTE")));
    }

    function test_onlyAllocatorCanHarvest() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        executor.harvest(
            address(0xAD07),
            address(rewardToken),
            bytes32("TEST_ROUTE"),
            100e18,
            0,
            block.timestamp + 60,
            bytes32(0)
        );
    }

    function test_harvestFailsWithDisabledRoute() public {
        vm.prank(admin);
        executor.setRoute(
            bytes32("TEST_ROUTE"),
            RewardExecutor.Route({
                inputToken: address(rewardToken),
                path: "",
                outputToken: address(usdc),
                oracleFeed: address(oracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 50,
                maxDailyNotional: 100_000e6,
                enabled: false
            })
        );

        vm.prank(allocator);
        vm.expectRevert();
        executor.harvest(
            address(0xAD07),
            address(rewardToken),
            bytes32("TEST_ROUTE"),
            100e18,
            0,
            block.timestamp + 60,
            bytes32(0)
        );
    }

    function test_harvestSendsUSDToVault() public {
        // Oracle price = 1e8 means 1:1 ratio (reward token = $1 = 1 USDC)
        oracle = new MockChainlink(8, 1e8); // $1 price
        // Mock price defaults to 1e12, giving 1:1 conversion (18dec -> 6dec)

        vm.prank(admin);
        executor.setRoute(
            bytes32("TEST_ROUTE"),
            RewardExecutor.Route({
                inputToken: address(rewardToken),
                path: abi.encodePacked(address(rewardToken), uint24(3000), address(usdc)),
                outputToken: address(usdc),
                oracleFeed: address(oracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 500, // Allow up to 5% slippage (within 1000 limit)
                maxDailyNotional: 1000e18, // Large enough for the harvest
                enabled: true
            })
        );

        // Fund reward source with reward tokens (simulating accumulated rewards)
        rewardToken.mint(address(rewardSource), 100e18);
        rewardSource.setReward(address(rewardToken), 100e18);

        uint256 vaultBalanceBefore = usdc.balanceOf(vault);

        vm.prank(allocator);
        uint256 out = executor.harvest(
            address(rewardSource),
            address(rewardToken),
            bytes32("TEST_ROUTE"),
            100e18,
            0,
            block.timestamp + 60,
            bytes32("decision123")
        );

        assertGt(out, 0);
        assertEq(usdc.balanceOf(vault) - vaultBalanceBefore, out);
    }

    function test_harvestResetsAllowance() public {
        // Oracle price = 1e8 means 1:1 ratio (reward token = $1 = 1 USDC)
        oracle = new MockChainlink(8, 1e8);
        // Mock price defaults to 1e12, giving 1:1 conversion (18dec -> 6dec)

        vm.prank(admin);
        executor.setRoute(
            bytes32("TEST_ROUTE"),
            RewardExecutor.Route({
                inputToken: address(rewardToken),
                path: abi.encodePacked(address(rewardToken), uint24(3000), address(usdc)),
                outputToken: address(usdc),
                oracleFeed: address(oracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 500, // Allow up to 5% slippage (within 1000 limit)
                maxDailyNotional: 1000e18, // Large enough for the harvest
                enabled: true
            })
        );

        // Fund reward source with reward tokens
        rewardToken.mint(address(rewardSource), 100e18);
        rewardSource.setReward(address(rewardToken), 100e18);

        vm.prank(allocator);
        executor.harvest(
            address(rewardSource),
            address(rewardToken),
            bytes32("TEST_ROUTE"),
            100e18,
            0,
            block.timestamp + 60,
            bytes32("decision123")
        );

        assertEq(rewardToken.allowance(address(executor), address(router)), 0);
    }

    function test_harvestRespectsDailyNotionalCap() public {
        // Oracle price = 1e8 means 1:1 ratio (reward token = $1 = 1 USDC)
        oracle = new MockChainlink(8, 1e8);
        // Mock price defaults to 1e12, giving 1:1 conversion (18dec -> 6dec)

        vm.prank(admin);
        executor.setRoute(
            bytes32("TEST_ROUTE"),
            RewardExecutor.Route({
                inputToken: address(rewardToken),
                path: abi.encodePacked(address(rewardToken), uint24(3000), address(usdc)),
                outputToken: address(usdc),
                oracleFeed: address(oracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 500, // Allow up to 5% slippage (within 1000 limit)
                maxDailyNotional: 100e18, // Same scale as amountIn (in reward token units)
                enabled: true
            })
        );

        // Fund reward source with reward tokens
        rewardToken.mint(address(rewardSource), 100e18);
        rewardSource.setReward(address(rewardToken), 100e18);

        // First harvest uses full cap
        vm.prank(allocator);
        executor.harvest(
            address(rewardSource),
            address(rewardToken),
            bytes32("TEST_ROUTE"),
            100e18,
            0,
            block.timestamp + 60,
            bytes32("decision123")
        );

        // Fund for second harvest
        rewardToken.mint(address(rewardSource), 100e18);
        rewardSource.setReward(address(rewardToken), 100e18);

        // Second harvest should fail - cap exceeded
        vm.prank(allocator);
        vm.expectRevert();
        executor.harvest(
            address(rewardSource),
            address(rewardToken),
            bytes32("TEST_ROUTE"),
            100e18,
            0,
            block.timestamp + 60,
            bytes32("decision456")
        );
    }
}
