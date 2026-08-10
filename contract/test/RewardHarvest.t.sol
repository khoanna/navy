// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {RewardExecutor} from "../src/RewardExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockChainlink} from "./mocks/MockChainlink.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";
import {MockRewardSource} from "./mocks/MockRewardSource.sol";

contract RewardHarvestIntegrationTest is Test {
    RewardExecutor executor;
    MockERC20 usdc;
    MockERC20 comp;
    MockChainlink compOracle;
    MockChainlink usdcOracle;
    MockSwapRouter router;
    MockRewardSource adapter;
    address admin = address(0xA11);
    address allocator = address(0xA110C);
    address vault = address(0xC001);
    bytes32 constant COMP_ROUTE = bytes32("COMP_USDC");

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        comp = new MockERC20("COMP", "COMP", 18);
        usdcOracle = new MockChainlink(8, 1e8); // 1 USD
        compOracle = new MockChainlink(8, 50e6); // 0.50 USD per COMP
        router = new MockSwapRouter();

        executor = new RewardExecutor(vault, admin, address(router), address(usdc));
        executor.grantRole(executor.ALLOCATOR_ROLE(), allocator);

        // Setup COMP route
        vm.prank(admin);
        executor.setRoute(
            COMP_ROUTE,
            RewardExecutor.Route({
                inputToken: address(comp),
                path: abi.encodePacked(address(comp), uint24(3000), address(usdc)),
                outputToken: address(usdc),
                oracleFeed: address(compOracle),
                maxOracleAge: 3600,
                maxPriceImpactBps: 500, // 5% max price impact (mock router returns ~2x price)
                maxDailyNotional: 1_000_000e6,
                enabled: true
            })
        );

        // Create mock adapter with COMP rewards
        adapter = new MockRewardSource(address(comp));
        comp.mint(address(adapter), 1000e18);
        adapter.setClaimable(1000e18); // Set claimable rewards
    }

    function test_fullHarvestFlow() public {
        uint256 vaultUsdcBefore = usdc.balanceOf(vault);

        vm.prank(allocator);
        uint256 out = executor.harvest(
            address(adapter), address(comp), COMP_ROUTE, 100e18, 0, block.timestamp + 60, bytes32("decision1")
        );

        assertGt(out, 0);
        assertEq(usdc.balanceOf(vault) - vaultUsdcBefore, out);
        assertEq(comp.balanceOf(address(adapter)), 900e18); // 100e18 claimed
    }

    function test_cannotReplayDecision() public {
        vm.prank(allocator);
        executor.harvest(
            address(adapter), address(comp), COMP_ROUTE, 100e18, 0, block.timestamp + 60, bytes32("decision1")
        );

        vm.prank(allocator);
        vm.expectRevert(RewardExecutor.DecisionAlreadyUsed.selector);
        executor.harvest(
            address(adapter), address(comp), COMP_ROUTE, 100e18, 0, block.timestamp + 60, bytes32("decision1")
        );
    }

    function test_staleOracleReverts() public {
        // Warp to a future timestamp so the stale check can work
        vm.warp(10000);

        compOracle.setStale();

        vm.prank(allocator);
        vm.expectRevert(RewardExecutor.StaleOracle.selector);
        executor.harvest(
            address(adapter), address(comp), COMP_ROUTE, 100e18, 0, block.timestamp + 60, bytes32("decision2")
        );
    }

    function test_partialClaimDoesNotAffectNotional() public {
        // Reduce adapter balance
        comp.burn(address(adapter), 900e18);

        vm.prank(allocator);
        uint256 out = executor.harvest(
            address(adapter),
            address(comp),
            COMP_ROUTE,
            100e18, // Request more than available
            0,
            block.timestamp + 60,
            bytes32("decision3")
        );

        // Should have claimed only 100e18 (the actual balance)
        assertGt(out, 0);
        assertEq(comp.balanceOf(address(adapter)), 0);
    }
}
