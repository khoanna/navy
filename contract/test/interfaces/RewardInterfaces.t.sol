// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRewardSource} from "src/interfaces/IRewardSource.sol";
import {IAggregatorV3} from "src/interfaces/chainlink/IAggregatorV3.sol";
import {ISwapRouter02} from "src/interfaces/uniswap/ISwapRouter02.sol";
import {IUniswapV3Factory} from "src/interfaces/uniswap/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "src/interfaces/uniswap/IUniswapV3Pool.sol";

/// @notice Minimal mock implementing IRewardSource for interface signature verification
contract MockRewardSource is IRewardSource {
    function rewardTokens() external pure returns (address[] memory) {}
    function claimableReward(address) external pure returns (uint256) {}
    function claimReward(address, uint256) external pure returns (uint256) {}
}

/// @notice Minimal mock implementing IAggregatorV3 for interface signature verification
contract MockAggregatorV3 is IAggregatorV3 {
    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {}
    function decimals() external pure returns (uint8) {}
    function description() external pure returns (string memory) {}
}

/// @notice Minimal mock implementing ISwapRouter02 for interface signature verification
contract MockSwapRouter02 is ISwapRouter02 {
    function exactInput(ExactInputParams calldata) external payable returns (uint256) {}
    function multicall(uint256, bytes[] calldata) external payable returns (bytes[] memory) {}
    function refundETH() external payable {}
    function unwrapWETH9(uint256, address) external payable {}
}

/// @notice Minimal mock implementing IUniswapV3Factory for interface signature verification
contract MockUniswapV3Factory is IUniswapV3Factory {
    function getPool(address, address, uint24) external pure returns (address) {}
}

/// @notice Minimal mock implementing IUniswapV3Pool for interface signature verification
contract MockUniswapV3Pool is IUniswapV3Pool {
    function token0() external pure returns (address) {}
    function token1() external pure returns (address) {}
    function fee() external pure returns (uint24) {}
    function liquidity() external pure returns (uint128) {}
    function slot0() external pure returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {}
}

contract RewardInterfacesTest {
    function test_IRewardSourceHasRequiredFunctions() public {
        MockRewardSource mock = new MockRewardSource();
        IRewardSource source = IRewardSource(address(mock));
        source.rewardTokens();
        source.claimableReward(address(0));
        source.claimReward(address(0), 0);
    }

    function test_IAggregatorV3HasRequiredFunctions() public {
        MockAggregatorV3 mock = new MockAggregatorV3();
        IAggregatorV3 aggregator = IAggregatorV3(address(mock));
        aggregator.latestRoundData();
        aggregator.decimals();
        aggregator.description();
    }

    function test_ISwapRouter02HasExactInput() public {
        MockSwapRouter02 mock = new MockSwapRouter02();
        ISwapRouter02 router = ISwapRouter02(address(mock));
        ISwapRouter02.ExactInputParams memory params =
            ISwapRouter02.ExactInputParams({path: "", recipient: address(0), amountIn: 0, amountOutMinimum: 0});
        router.exactInput(params);
    }
}
