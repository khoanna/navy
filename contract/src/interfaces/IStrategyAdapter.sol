// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Shared Base vault strategy boundary. Adapters are vault-bound and report
/// conservative native-USDC accounting plus immediate withdrawal capacity.
interface IStrategyAdapter {
    function vault() external view returns (address);

    function asset() external view returns (address);

    function configurationDigest() external view returns (bytes32);

    function totalAssets() external view returns (uint256);

    function maxWithdrawable() external view returns (uint256);

    function deposit(uint256 assets) external returns (uint256 credited);

    function withdraw(uint256 assets) external returns (uint256 returnedAssets);
}
