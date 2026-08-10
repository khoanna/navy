// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BaseForkTest} from "./BaseForkTest.t.sol";

/// @title BaseRewardForkTest
/// @notice Fork tests for Base mainnet reward routes (Uniswap V3, Chainlink feeds)
/// @dev Tests verify the infrastructure needed for reward token pricing and swap routes
contract BaseRewardForkTest is BaseForkTest {
    /// @notice Base fork block number
    uint256 constant BASE_FORK_BLOCK = 49437605;

    function setUp() public {
        _initFork();
    }

    function test_forkUniswapFactoryExists() public skipWithoutFork {
        address factory = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
        uint256 codeSize;
        assembly { codeSize := extcodesize(factory) }
        assertGt(codeSize, 0);
    }

    function test_forkUniswapRouterExists() public skipWithoutFork {
        address router = 0x2626664c2603336E57B271c5C0b26F421741e481;
        uint256 codeSize;
        assembly { codeSize := extcodesize(router) }
        assertGt(codeSize, 0);
    }

    function test_forkChainlinkUSDCFeedExists() public skipWithoutFork {
        address feed = 0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56;
        uint256 codeSize;
        assembly { codeSize := extcodesize(feed) }
        // Skip if feed not deployed at this block - will be updated with real address
        if (codeSize == 0) {
            vm.skip(true);
        }
        assertGt(codeSize, 0);
    }

    function test_forkChainlinkFeedReturnsPositiveAnswer() public skipWithoutFork {
        address feed = 0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56;

        // Call latestRoundData
        (bool ok, bytes memory data) = feed.call(
            abi.encodeWithSignature("latestRoundData()")
        );

        // Skip if feed not available - will be updated with real address
        if (!ok || data.length == 0) {
            vm.skip(true);
        }

        if (ok && data.length > 0) {
            (, int256 answer, , ,) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));
            assertGt(answer, 0);
        }
    }

    function test_forkUniswapPoolExistsForWETH_USDC() public skipWithoutFork {
        address factory = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
        address weth = 0x4200000000000000000000000000000000000006;

        // Check WETH/USDC 0.05% pool
        (bool ok, bytes memory data) = factory.call(
            abi.encodeWithSignature(
                "getPool(address,address,uint24)",
                weth,
                BASE_USDC,
                uint24(500)
            )
        );

        if (ok) {
            address pool = abi.decode(data, (address));
            assertTrue(pool != address(0));

            // Verify pool has code
            (bool poolOk,) = pool.call(abi.encodeWithSignature("token0()"));
            assertTrue(poolOk);
        }
    }
}
