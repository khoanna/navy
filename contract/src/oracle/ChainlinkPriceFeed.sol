// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";

/// @title ChainlinkPriceFeed - Chainlink aggregator price feed adapter
/// @notice Wraps a Chainlink aggregator to provide stale-price and deviation checks
/// @dev SECURITY: This contract validates all Chainlink round data including:
///      - answeredInRound >= roundId (round completeness)
///      - startedAt != 0 (round has started)
///      - Positive price
///      - Configurable staleness threshold
///      - Deviation checking with access-controlled price updates
contract ChainlinkPriceFeed is IPriceFeed {
    /// @notice Chainlink aggregator interface
    AggregatorV3Interface public immutable feed;

    /// @notice Address authorized to advance the deviation-check baseline.
    address public updater;

    /// @notice Conservative default freshness bound for the legacy getter.
    uint256 public constant DEFAULT_MAX_AGE = 1 hours;

    /// @notice Previous price for deviation checking
    int256 private _lastPrice;

    /// @notice Timestamp of last price update
    uint256 private _lastUpdateTime;

    /// @notice Chain ID for replay protection
    uint256 public immutable chainId;

    /// @notice Thrown when the price is too old
    error StalePrice(uint256 age, uint256 maxAge);

    /// @notice Thrown when price deviates too much from last price
    error PriceDeviationExceeded(int256 currentPrice, int256 lastPrice, uint256 deviationBps);

    /// @notice Thrown when price is negative or zero
    error InvalidPrice(int256 price);

    /// @notice Thrown when round has not started
    error RoundNotStarted();

    /// @notice Thrown when round data is from incomplete round
    error RoundIncomplete(uint80 roundId, uint80 answeredInRound);

    /// @notice Thrown when caller is not authorized to update price
    error Unauthorized();
    error ZeroAddress();

    /// @param _feed Address of the Chainlink aggregator
    constructor(address _feed) {
        if (_feed == address(0)) revert InvalidPrice(0);
        feed = AggregatorV3Interface(_feed);
        updater = msg.sender;
        chainId = block.chainid;

        _getValidatedPrice(type(uint256).max);
    }

    /// @notice Get the latest price from the aggregator with full validation
    /// @return The latest validated price
    function latestAnswer() external view returns (int256) {
        return _getValidatedPrice(DEFAULT_MAX_AGE);
    }

    /// @notice Get the price with staleness check
    /// @param maxAge Maximum age in seconds before reverting
    /// @return The price if fresh
    function getPrice(uint256 maxAge) external view returns (int256) {
        return _getValidatedPrice(maxAge);
    }

    /// @notice Get the price with staleness and deviation checks
    /// @param maxAge Maximum age in seconds before reverting
    /// @param maxDeviationBps Maximum deviation in basis points from previous price
    /// @return The price if fresh and within deviation
    function getPriceWithDeviation(uint256 maxAge, uint256 maxDeviationBps) external view returns (int256) {
        int256 price = _getValidatedPrice(maxAge);
        int256 lastPrice_ = _lastPrice;

        // Skip deviation check if no previous price
        if (lastPrice_ > 0) {
            int256 deviation = price > lastPrice_ ? price - lastPrice_ : lastPrice_ - price;

            // Calculate deviation in basis points
            uint256 deviationBps = uint256(deviation) * 10_000 / uint256(lastPrice_);

            if (deviationBps > maxDeviationBps) {
                revert PriceDeviationExceeded(price, lastPrice_, deviationBps);
            }
        }

        return price;
    }

    /// @notice Internal function to validate and return price from Chainlink
    /// @param maxAge Maximum age in seconds (use type(uint256).max for no staleness check)
    /// @return price The validated price
    function _getValidatedPrice(uint256 maxAge) internal view returns (int256 price) {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            feed.latestRoundData();

        // Check round has started
        if (startedAt == 0) revert RoundNotStarted();

        // Check round is complete (answeredInRound >= roundId)
        if (answeredInRound < roundId) revert RoundIncomplete(roundId, answeredInRound);

        // Check price is positive
        if (answer <= 0) revert InvalidPrice(answer);

        // Check staleness (skip if maxAge is max uint256)
        if (maxAge != type(uint256).max) {
            if (updatedAt == 0 || updatedAt > block.timestamp) revert RoundNotStarted();
            uint256 age = block.timestamp - updatedAt;
            if (age > maxAge) revert StalePrice(age, maxAge);
        }

        return answer;
    }

    /// @notice Update the stored price (for deviation checking)
    /// @dev Only callable by addresses with valid Chainlink data
    /// @param price The current price to store (validated against feed)
    function updateLastPrice(int256 price) external {
        if (msg.sender != updater) revert Unauthorized();
        // Validate the price matches current Chainlink data
        int256 chainlinkPrice = _getValidatedPrice(type(uint256).max);

        // Price must match current Chainlink price (prevent arbitrary values)
        if (price != chainlinkPrice) revert Unauthorized();

        _lastPrice = price;
        _lastUpdateTime = block.timestamp;
    }

    /// @notice Rotate the updater, for example from deployer to governance.
    function setUpdater(address newUpdater) external {
        if (msg.sender != updater) revert Unauthorized();
        if (newUpdater == address(0)) revert ZeroAddress();
        updater = newUpdater;
    }

    /// @notice Get the last stored price for deviation checking
    function getLastPrice() external view returns (int256) {
        return _lastPrice;
    }

    /// @notice Get the timestamp of the last price update
    function getLastUpdateTime() external view returns (uint256) {
        return _lastUpdateTime;
    }
}

/// @title Chainlink Aggregator V3 Interface
/// @notice Minimal interface for Chainlink aggregator V3
interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
