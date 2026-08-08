// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";

contract MockStrategyAdapter is IStrategyAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    bool public revertAssetReads;

    error NotVault();

    constructor(address vault_, address asset_, bytes32 configuration_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        configuration = configuration_;
    }

    modifier onlyVault() {
        if (msg.sender != vaultAddress) revert NotVault();
        _;
    }

    function setConfigurationDigest(bytes32 configuration_) external {
        configuration = configuration_;
    }

    function setReportedAssets(uint256 assets_) external {
        reportedAssets = assets_;
        if (withdrawableAssets > assets_) {
            withdrawableAssets = assets_;
        }
    }

    function setMaxWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
    }

    function setRevertAssetReads(bool shouldRevert) external {
        revertAssetReads = shouldRevert;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function configurationDigest() external view returns (bytes32) {
        return configuration;
    }

    function totalAssets() external view returns (uint256) {
        if (revertAssetReads) revert("mock totalAssets revert");
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        reportedAssets += assets;
        withdrawableAssets += assets;
        return assets;
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
        returnedAssets = assets > withdrawableAssets ? withdrawableAssets : assets;
        withdrawableAssets -= returnedAssets;
        if (reportedAssets > returnedAssets) {
            reportedAssets -= returnedAssets;
        } else {
            reportedAssets = 0;
        }
    }
}
