// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mock adapter implementing IRewardSource for harvest integration tests
contract MockRewardSource {
    IERC20 public rewardToken;
    uint256 public claimable;

    constructor(address rewardToken_) {
        rewardToken = IERC20(rewardToken_);
    }

    function setClaimable(uint256 amount) external {
        claimable = amount;
    }

    function rewardTokens() external view returns (address[] memory) {
        address[] memory tokens = new address[](1);
        tokens[0] = address(rewardToken);
        return tokens;
    }

    function claimableReward(address) external view returns (uint256) {
        return claimable;
    }

    function claimReward(address, uint256 maxAmount) external returns (uint256) {
        uint256 toClaim = maxAmount > claimable ? claimable : maxAmount;
        if (toClaim > 0) {
            claimable -= toClaim;
            rewardToken.transfer(msg.sender, toClaim);
        }
        return toClaim;
    }
}
