// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChainlinkPriceFeed, AggregatorV3Interface} from "../../src/oracle/ChainlinkPriceFeed.sol";

/// @title Mock Chainlink Aggregator for testing
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;
    uint256 public startedAt;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;

    function setAnswer(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
        startedAt = block.timestamp;
    }

    function setAnswerWithTimestamp(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
        startedAt = updatedAt_;
    }

    function setStaleAnswer(int256 answer_) external {
        answer = answer_;
        // Use a timestamp from 2 hours ago relative to current block
        uint256 twoHoursAgo = block.timestamp > 2 hours ? block.timestamp - 2 hours : 0;
        updatedAt = twoHoursAgo;
        startedAt = twoHoursAgo;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId_,
            int256 answer_,
            uint256 startedAt_,
            uint256 updatedAt_,
            uint80 answeredInRound_
        )
    {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

/// @title ChainlinkPriceFeedTest - Tests for Chainlink price feed
contract ChainlinkPriceFeedTest is Test {
    ChainlinkPriceFeed public priceFeed;
    MockAggregator public aggregator;

    address public owner = address(0xA11CE);
    int256 public constant ETH_USD_PRICE = 3500 * 1e8; // $3500 with 8 decimals

    function setUp() public {
        aggregator = new MockAggregator();
        aggregator.setAnswer(ETH_USD_PRICE);
        priceFeed = new ChainlinkPriceFeed(address(aggregator));
    }

    // ---- Constructor Tests ----

    function test_constructor_setsFeed() public {
        assertEq(address(priceFeed.feed()), address(aggregator));
    }

    // ---- latestAnswer Tests ----

    function test_latestAnswer_returnsCurrentPrice() public {
        int256 price = priceFeed.latestAnswer();
        assertEq(price, int256(ETH_USD_PRICE));
    }

    function test_latestAnswer_revertsForZeroPrice() public {
        aggregator.setAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.InvalidPrice.selector, 0));
        priceFeed.latestAnswer();
    }

    function test_latestAnswer_revertsForNegativePrice() public {
        aggregator.setAnswer(-1);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.InvalidPrice.selector, -1));
        priceFeed.latestAnswer();
    }

    // ---- getPrice Tests ----

    function test_getPrice_returnsFreshPrice() public {
        int256 price = priceFeed.getPrice(1 hours);
        assertEq(price, int256(ETH_USD_PRICE));
    }

    function test_getPrice_revertsForStalePrice() public {
        // Warp forward first, then set stale answer
        vm.warp(block.timestamp + 2 hours + 1);
        aggregator.setStaleAnswer(ETH_USD_PRICE);

        vm.expectRevert();
        priceFeed.getPrice(1 hours);
    }

    function test_getPrice_acceptsLargeMaxAge() public {
        int256 price = priceFeed.getPrice(365 days);
        assertEq(price, int256(ETH_USD_PRICE));
    }

    function test_getPrice_revertsForZeroPrice() public {
        aggregator.setAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.InvalidPrice.selector, 0));
        priceFeed.getPrice(1 hours);
    }

    // ---- getPriceWithDeviation Tests ----

    function test_getPriceWithDeviation_acceptsSmallDeviation() public {
        // Set initial price
        aggregator.setAnswer(ETH_USD_PRICE);
        priceFeed.updateLastPrice(ETH_USD_PRICE);

        // Small deviation (0.5%)
        int256 newPrice = ETH_USD_PRICE + int256(ETH_USD_PRICE / 200); // 0.5% increase
        aggregator.setAnswer(newPrice);

        int256 result = priceFeed.getPriceWithDeviation(1 hours, 100); // 1% max deviation
        assertEq(result, newPrice);
    }

    function test_getPriceWithDeviation_revertsForLargeDeviation() public {
        // Set initial price
        aggregator.setAnswer(ETH_USD_PRICE);
        priceFeed.updateLastPrice(ETH_USD_PRICE);

        // Large deviation (10%)
        int256 newPrice = ETH_USD_PRICE + int256(ETH_USD_PRICE / 10); // 10% increase
        aggregator.setAnswer(newPrice);

        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkPriceFeed.PriceDeviationExceeded.selector,
                newPrice,
                int256(ETH_USD_PRICE),
                1000 // 10% deviation in bps
            )
        );
        priceFeed.getPriceWithDeviation(1 hours, 100); // 1% max deviation
    }

    function test_getPriceWithDeviation_skipsCheckOnFirstCall() public {
        // No previous price set
        int256 price = priceFeed.getPriceWithDeviation(1 hours, 1); // Very strict deviation
        assertEq(price, int256(ETH_USD_PRICE));
    }

    function test_getPriceWithDeviation_acceptsNoDeviation() public {
        // Set initial price
        priceFeed.updateLastPrice(ETH_USD_PRICE);

        // Same price
        aggregator.setAnswer(ETH_USD_PRICE);

        int256 result = priceFeed.getPriceWithDeviation(1 hours, 100);
        assertEq(result, ETH_USD_PRICE);
    }

    function test_getPriceWithDeviation_acceptsPriceDrop() public {
        // Set initial price
        aggregator.setAnswer(ETH_USD_PRICE);
        priceFeed.updateLastPrice(ETH_USD_PRICE);

        // Price drop (0.5%)
        int256 newPrice = ETH_USD_PRICE - int256(ETH_USD_PRICE / 200);
        aggregator.setAnswer(newPrice);

        int256 result = priceFeed.getPriceWithDeviation(1 hours, 100);
        assertEq(result, newPrice);
    }

    function test_getPriceWithDeviation_revertsForStalePrice() public {
        // Set initial price
        priceFeed.updateLastPrice(ETH_USD_PRICE);

        // Warp forward first, then set stale answer
        vm.warp(block.timestamp + 2 hours + 1);
        aggregator.setStaleAnswer(ETH_USD_PRICE);

        vm.expectRevert();
        priceFeed.getPriceWithDeviation(1 hours, 100);
    }

    // ---- updateLastPrice Tests ----

    function test_updateLastPrice_storesPrice() public {
        priceFeed.updateLastPrice(ETH_USD_PRICE);
        assertEq(priceFeed.getLastPrice(), ETH_USD_PRICE);
    }

    function test_updateLastPrice_rejectsZero() public {
        priceFeed.updateLastPrice(1);
        priceFeed.updateLastPrice(0);
        assertEq(priceFeed.getLastPrice(), 1); // Should remain unchanged
    }

    function test_updateLastPrice_rejectsNegative() public {
        priceFeed.updateLastPrice(1);
        priceFeed.updateLastPrice(-1);
        assertEq(priceFeed.getLastPrice(), 1); // Should remain unchanged
    }

    // ---- Edge Cases ----

    function test_handlesLargePrice() public {
        int256 largePrice = 1e20; // Very large price
        aggregator.setAnswer(largePrice);

        int256 price = priceFeed.latestAnswer();
        assertEq(price, largePrice);
    }

    function test_handlesSmallPrice() public {
        int256 smallPrice = 1; // Smallest valid price
        aggregator.setAnswer(smallPrice);

        int256 price = priceFeed.latestAnswer();
        assertEq(price, smallPrice);
    }

    function test_deviationCalculation_accuracy() public {
        // Set price at 100 with 8 decimals = $100
        int256 basePrice = 100 * 1e8;
        aggregator.setAnswer(basePrice);
        priceFeed.updateLastPrice(basePrice);

        // Change by 1%
        int256 newPrice = basePrice + int256(basePrice / 100);

        // Deviation should be ~100 bps
        int256 deviation = newPrice > basePrice ? newPrice - basePrice : basePrice - newPrice;
        uint256 deviationBps = uint256(deviation) * 10000 / uint256(basePrice);

        assertEq(deviationBps, 100);
    }
}
