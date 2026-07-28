// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../../src/interfaces/IYieldAdapter.sol";

interface IERC20Min2 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Test double that pays out only `(amount - lossBase)` on withdraw, to trip the vault's
/// maxLoss guard. Holds USDC 1:1 like MockYieldAdapter otherwise.
contract LossyMockYieldAdapter is IYieldAdapter {
    address public immutable vault;
    address public immutable assetToken;
    uint256 public lossBase; // absolute base-units withheld on each withdraw

    error NotVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _asset, uint256 _lossBase) {
        vault = _vault;
        assetToken = _asset;
        lossBase = _lossBase;
    }

    function deposit(uint256) external onlyVault {}

    function withdraw(uint256 amount, address to) external onlyVault {
        uint256 pay = amount > lossBase ? amount - lossBase : 0;
        IERC20Min2(assetToken).transfer(to, pay);
    }

    function totalAssets() external view returns (uint256) {
        return IERC20Min2(assetToken).balanceOf(address(this));
    }

    function supplyRatePerYear() external pure returns (uint256) {
        return 0;
    }

    function asset() external view returns (address) {
        return assetToken;
    }
}
