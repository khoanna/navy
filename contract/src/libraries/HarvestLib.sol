// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRewardExecutor} from "../interfaces/IRewardExecutor.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @title HarvestLib - Atomic harvest logic extracted to reduce vault bytecode
library HarvestLib {
    using SafeERC20 for IERC20;

    // Use unique errors to avoid conflicts with vault errors
    error HL_TokenNotAdmitted();
    error HL_ClaimedAmountMismatch();
    error HL_ClaimExceedsMax();
    error HL_InvalidSwapOutput();
    error HL_SlippageExceeded();
    error HL_RewardExecutorNotSet();

    /// @notice Execute atomic harvest for a single reward token
    function harvestAtomic(
        address adapter,
        address token,
        uint256 maxClaim,
        bytes32 routeId,
        uint256 minOut,
        uint256 deadline,
        address rewardExec,
        address usdcAddr
    ) internal returns (uint256 usdcReceived) {
        if (rewardExec == address(0)) revert HL_RewardExecutorNotSet();

        IStrategyAdapter a = IStrategyAdapter(adapter);

        // Verify token admitted
        bool admitted;
        address[] memory tokens = a.rewardTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) { admitted = true; break; }
        }
        if (!admitted) revert HL_TokenNotAdmitted();

        // Snapshot, claim, verify
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        uint256 claimed = a.claimReward(token, maxClaim, address(this));
        uint256 delta = IERC20(token).balanceOf(address(this)) - balBefore;

        if (delta != claimed) revert HL_ClaimedAmountMismatch();
        if (claimed > maxClaim) revert HL_ClaimExceedsMax();
        if (claimed == 0) return 0;

        // Swap if needed
        if (token != usdcAddr && routeId != bytes32(0)) {
            usdcReceived = _swap(token, delta, routeId, minOut, deadline, rewardExec, usdcAddr);
        }
    }

    function _swap(
        address token,
        uint256 delta,
        bytes32 routeId,
        uint256 minOut,
        uint256 deadline,
        address executor,
        address usdcAddr
    ) internal returns (uint256 usdcReceived) {
        IERC20(token).forceApprove(executor, delta);

        uint256 tokenBefore = IERC20(token).balanceOf(address(this));
        uint256 usdcBefore = IERC20(usdcAddr).balanceOf(address(this));

        uint256 swapOut = IRewardExecutor(executor).swap(routeId, delta, minOut, deadline);

        IERC20(token).forceApprove(executor, 0);

        if (tokenBefore - IERC20(token).balanceOf(address(this)) != delta) {
            revert HL_InvalidSwapOutput();
        }

        usdcReceived = IERC20(usdcAddr).balanceOf(address(this)) - usdcBefore;
        if (usdcReceived != swapOut) revert HL_InvalidSwapOutput();
        if (usdcReceived < minOut) revert HL_SlippageExceeded();
    }
}
