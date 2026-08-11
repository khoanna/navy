// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for RewardExecutor - converts protocol rewards to USDC via Uniswap V3
interface IRewardExecutor {
    /// @notice Route configuration for swapping reward tokens to USDC
    struct Route {
        address inputToken; /// @dev The reward token (e.g., COMP, WELL)
        address outputToken; /// @dev The output token (typically USDC)
        address[] path; /// @dev Uniswap V3 path (token addresses for multi-hop)
        uint256 minOutBps; /// @dev Minimum output as basis points of input (e.g., 9900 = 99%)
        uint256 maxPriceImpactBps; /// @dev Max price impact in basis points (e.g., 100 = 1%)
        address chainlinkFeed; /// @dev Chainlink price feed for validation
        uint256 maxFeedAge; /// @dev Max age of Chainlink price data in seconds
        uint256 maxDailyNotional; /// @dev Max notional value per day for this route
        bytes32 routeDigest; /// @dev Digest of route configuration for validation
    }

    /// @notice Emitted when a route is approved
    event RouteApproved(bytes32 indexed routeId, address indexed inputToken, address indexed outputToken);

    /// @notice Emitted when a route is revoked
    event RouteRevoked(bytes32 indexed routeId);

    /// @notice Emitted when a swap is executed
    event Swapped(
        bytes32 indexed routeId,
        address indexed inputToken,
        address indexed outputToken,
        uint256 amountIn,
        uint256 amountOut,
        uint256 priceImpactBps
    );

    /// @notice Emitted when daily volume limit is reset
    event DailyVolumeReset(bytes32 indexed routeId, uint256 indexed day, uint256 volume);

    /// @notice Execute a swap via an approved route
    /// @param routeId The route identifier
    /// @param amountIn The amount of input token to swap
    /// @param minAmountOut Minimum amount of output token expected
    /// @return amountOut Actual amount of output token received
    function swap(bytes32 routeId, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut);

    /// @notice Get route configuration by ID
    /// @param routeId The route identifier
    /// @return Route memory
    function getRoute(bytes32 routeId) external view returns (Route memory);

    /// @notice Get all approved route IDs
    /// @return bytes32[] Array of route IDs
    function getRouteIds() external view returns (bytes32[] memory);

    /// @notice Get the vault address (owner)
    /// @return address
    function vault() external view returns (address);

    /// @notice Get the swap router address
    /// @return address
    function swapRouter() external view returns (address);

    /// @notice Get daily volume for a route on a specific day
    /// @param routeId The route identifier
    /// @param day The day number (days since epoch)
    /// @return uint256 Volume in output token terms
    function dailyVolume(bytes32 routeId, uint256 day) external view returns (uint256);

    /// @notice Check if a route exists
    /// @param routeId The route identifier
    /// @return bool
    function isRouteApproved(bytes32 routeId) external view returns (bool);
}
