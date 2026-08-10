// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Uniswap V3 SwapRouter02 interface
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);

    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory);

    function refundETH() external payable;

    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;
}
