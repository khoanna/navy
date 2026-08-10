// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for strategy adapters to expose rewards
interface IRewardSource {
    /// @notice List of reward tokens claimable by this source
    function rewardTokens() external view returns (address[] memory);

    /// @notice Claimable amount of a specific reward token
    function claimableReward(address token) external view returns (uint256);

    /// @notice Claim rewards and transfer to caller
    /// @param token Reward token to claim
    /// @param maxAmount Maximum amount to claim
    /// @return claimed Actual amount claimed
    function claimReward(address token, uint256 maxAmount) external returns (uint256 claimed);
}
