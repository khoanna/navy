// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPriceFeed - Interface for price feed implementations
interface IPriceFeed {
    /// @notice Get the latest price answer
    /// @return The latest price
    function latestAnswer() external view returns (int256);

    /// @notice Get the price with staleness check
    /// @param maxAge Maximum age in seconds before reverting with stale price
    /// @return The price if fresh
    function getPrice(uint256 maxAge) external view returns (int256);

    /// @notice Get the price with staleness and deviation checks
    /// @param maxAge Maximum age in seconds before reverting with stale price
    /// @param maxDeviationBps Maximum deviation in basis points from previous price
    /// @return The price if fresh and within deviation
    function getPriceWithDeviation(uint256 maxAge, uint256 maxDeviationBps) external view returns (int256);
}
