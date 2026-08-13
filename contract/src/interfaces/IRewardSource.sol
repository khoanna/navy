// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for strategy adapters to expose rewards
interface IRewardSource {
    /// @notice List of reward tokens claimable by this source
    function rewardTokens() external view returns (address[] memory);

    /// @notice Claimable amount of a specific reward token
    function claimableReward(address token) external returns (uint256);

    /// @notice Claim rewards and transfer them to an explicit recipient
    /// @param token Reward token to claim
    /// @param maxAmount Maximum amount to claim
    /// @param recipient Address whose exact reward-token balance delta is credited
    /// @return claimed Actual amount received by recipient
    function claimReward(address token, uint256 maxAmount, address recipient) external returns (uint256 claimed);
}
