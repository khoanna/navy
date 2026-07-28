// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../../src/interfaces/IYieldAdapter.sol";

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Holds deposited USDC in its own balance (1:1, no yield accrual) and returns a
/// configurable supply rate. `totalAssets` == its USDC balance. For vault unit tests only.
contract MockYieldAdapter is IYieldAdapter {
    address public immutable vault;
    address public immutable assetToken;
    uint256 public rate; // 1e18-scaled APR

    error NotVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _asset, uint256 _rate) {
        vault = _vault;
        assetToken = _asset;
        rate = _rate;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function deposit(uint256) external onlyVault {
        // USDC already transferred in by the vault; nothing else to do (held 1:1).
    }

    function withdraw(uint256 amount, address to) external onlyVault {
        IERC20Min(assetToken).transfer(to, amount);
    }

    function totalAssets() external view returns (uint256) {
        return IERC20Min(assetToken).balanceOf(address(this));
    }

    function supplyRatePerYear() external view returns (uint256) {
        return rate;
    }

    function asset() external view returns (address) {
        return assetToken;
    }
}
