// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Mock Uniswap V3 Swap Router for testing
/// @dev Simulates Uniswap V3 SwapRouter02 exactInput behavior
contract MockUniswapV3Router {
    uint256 public swapAmountOut = 9000000; // Default return value

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function setSwapOutput(uint256 amountOut) external {
        swapAmountOut = amountOut;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256) {
        // Parse output token from path (last 20 bytes after fee)
        // Path format: tokenIn + fee + tokenOut + ...
        require(params.path.length >= 43, "invalid path");
        address tokenOut = address(bytes20(params.path[params.path.length - 20:]));

        // Mint output tokens to this contract then transfer to recipient
        MockERC20(tokenOut).mint(address(this), swapAmountOut);
        IERC20(tokenOut).transfer(params.recipient, swapAmountOut);
        return swapAmountOut;
    }

    function exactInputSingle(bytes calldata) external payable returns (uint256) {
        return swapAmountOut;
    }

    receive() external payable {}
}

/// @dev Minimal ERC20 mintable for mock router
abstract contract MockERC20 {
    function mint(address to, uint256 amount) external virtual;
    function transfer(address to, uint256 value) external virtual returns (bool);
}
