// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02} from "../../src/interfaces/uniswap/ISwapRouter02.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Mock Uniswap V3 SwapRouter for testing
/// @dev Simulates swap: receives input tokens, mints output tokens (USDC) to recipient
contract MockSwapRouter is ISwapRouter02 {
    using SafeERC20 for IERC20;

    uint256 public constant MOCK_PRICE = 1e6; // 1e6 = 1 USDC in 6-decimal terms, for 18dec->6dec conversion
    uint256 public mockPriceOverride;

    // Track last swap params for assertions
    uint256 public lastAmountIn;
    address public lastRecipient;
    address public lastInputToken;
    address public lastOutputToken;

    function setMockPrice(uint256 price) external {
        mockPriceOverride = price;
    }

    function getMockPrice() public view returns (uint256) {
        return mockPriceOverride != 0 ? mockPriceOverride : MOCK_PRICE;
    }

    function exactInput(
        ISwapRouter02.ExactInputParams calldata params
    ) external payable override returns (uint256 amountOut) {
        // Parse from path - path format: [inputToken (20 bytes)][fee (3 bytes)][outputToken (20 bytes)]
        bytes memory pathMem = params.path;
        require(pathMem.length >= 43, "Invalid path length");

        address inputToken;
        address outputToken;

        // Read input and output tokens from path
        assembly {
            inputToken := shr(96, mload(add(add(pathMem, 32), 0)))
            outputToken := shr(96, mload(add(add(pathMem, 32), 23)))
        }

        // Transfer input tokens from sender (executor) to this contract
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Calculate mock output in USDC terms (6 decimals)
        // For a ~$1 reward token (1 reward = 1 USDC = 1e6 units):
        // amountOut = amountIn * 10^6 / 10^18 = amountIn / 10^12 (scaled to USDC decimals)
        // For example: 100e18 * 1e6 / 1e18 = 100e6 = 100 USDC
        uint256 price = getMockPrice();
        amountOut = params.amountIn * price / 1e18;

        // Mint USDC (6-decimal tokens) to recipient
        MockERC20(payable(outputToken)).mint(params.recipient, amountOut);

        // Record for assertions
        lastAmountIn = params.amountIn;
        lastRecipient = params.recipient;
        lastInputToken = inputToken;
        lastOutputToken = outputToken;

        return amountOut;
    }

    function multicall(uint256 deadline, bytes[] calldata data) external payable override returns (bytes[] memory) {
        require(deadline >= block.timestamp, "Deadline expired");
        bytes[] memory results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            results[i] = data[i];
        }
        return results;
    }

    function refundETH() external payable override {
        // No-op for mock
    }

    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable override {
        // No-op for mock
    }
}
