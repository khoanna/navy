// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Narrow reward-accounting hook used by the Base vault to recognize
/// harvestable reward value without conflating it with synchronous liquidity.
interface IRewardAccountant {
    function recognizedRewardAssets() external view returns (uint256);

    function syncForShareAction(bool issuingShares) external returns (uint256 recognizedAssets);
}
