// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";

/// @title ChainlinkPriceFeed - Chainlink aggregator price feed adapter
/// @notice Wraps a Chainlink aggregator to provide stale-price and deviation checks
contract ChainlinkPriceFeed is IPriceFeed {
    /// @notice Chainlink aggregator interface
    AggregatorV3Interface public immutable feed;

    /// @notice Previous price for deviation checking
    int256 private _lastPrice;

    /// @notice Timestamp of last price update
    uint256 private _lastUpdateTime;

    /// @notice Thrown when the price is too old
    error StalePrice(uint256 age, uint256 maxAge);

    /// @notice Thrown when price deviates too much from last price
    error PriceDeviationExceeded(int256 currentPrice, int256 lastPrice, uint256 deviationBps);

    /// @notice Thrown when price is negative or zero
    error InvalidPrice(int256 price);

    /// @param _feed Address of the Chainlink aggregator
    constructor(address _feed) {
        feed = AggregatorV3Interface(_feed);
    }

    /// @notice Get the latest price from the aggregator
    /// @return The latest price
    function latestAnswer() external view returns (int256) {
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        return answer;
    }

    /// @notice Get the price with staleness check
    /// @param maxAge Maximum age in seconds before reverting
    /// @return The price if fresh
    function getPrice(uint256 maxAge) external view returns (int256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);

        uint256 age = block.timestamp - updatedAt;
        if (age > maxAge) revert StalePrice(age, maxAge);

        return answer;
    }

    /// @notice Get the price with staleness and deviation checks
    /// @param maxAge Maximum age in seconds before reverting
    /// @param maxDeviationBps Maximum deviation in basis points from previous price
    /// @return The price if fresh and within deviation
    function getPriceWithDeviation(uint256 maxAge, uint256 maxDeviationBps)
        external
        view
        returns (int256)
    {
        // Get price with staleness check (inline logic)
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);

        uint256 age = block.timestamp - updatedAt;
        if (age > maxAge) revert StalePrice(age, maxAge);

        int256 price = answer;

        // Skip deviation check if no previous price
        if (_lastPrice > 0) {
            int256 deviation = price > _lastPrice
                ? price - _lastPrice
                : _lastPrice - price;

            // Calculate deviation in basis points
            uint256 deviationBps = uint256(deviation) * 10000 / uint256(_lastPrice);

            if (deviationBps > maxDeviationBps) {
                revert PriceDeviationExceeded(price, _lastPrice, deviationBps);
            }
        }

        return price;
    }

    /// @notice Update the stored price (for deviation checking)
    /// @param price The current price to store
    function updateLastPrice(int256 price) external {
        if (price > 0) {
            _lastPrice = price;
            _lastUpdateTime = block.timestamp;
        }
    }

    /// @notice Get the last stored price for deviation checking
    function getLastPrice() external view returns (int256) {
        return _lastPrice;
    }
}

/// @title Chainlink Aggregator V3 Interface
/// @notice Minimal interface for Chainlink aggregator V3
interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
