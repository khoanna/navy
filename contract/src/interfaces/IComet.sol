// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Compound III (Comet) surface used by CompoundAdapter.
interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdrawTo(address to, address asset, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function getUtilization() external view returns (uint256);
    function getSupplyRate(uint256 utilization) external view returns (uint64);
    function baseToken() external view returns (address);
    function isSupplyPaused() external view returns (bool);
    function totalSupply() external view returns (uint256);
    function baseTrackingSupplySpeed() external view returns (uint64);
    function baseMinForRewards() external view returns (uint104);
    function baseTrackingAccrued(address account) external view returns (uint64);
}

/// @dev Exact Compound III CometRewards surface used by CompoundAdapter.
interface ICometRewards {
    struct RewardConfig {
        address token;
        uint64 rescaleFactor;
        bool shouldUpscale;
        uint256 multiplier;
    }

    struct RewardOwed {
        address token;
        uint256 owed;
    }

    function rewardConfig(address comet) external view returns (RewardConfig memory);
    function rewardsClaimed(address comet, address account) external view returns (uint256);
    function getRewardOwed(address comet, address account) external returns (RewardOwed memory);
    function claim(address comet, address src, bool shouldAccrue) external;
}
