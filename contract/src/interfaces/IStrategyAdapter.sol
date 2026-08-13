// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRewardSource} from "./IRewardSource.sol";

interface IStrategyAdapter is IRewardSource {
    /// @notice Returns the vault that owns this strategy
    function vault() external view returns (address);

    /// @notice Returns the underlying asset (USDC)
    function asset() external view returns (address);

    /// @notice Deposit USDC into the protocol
    /// @param assets Amount of USDC to deposit
    /// @return credited Amount of strategy position credited
    function deposit(uint256 assets) external returns (uint256 credited);

    /// @notice Withdraw USDC from the protocol
    /// @param assets Amount of USDC to withdraw
    /// @return returned Actual USDC returned to vault
    function withdraw(uint256 assets) external returns (uint256 returned);

    /// @notice Total USDC value held in this strategy
    function totalAssets() external view returns (uint256);

    /// @notice Accrue protocol state and return the current USDC position value.
    function sync() external returns (uint256);

    /// @notice Maximum amount withdrawable in same transaction
    function maxWithdrawable() external view returns (uint256);

    /// @notice Maximum additional asset amount deployable under live protocol constraints.
    function maxDeployable() external view returns (uint256);

    /// @notice Unique digest of current protocol configuration
    function configurationDigest() external view returns (bytes32);
}
