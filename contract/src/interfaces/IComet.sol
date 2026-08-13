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
}
