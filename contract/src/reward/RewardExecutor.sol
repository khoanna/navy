// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IRewardExecutor} from "../interfaces/IRewardExecutor.sol";

/// @title RewardExecutor - Converts protocol rewards to USDC via Uniswap V3
/// @notice This contract handles the conversion of reward tokens (COMP, WELL) to USDC
///         using Uniswap V3 swaps with oracle validation and slippage protection.
contract RewardExecutor is AccessControl, IRewardExecutor {
    using SafeERC20 for IERC20;

    /// @notice Role for admin operations (route management)
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice The vault that owns this executor and can perform swaps
    address public immutable vault;

    /// @notice Uniswap V3 SwapRouter02 address
    address public immutable swapRouter;

    /// @notice Mapping of route ID to route configuration
    mapping(bytes32 => Route) public routes;

    /// @notice List of all approved route IDs
    bytes32[] private _routeIds;

    /// @notice Mapping of route ID to daily volume (routeId, day -> volume)
    mapping(bytes32 => mapping(uint256 => uint256)) public dailyVolume;

    // ---- Custom Errors ----

    /// @notice Thrown when attempting to use a route that doesn't exist
    error RouteNotFound();

    /// @notice Thrown when swap output is below minimum threshold
    error SlippageExceeded();

    /// @notice Thrown when daily volume limit is exceeded
    error DailyVolumeLimitExceeded();

    /// @notice Thrown when Chainlink price is stale
    error StaleChainlinkPrice();

    /// @notice Thrown when Chainlink price is invalid (zero or negative)
    error InvalidChainlinkPrice();

    /// @notice Thrown when Chainlink round has not started
    error RoundNotStarted();

    /// @notice Thrown when Chainlink round is incomplete
    error RoundIncomplete();

    /// @notice Thrown when price impact exceeds configured maximum
    error PriceImpactExceeded(uint256 actualBps, uint256 maxBps);

    /// @notice Thrown when input amount is zero
    error ZeroAmount();

    /// @notice Thrown when caller is not the vault
    error NotVault();

    /// @notice Thrown when Chainlink feed doesn't match route tokens
    error FeedTokenMismatch();

    // ---- Constructor ----

    constructor(address _vault, address _swapRouter) {
        if (_vault == address(0)) revert ZeroAddress();
        if (_swapRouter == address(0)) revert ZeroAddress();

        vault = _vault;
        swapRouter = _swapRouter;

        // Grant admin role to vault
        _grantRole(DEFAULT_ADMIN_ROLE, _vault);
        _grantRole(ADMIN_ROLE, _vault);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // ---- Admin Functions ----

    /// @notice Approve or update a swap route
    /// @param routeId Unique identifier for this route
    /// @param route_ Route configuration
    function approveRoute(bytes32 routeId, Route calldata route_) external onlyRole(ADMIN_ROLE) {
        // Validate route
        if (route_.inputToken == address(0)) revert ZeroAddress();
        if (route_.outputToken == address(0)) revert ZeroAddress();
        if (route_.chainlinkFeed == address(0)) revert ZeroAddress();
        if (route_.maxFeedAge == 0 || route_.maxDailyNotional == 0) revert InvalidRouteLimit();
        // This route schema carries one fee tier, so only a single V3 pool is
        // representable. Multi-hop routes require per-hop fee commitments.
        if (route_.path.length != 2) revert InvalidPath();
        if (route_.path[0] != route_.inputToken || route_.path[route_.path.length - 1] != route_.outputToken) {
            revert InvalidPath();
        }
        if (route_.minOutBps == 0 || route_.minOutBps > 10000) revert InvalidMinOutBps();
        if (route_.maxPriceImpactBps > 10000) revert InvalidMaxPriceImpactBps();

        // Validate fee tier (100=0.01%, 500=0.05%, 3000=0.3%, 10000=1%)
        if (route_.feeTier != 500 && route_.feeTier != 3000 && route_.feeTier != 10000) {
            revert InvalidFeeTier();
        }

        // Fail closed on a malformed, stale, or unsupported feed at approval time.
        _validateChainlinkPrice(route_.chainlinkFeed, route_.maxFeedAge);
        if (AggregatorV3Interface(route_.chainlinkFeed).decimals() > 18) revert FeedTokenMismatch();

        // Check if this is a new route
        bool isNew = routes[routeId].inputToken == address(0);

        // Store route
        routes[routeId] = Route({
            inputToken: route_.inputToken,
            outputToken: route_.outputToken,
            path: route_.path,
            minOutBps: route_.minOutBps,
            maxPriceImpactBps: route_.maxPriceImpactBps,
            feeTier: route_.feeTier,
            chainlinkFeed: route_.chainlinkFeed,
            maxFeedAge: route_.maxFeedAge,
            maxDailyNotional: route_.maxDailyNotional,
            routeDigest: keccak256(abi.encode(route_))
        });

        // Add to route IDs list if new
        if (isNew) {
            _routeIds.push(routeId);
        }

        emit RouteApproved(routeId, route_.inputToken, route_.outputToken);
    }

    /// @notice Revoke a swap route
    /// @param routeId The route to revoke
    function revokeRoute(bytes32 routeId) external onlyRole(ADMIN_ROLE) {
        if (routes[routeId].inputToken == address(0)) {
            // Route doesn't exist, do nothing
            return;
        }

        delete routes[routeId];

        // Remove from route IDs list
        for (uint256 i = 0; i < _routeIds.length; i++) {
            if (_routeIds[i] == routeId) {
                _routeIds[i] = _routeIds[_routeIds.length - 1];
                _routeIds.pop();
                break;
            }
        }

        emit RouteRevoked(routeId);
    }

    /// @notice Set daily volume for testing purposes
    /// @param routeId The route ID
    /// @param day The day number
    /// @param volume The volume to set
    function setDailyVolume(bytes32 routeId, uint256 day, uint256 volume) external onlyRole(ADMIN_ROLE) {
        dailyVolume[routeId][day] = volume;
    }

    // ---- Swap Functions ----

    /// @notice Execute a swap via an approved route
    /// @param routeId The route identifier
    /// @param amountIn The amount of input token to swap
    /// @param minAmountOut Minimum amount of output token expected
    /// @return amountOut Actual amount of output token received
    function swap(bytes32 routeId, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        if (msg.sender != vault) revert NotVault();
        if (amountIn == 0) revert ZeroAmount();

        Route memory route = routes[routeId];
        if (route.inputToken == address(0)) revert RouteNotFound();

        // Get current day
        uint256 currentDay = block.timestamp / 86400;

        // Check daily volume limit
        uint256 routeDailyVolume = dailyVolume[routeId][currentDay];

        // Validate Chainlink price (if configured)
        uint256 oracleExpectedOut;
        if (route.chainlinkFeed != address(0)) {
            _validateChainlinkPrice(route.chainlinkFeed, route.maxFeedAge);
            oracleExpectedOut = _oracleExpectedOut(route, amountIn);
        }

        // Calculate minimum output based on route parameters
        uint256 effectiveMinOut = minAmountOut;
        if (oracleExpectedOut > 0) {
            uint256 routeMin = Math.mulDiv(oracleExpectedOut, route.minOutBps, 10_000);
            uint256 impactMin = Math.mulDiv(oracleExpectedOut, 10_000 - route.maxPriceImpactBps, 10_000);
            if (impactMin > routeMin) routeMin = impactMin;
            if (routeMin > effectiveMinOut) effectiveMinOut = routeMin;
        }

        // Transfer input tokens to this contract
        IERC20(route.inputToken).safeTransferFrom(msg.sender, address(this), amountIn);

        // Approve router to spend input tokens
        IERC20(route.inputToken).forceApprove(swapRouter, amountIn);

        // Calculate expected output for volume tracking
        uint256 expectedNotional = effectiveMinOut;

        // Check and update daily volume
        if (routeDailyVolume + expectedNotional > route.maxDailyNotional) {
            revert DailyVolumeLimitExceeded();
        }

        // Execute swap based on path length
        if (route.path.length == 2) {
            amountOut = _swapSingleHop(route.path[0], route.path[1], amountIn, effectiveMinOut, route.feeTier);
        } else {
            amountOut = _swapMultiHop(route.path, amountIn, effectiveMinOut, route.feeTier);
        }

        // Validate slippage
        if (amountOut < effectiveMinOut) {
            revert SlippageExceeded();
        }

        uint256 impactBps;
        if (oracleExpectedOut > amountOut && oracleExpectedOut > 0) {
            impactBps = Math.mulDiv(oracleExpectedOut - amountOut, 10_000, oracleExpectedOut);
            if (impactBps > route.maxPriceImpactBps) revert PriceImpactExceeded(impactBps, route.maxPriceImpactBps);
        }

        // Update daily volume
        if (routeDailyVolume + amountOut > route.maxDailyNotional) revert DailyVolumeLimitExceeded();
        dailyVolume[routeId][currentDay] = routeDailyVolume + amountOut;

        // Transfer output tokens to vault
        IERC20(route.outputToken).safeTransfer(vault, amountOut);

        emit Swapped(routeId, route.inputToken, route.outputToken, amountIn, amountOut, impactBps);
    }

    // ---- Internal Functions ----

    /// @notice Validate Chainlink price feed with full round data
    /// @param feed The Chainlink aggregator address
    /// @param maxAge Maximum age of price data in seconds
    function _validateChainlinkPrice(address feed, uint256 maxAge) internal view {
        (uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            AggregatorV3Interface(feed).latestRoundData();

        // Check round has started
        if (startedAt == 0) revert RoundNotStarted();

        // Check round is complete
        if (answeredInRound < roundId) revert RoundIncomplete();

        // Check price is positive
        if (price <= 0) revert InvalidChainlinkPrice();

        // Check staleness
        if (updatedAt == 0 || updatedAt > block.timestamp) revert StaleChainlinkPrice();
        if (block.timestamp - updatedAt > maxAge) revert StaleChainlinkPrice();
    }

    function _oracleExpectedOut(Route memory route, uint256 amountIn) internal view returns (uint256) {
        int256 answer = AggregatorV3Interface(route.chainlinkFeed).latestAnswer();
        uint8 inputDecimals = IERC20Metadata(route.inputToken).decimals();
        uint8 outputDecimals = IERC20Metadata(route.outputToken).decimals();
        uint8 feedDecimals = AggregatorV3Interface(route.chainlinkFeed).decimals();
        if (inputDecimals > 18 || outputDecimals > 18 || feedDecimals > 18) revert FeedTokenMismatch();
        uint256 quoted = Math.mulDiv(amountIn, uint256(answer), 10 ** inputDecimals);
        return Math.mulDiv(quoted, 10 ** outputDecimals, 10 ** feedDecimals);
    }

    /// @notice Execute a single-hop swap
    /// @param tokenIn Input token address
    /// @param tokenOut Output token address
    /// @param amountIn Amount of input token
    /// @param minOut Minimum output amount
    /// @param feeTier Uniswap V3 fee tier
    /// @return amountOut Actual output amount
    function _swapSingleHop(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint24 feeTier)
        internal
        returns (uint256 amountOut)
    {
        amountOut = ISwapRouter(swapRouter)
            .exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: feeTier,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                })
            );
    }

    /// @notice Execute a multi-hop swap
    /// @param path Array of token addresses representing the swap path
    /// @param amountIn Amount of input token
    /// @param minOut Minimum output amount
    /// @param baseFeeTier Base fee tier for the path
    /// @return amountOut Actual output amount
    function _swapMultiHop(address[] memory path, uint256 amountIn, uint256 minOut, uint24 baseFeeTier)
        internal
        returns (uint256 amountOut)
    {
        // Build the encoded path for Uniswap V3 with configurable fee for each hop
        bytes memory encodedPath = _encodePath(path, baseFeeTier);

        amountOut = ISwapRouter(swapRouter)
            .exactInput(
                ISwapRouter.ExactInputParams({
                    path: encodedPath, recipient: address(this), amountIn: amountIn, amountOutMinimum: minOut
                })
            );
    }

    /// @notice Encode path for multi-hop swap using configurable fee for each hop
    /// @param path Array of token addresses
    /// @param baseFeeTier Base fee tier for the path
    /// @return bytes Encoded path
    function _encodePath(address[] memory path, uint24 baseFeeTier) internal pure returns (bytes memory) {
        if (path.length < 2) revert InvalidPath();

        bytes memory encoded = abi.encodePacked(path[0]);

        for (uint256 i = 1; i < path.length; i++) {
            encoded = bytes.concat(encoded, abi.encodePacked(baseFeeTier, path[i]));
        }

        return encoded;
    }

    // ---- Accessor Functions ----

    /// @notice Get route configuration by ID
    /// @param routeId The route identifier
    /// @return Route memory
    function getRoute(bytes32 routeId) external view returns (Route memory) {
        return routes[routeId];
    }

    /// @notice Get all approved route IDs
    /// @return bytes32[] Array of route IDs
    function getRouteIds() external view returns (bytes32[] memory) {
        return _routeIds;
    }

    /// @notice Check if a route exists and is approved
    /// @param routeId The route identifier
    /// @return bool
    function isRouteApproved(bytes32 routeId) external view returns (bool) {
        return routes[routeId].inputToken != address(0);
    }
}

// ---- Additional Errors ----

error ZeroAddress();
error InvalidPath();
error InvalidMinOutBps();
error InvalidMaxPriceImpactBps();
error InvalidFeeTier();
error InvalidRouteLimit();

// ---- External Interfaces ----

/// @title AggregatorV3Interface - Chainlink price feed interface
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestAnswer() external view returns (int256);
    function latestTimestamp() external view returns (uint256);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ISwapRouter - Uniswap V3 SwapRouter interface
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
    function exactInput(ExactInputParams calldata params) external returns (uint256 amountOut);
}
