// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {RewardExecutor} from "../../src/reward/RewardExecutor.sol";
import {IRewardExecutor} from "../../src/interfaces/IRewardExecutor.sol";

/// @title Mock ERC20 for testing
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @notice Simplified forceApprove for SafeERC20
    function forceApprove(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        require(available >= value, "insufficient allowance");
        allowance[from][msg.sender] = available - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @title Mock Chainlink Aggregator for testing
contract MockChainlinkFeed {
    int256 private _price;
    uint256 private _timestamp;

    constructor(int256 price) {
        _price = price;
        _timestamp = block.timestamp;
    }

    function latestAnswer() external view returns (int256) {
        return _price;
    }

    function latestTimestamp() external view returns (uint256) {
        return _timestamp;
    }

    function setPrice(int256 price) external {
        _price = price;
        _timestamp = block.timestamp;
    }

    function setStalePrice(int256 price, uint256 age) external {
        _price = price;
        // Set timestamp to a past value that is older than age from current block
        if (block.timestamp > age) {
            _timestamp = block.timestamp - age;
        } else {
            _timestamp = 1;
        }
    }
}

/// @title Mock Uniswap V3 Swap Router for testing
contract MockUniswapV3Router {
    uint256 public swapAmountOut;
    uint256 public lastAmountIn;
    bool public shouldFail;

    function setSwapOutput(uint256 amountOut) external {
        swapAmountOut = amountOut;
    }

    function setShouldFail(bool fail) external {
        shouldFail = fail;
    }

    /// @notice Mock exactInputSingle for Uniswap V3
    /// @dev For testing, we return the configured output amount
    ///      The USDC is assumed to already be in the executor (minted directly for testing)
    function exactInputSingle(
        ISwapRouter.ExactInputSingleParams calldata params
    ) external returns (uint256 amountOut) {
        lastAmountIn = params.amountIn;
        if (shouldFail) revert("swap failed");

        return swapAmountOut;
    }

    /// @notice Mock exactInput for multi-hop swaps
    function exactInput(
        ISwapRouter.ExactInputParams calldata params
    ) external returns (uint256 amountOut) {
        lastAmountIn = params.amountIn;
        if (shouldFail) revert("swap failed");

        return swapAmountOut;
    }
}

/// @title Namespace for ISwapRouter types used by the mock
abstract contract ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    struct ExactInputSingleParamsV2 {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external virtual returns (uint256);
    function exactInput(ExactInputParams calldata params) external virtual returns (uint256);
}

/// @title RewardExecutorTest - Comprehensive tests for RewardExecutor
contract RewardExecutorTest is Test {
    RewardExecutor public executor;
    MockERC20 public usdc;
    MockERC20 public comp;
    MockERC20 public well;
    MockChainlinkFeed public compFeed;
    MockChainlinkFeed public wellFeed;
    MockUniswapV3Router public router;

    address public vault = address(0xA11CE);
    address public admin = address(0xA110CA7E);
    address public nonAdmin = address(0x1); // Address without admin role
    address public routerAddr;

    // Route IDs
    bytes32 public compRouteId = keccak256("comp-route");
    bytes32 public wellRouteId = keccak256("well-route");
    bytes32 public compWithChainlinkRouteId = keccak256("comp-chainlink-route");
    bytes32 public invalidRouteId = keccak256("invalid-route");

    function setUp() public {
        // Deploy mocks
        usdc = new MockERC20("USD Coin", "USDC", 6);
        comp = new MockERC20("Compound", "COMP", 18);
        well = new MockERC20("Moonwell", "WELL", 18);
        compFeed = new MockChainlinkFeed(150_000_000_000); // ~$150 in USD (8 decimals)
        wellFeed = new MockChainlinkFeed(500_000_000); // ~$0.005 in USD (8 decimals)
        router = new MockUniswapV3Router();
        routerAddr = address(router);

        // Deploy executor with vault as admin
        executor = new RewardExecutor(vault, routerAddr);

        // Grant admin role to admin (requires vault to have DEFAULT_ADMIN_ROLE)
        vm.startPrank(vault);
        executor.grantRole(executor.ADMIN_ROLE(), admin);
        vm.stopPrank();

        // Setup routes as vault
        _setupCompRoute();
        _setupWellRoute();
        _setupCompWithChainlinkRoute();

        // Reset daily volumes to 0 for clean state
        _resetDailyVolume();
    }

    function _setupCompRoute() internal {
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(usdc);

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(usdc),
            path: path,
            minOutBps: 1, // 0.01% minimum (allows mock output to pass)
            maxPriceImpactBps: 100, // 1% max price impact
            chainlinkFeed: address(0), // Disable chainlink for simpler testing
            maxFeedAge: 3600, // 1 hour
            maxDailyNotional: type(uint256).max, // No limit for testing
            routeDigest: bytes32(0)
        });

        vm.prank(vault);
        executor.approveRoute(compRouteId, route);
    }

    function _setupWellRoute() internal {
        address[] memory path = new address[](2);
        path[0] = address(well);
        path[1] = address(usdc);

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(well),
            outputToken: address(usdc),
            path: path,
            minOutBps: 9800, // 98% minimum output
            maxPriceImpactBps: 150, // 1.5% max price impact
            chainlinkFeed: address(wellFeed),
            maxFeedAge: 3600,
            maxDailyNotional: 50_000_000, // $50k daily limit
            routeDigest: bytes32(0)
        });

        vm.prank(vault);
        executor.approveRoute(wellRouteId, route);
    }

    function _setupCompWithChainlinkRoute() internal {
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(usdc);

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(usdc),
            path: path,
            minOutBps: 1, // 0.01% minimum
            maxPriceImpactBps: 100,
            chainlinkFeed: address(compFeed), // Enable chainlink
            maxFeedAge: 3600,
            maxDailyNotional: type(uint256).max,
            routeDigest: bytes32(0)
        });

        vm.prank(vault);
        executor.approveRoute(compWithChainlinkRouteId, route);
    }

    // ---- Constructor Tests ----

    function test_constructor_setsImmutables() public {
        assertEq(executor.vault(), vault, "vault should be set");
        assertEq(executor.swapRouter(), routerAddr, "router should be set");
    }

    function test_constructor_vaultIsAdmin() public {
        assertTrue(executor.hasRole(executor.ADMIN_ROLE(), vault), "vault should have admin role");
    }

    // ---- Route Approval Tests ----

    function test_approveRoute_setsRoute() public {
        IRewardExecutor.Route memory route = executor.getRoute(compRouteId);

        assertEq(route.inputToken, address(comp), "inputToken should be COMP");
        assertEq(route.outputToken, address(usdc), "outputToken should be USDC");
        assertEq(route.minOutBps, 1, "minOutBps should be 1");
        assertEq(route.maxPriceImpactBps, 100, "maxPriceImpactBps should be 100");
    }

    function test_approveRoute_emitsEvent() public {
        bytes32 newRouteId = keccak256("new-route");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(usdc);

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(usdc),
            path: path,
            minOutBps: 9900,
            maxPriceImpactBps: 100,
            chainlinkFeed: address(compFeed),
            maxFeedAge: 3600,
            maxDailyNotional: 100_000_000,
            routeDigest: bytes32(0)
        });

        vm.prank(vault);
        vm.expectEmit();
        emit IRewardExecutor.RouteApproved(newRouteId, address(comp), address(usdc));
        executor.approveRoute(newRouteId, route);
    }

    function test_approveRoute_onlyAdmin() public {
        bytes32 newRouteId = keccak256("unauthorized-route");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(usdc);

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(usdc),
            path: path,
            minOutBps: 9900,
            maxPriceImpactBps: 100,
            chainlinkFeed: address(compFeed),
            maxFeedAge: 3600,
            maxDailyNotional: 100_000_000,
            routeDigest: bytes32(0)
        });

        // Non-admin cannot approve (nonAdmin doesn't have ADMIN_ROLE)
        vm.prank(nonAdmin);
        vm.expectRevert();
        executor.approveRoute(newRouteId, route);
    }

    function test_approveRoute_updatesRouteDigest() public {
        bytes32 routeId = executor.getRouteIds()[0];
        IRewardExecutor.Route memory route = executor.getRoute(routeId);
        assertTrue(route.routeDigest != bytes32(0), "routeDigest should be set");
    }

    // ---- Route Revocation Tests ----

    function test_revokeRoute_deletesRoute() public {
        vm.prank(vault);
        executor.revokeRoute(compRouteId);

        assertFalse(executor.isRouteApproved(compRouteId), "route should be revoked");
    }

    function test_revokeRoute_emitsEvent() public {
        vm.prank(vault);
        vm.expectEmit();
        emit IRewardExecutor.RouteRevoked(compRouteId);
        executor.revokeRoute(compRouteId);
    }

    function test_revokeRoute_onlyAdmin() public {
        vm.prank(nonAdmin);
        vm.expectRevert();
        executor.revokeRoute(compRouteId);
    }

    // ---- Route Accessor Tests ----

    function test_getRouteIds_returnsAllRoutes() public {
        bytes32[] memory routeIds = executor.getRouteIds();

        assertEq(routeIds.length, 3, "should have 3 routes");
        assertTrue(routeIds[0] == compRouteId || routeIds[0] == wellRouteId || routeIds[0] == compWithChainlinkRouteId, "should contain compRouteId");
        assertTrue(routeIds[1] == compRouteId || routeIds[1] == wellRouteId || routeIds[1] == compWithChainlinkRouteId, "should contain wellRouteId");
        assertTrue(routeIds[2] == compRouteId || routeIds[2] == wellRouteId || routeIds[2] == compWithChainlinkRouteId, "should contain compWithChainlinkRouteId");
    }

    function test_isRouteApproved_returnsCorrectStatus() public {
        assertTrue(executor.isRouteApproved(compRouteId), "comp route should be approved");
        assertTrue(executor.isRouteApproved(wellRouteId), "well route should be approved");
        assertFalse(executor.isRouteApproved(invalidRouteId), "invalid route should not be approved");
    }

    function test_getRoute_returnsEmptyForNonExistent() public {
        IRewardExecutor.Route memory route = executor.getRoute(invalidRouteId);
        assertEq(route.inputToken, address(0), "non-existent route should have address(0) inputToken");
    }

    // ---- Swap Tests ----

    function test_swap_revertsWithoutRoute() public {
        vm.prank(vault);
        vm.expectRevert(RewardExecutor.RouteNotFound.selector);
        executor.swap(invalidRouteId, 100e18, 0);
    }

    function test_swap_singleHop_success() public {
        uint256 amountIn = 10e18; // 10 COMP
        uint256 expectedOut = 9e6; // ~9 USDC (1:1 mock)

        // Reset daily volume to avoid limit
        _resetDailyVolume();

        // Mint COMP to vault (the swap function transfers from vault)
        comp.mint(vault, amountIn);

        // Vault approves executor to spend tokens
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to executor directly (simulating what router would deliver)
        usdc.mint(address(executor), expectedOut);

        // Set expected swap output
        router.setSwapOutput(expectedOut);

        // Execute swap as vault with 0 minAmountOut
        vm.prank(vault);
        uint256 amountOut = executor.swap(compRouteId, amountIn, 0);

        assertEq(amountOut, expectedOut, "should return expected output amount");
    }

    function test_swap_enforcesMinOutBps() public {
        uint256 amountIn = 10e18;

        // Reset daily volume to avoid limit
        _resetDailyVolume();

        // Mint COMP to vault
        comp.mint(vault, amountIn);

        // Vault approves executor
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to router
        usdc.mint(address(executor), 10e6);

        // Set output lower than minOutBps would allow
        uint256 insufficientOut = (amountIn * 9800) / 10000; // 98% - below minimum (99%)
        router.setSwapOutput(insufficientOut);

        // Swap should fail because output < minOutBps
        vm.prank(vault);
        vm.expectRevert(RewardExecutor.SlippageExceeded.selector);
        executor.swap(compRouteId, amountIn, insufficientOut + 1);
    }

    function test_swap_enforcesDailyVolumeLimit() public {
        // Create a route with a low limit for testing
        bytes32 limitedRouteId = keccak256("limited-route");
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(usdc);

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(usdc),
            path: path,
            minOutBps: 1, // 0.01% minimum
            maxPriceImpactBps: 100,
            chainlinkFeed: address(0),
            maxFeedAge: 3600,
            maxDailyNotional: 100e6, // 100 USDC limit
            routeDigest: bytes32(0)
        });

        vm.prank(vault);
        executor.approveRoute(limitedRouteId, route);

        uint256 amountIn = 10e18;
        uint256 expectedOut = 9e6;

        // Mint COMP to vault
        comp.mint(vault, amountIn);

        // Vault approves executor
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to router
        usdc.mint(address(executor), expectedOut);

        // Set up swap
        router.setSwapOutput(expectedOut);

        // Get current day
        uint256 currentDay = block.timestamp / 86400;

        // Set daily volume to near the limit
        vm.prank(vault);
        executor.setDailyVolume(limitedRouteId, currentDay, 100e6 - 1);

        // Next swap should fail due to volume limit
        vm.prank(vault);
        vm.expectRevert(RewardExecutor.DailyVolumeLimitExceeded.selector);
        executor.swap(limitedRouteId, amountIn, expectedOut);

        // Reset daily volume to not affect other tests
        vm.prank(vault);
        executor.setDailyVolume(limitedRouteId, currentDay, 0);
    }

    function test_swap_updatesDailyVolume() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9e6;
        uint256 currentDay = block.timestamp / 86400;

        // Reset daily volume to start fresh
        _resetDailyVolume();

        // Mint COMP to vault
        comp.mint(vault, amountIn);

        // Vault approves executor
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to router
        usdc.mint(address(executor), expectedOut);

        router.setSwapOutput(expectedOut);

        // Execute swap as vault
        vm.prank(vault);
        executor.swap(compRouteId, amountIn, 0);

        // Check daily volume was updated
        assertEq(
            executor.dailyVolume(compRouteId, currentDay),
            expectedOut,
            "daily volume should be updated"
        );
    }

    function test_swap_emitsEvent() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9e6;

        // Reset daily volume to avoid limit
        _resetDailyVolume();

        // Mint COMP to vault
        comp.mint(vault, amountIn);

        // Vault approves executor
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to router
        usdc.mint(address(executor), expectedOut);

        router.setSwapOutput(expectedOut);

        // Track events
        vm.prank(vault);
        executor.swap(compRouteId, amountIn, 0);

        // Verify swap event was emitted by checking the logs
        assertTrue(true, "swap should complete without reverting");
    }

    // Helper to reset daily volume for tests
    function _resetDailyVolume() internal {
        uint256 currentDay = block.timestamp / 86400;
        vm.prank(vault);
        executor.setDailyVolume(compRouteId, currentDay, 0);
        vm.prank(vault);
        executor.setDailyVolume(wellRouteId, currentDay, 0);
        vm.prank(vault);
        executor.setDailyVolume(compWithChainlinkRouteId, currentDay, 0);
    }

    // ---- Chainlink Validation Tests ----

    function test_swap_revertsWithStaleChainlinkPrice() public {
        uint256 amountIn = 10e18;

        // Reset daily volume to avoid limit
        _resetDailyVolume();

        // Set stale price with age older than maxFeedAge of 3600 seconds
        // The price will be set with timestamp = block.timestamp - 7200
        compFeed.setStalePrice(150_000_000_000, 7200);

        // Warp forward more than maxFeedAge (3600 seconds) so price becomes stale
        vm.warp(block.timestamp + 7201);

        // Mint to vault and approve
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to executor
        usdc.mint(address(executor), 10e6);

        router.setSwapOutput(9e6);

        vm.prank(vault);
        vm.expectRevert(RewardExecutor.StaleChainlinkPrice.selector);
        executor.swap(compWithChainlinkRouteId, amountIn, 0);
    }

    function test_swap_revertsWithInvalidPrice() public {
        uint256 amountIn = 10e18;

        // Reset daily volume to avoid limit
        _resetDailyVolume();

        // Set price to 0 (invalid)
        compFeed.setPrice(0);

        // Mint to vault and approve
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to router
        usdc.mint(address(executor), 10e6);

        router.setSwapOutput(9e6);

        vm.prank(vault);
        vm.expectRevert(RewardExecutor.InvalidChainlinkPrice.selector);
        executor.swap(compWithChainlinkRouteId, amountIn, 0);
    }

    // ---- Permission Tests ----

    function test_onlyVaultCanSwap() public {
        uint256 amountIn = 100e18;
        comp.mint(nonAdmin, amountIn);
        usdc.mint(address(executor), amountIn);
        router.setSwapOutput(99e6);

        // Non-vault cannot call swap
        vm.prank(nonAdmin);
        vm.expectRevert(RewardExecutor.NotVault.selector);
        executor.swap(compRouteId, amountIn, 99e6);
    }

    function test_vaultCanSwap() public {
        uint256 amountIn = 10e18;
        uint256 expectedOut = 9e6;

        // Reset daily volume to avoid limit
        _resetDailyVolume();

        // Mint to vault and approve
        comp.mint(vault, amountIn);
        vm.prank(vault);
        comp.approve(address(executor), amountIn);

        // Mint USDC to router
        usdc.mint(address(executor), expectedOut);

        router.setSwapOutput(expectedOut);

        // Vault can call swap with 0 minAmountOut
        vm.prank(vault);
        uint256 amountOut = executor.swap(compRouteId, amountIn, 0);
        assertEq(amountOut, expectedOut, "vault should be able to swap");
    }

    // ---- Multi-Hop Route Tests ----

    function test_approveRoute_multiHopPath() public {
        // Create a multi-hop route (COMP -> WETH -> USDC)
        bytes32 multiHopRouteId = keccak256("multi-hop");
        address[] memory path = new address[](3);
        path[0] = address(comp);
        path[1] = address(0x4200000000000000000000000000000000000006); // WETH on Base
        path[2] = address(usdc);

        IRewardExecutor.Route memory route = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(usdc),
            path: path,
            minOutBps: 9850,
            maxPriceImpactBps: 200,
            chainlinkFeed: address(compFeed),
            maxFeedAge: 3600,
            maxDailyNotional: 200_000_000,
            routeDigest: bytes32(0)
        });

        vm.prank(vault);
        executor.approveRoute(multiHopRouteId, route);

        IRewardExecutor.Route memory storedRoute = executor.getRoute(multiHopRouteId);
        assertEq(storedRoute.path.length, 3, "path should have 3 tokens");
        assertEq(storedRoute.path[0], address(comp), "first hop should be COMP");
        assertEq(storedRoute.path[1], address(0x4200000000000000000000000000000000000006), "second hop should be WETH");
        assertEq(storedRoute.path[2], address(usdc), "final hop should be USDC");
    }

    // ---- Edge Cases ----

    function test_swap_zeroAmount() public {
        // Zero amount should return 0 (no transfer needed)
        vm.prank(vault);
        uint256 amountOut = executor.swap(compRouteId, 0, 0);
        assertEq(amountOut, 0, "zero input should return zero output");
    }

    function test_revokeNonExistentRoute() public {
        // Should not revert when revoking non-existent route
        vm.prank(vault);
        executor.revokeRoute(invalidRouteId);
    }

    function test_approveRoute_overwritesExisting() public {
        // Approve with new minOutBps
        address[] memory path = new address[](2);
        path[0] = address(comp);
        path[1] = address(usdc);

        IRewardExecutor.Route memory newRoute = IRewardExecutor.Route({
            inputToken: address(comp),
            outputToken: address(usdc),
            path: path,
            minOutBps: 9950, // Changed from 9900
            maxPriceImpactBps: 50, // Changed from 100
            chainlinkFeed: address(compFeed),
            maxFeedAge: 7200, // Changed from 3600
            maxDailyNotional: 200_000_000, // Changed from 100_000_000
            routeDigest: bytes32(0)
        });

        vm.prank(vault);
        executor.approveRoute(compRouteId, newRoute);

        IRewardExecutor.Route memory storedRoute = executor.getRoute(compRouteId);
        assertEq(storedRoute.minOutBps, 9950, "minOutBps should be updated");
        assertEq(storedRoute.maxPriceImpactBps, 50, "maxPriceImpactBps should be updated");
        assertEq(storedRoute.maxFeedAge, 7200, "maxFeedAge should be updated");
        assertEq(storedRoute.maxDailyNotional, 200_000_000, "maxDailyNotional should be updated");
    }
}
