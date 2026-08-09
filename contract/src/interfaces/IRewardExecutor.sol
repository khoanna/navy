// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRewardExecutor {
    /// @notice Harvest rewards from an adapter
    function harvest(
        address adapter,
        address rewardToken,
        bytes32 routeId,
        uint256 amountIn,
        uint256 minOut,
        uint256 deadline,
        bytes32 decisionHash
    ) external returns (uint256 usdcOut);
}
