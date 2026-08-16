// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for RewardExecutor - converts protocol rewards to USDC via Uniswap V3
interface IRewardExecutor {
    /// @notice Route configuration for swapping reward tokens to USDC
    /// @dev Admits only 1-hop (path[2]) or 2-hop (path[3]) routes through canonical pools
    struct Route {
        address inputToken; /// @dev The reward token (e.g., COMP, WELL)
        address outputToken; /// @dev The output token (must be canonical USDC)
        address[] path; /// @dev Uniswap V3 path: [input, ..., output]; length 2 or 3 only
        uint24[] fees; /// @dev Fee tiers per hop; fees.length == path.length - 1
        address[] pools; /// @dev Canonical pool addresses; pools.length == path.length - 1
        address rewardFeed; /// @dev Chainlink feed for reward/USD price
        address usdcFeed; /// @dev Chainlink feed for USDC/USD price (rate sanity check)
        uint256 maxInput; /// @dev Maximum input amount per swap
        uint256 minOutputBps; /// @dev Minimum output as basis points of input (e.g., 9900 = 99%)
        uint256 maxPriceImpactBps; /// @dev Max price impact in basis points (e.g., 100 = 1%)
        uint256 maxDailyNotional; /// @dev Max notional value per day for this route
        uint256 lowerBound; /// @dev Minimum oracle price (expressed in reward decimals)
        uint256 upperBound; /// @dev Maximum oracle price (expressed in reward decimals)
        bytes32 activationBlockHash; /// @dev Block hash at route activation (evidence of pool existence)
        bytes32 routeDigest; /// @dev Digest of route configuration for immutability validation
    }

    /// @notice Route approved event
    event RouteApproved(bytes32 indexed routeId, address indexed inputToken, address indexed outputToken);

    /// @notice Route revoked event
    event RouteRevoked(bytes32 indexed routeId);

    /// @notice Swap executed event
    event Swapped(
        bytes32 indexed routeId,
        address indexed inputToken,
        address indexed outputToken,
        uint256 amountIn,
        uint256 amountOut,
        uint256 priceImpactBps
    );

    /// @notice Daily volume reset event
    event DailyVolumeReset(bytes32 indexed routeId, uint256 indexed day, uint256 volume);

    /// @notice Execute a swap via an approved route
    /// @param routeId The route identifier
    /// @param amountIn The amount of input token to swap
    /// @param minAmountOut Minimum amount of USDC expected
    /// @param deadline The swap deadline (block.timestamp must be <= deadline)
    /// @return amountOut Actual amount of USDC received
    function swap(bytes32 routeId, uint256 amountIn, uint256 minAmountOut, uint256 deadline)
        external
        returns (uint256 amountOut);

    /// @notice Approve or update a swap route (admin only)
    /// @param routeId Unique identifier for this route (should equal computeDigest output)
    /// @param route_ Route configuration
    function approveRoute(bytes32 routeId, Route calldata route_) external;

    /// @notice Revoke a swap route (admin only)
    /// @param routeId The route to revoke
    function revokeRoute(bytes32 routeId) external;

    /// @notice Set daily volume for testing purposes (admin only)
    /// @param routeId The route ID
    /// @param day The day number
    /// @param volume The volume to set
    function setDailyVolume(bytes32 routeId, uint256 day, uint256 volume) external;

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

    /// @notice Get the admin address
    /// @return address
    function admin() external view returns (address);

    /// @notice Get the canonical USDC address
    /// @return address
    function canonicalUsdc() external view returns (address);

    /// @notice Get the Uniswap V3 factory address
    /// @return address
    function factory() external view returns (address);

    /// @notice Get the SwapRouter02 address
    /// @return address
    function swapRouter02() external view returns (address);

    /// @notice Get the sequencer uptime feed address
    /// @return address
    function sequencerFeed() external view returns (address);

    /// @notice Get the recovery grace period in seconds
    /// @return uint256
    function recoveryGrace() external view returns (uint256);

    /// @notice Get daily volume for a route on a specific day
    /// @param routeId The route identifier
    /// @param day The day number (days since epoch)
    /// @return uint256 Volume in USDC terms
    function dailyVolume(bytes32 routeId, uint256 day) external view returns (uint256);

    /// @notice Check if a route exists
    /// @param routeId The route identifier
    /// @return bool
    function isRouteApproved(bytes32 routeId) external view returns (bool);

    /// @notice Compute the canonical route digest
    /// @param routeId The route ID (should match digest output)
    /// @param route_ The route configuration
    /// @return bytes32 The computed digest
    function computeDigest(bytes32 routeId, Route calldata route_) external pure returns (bytes32);
}
