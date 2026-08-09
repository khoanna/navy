// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";

contract MockAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    uint256 public withdrawCallCount;
    uint256 public lastWithdrawRequest;
    bool public revertAssetReads;
    bool public revertWithdrawals;

    address[] private _rewardTokens;
    mapping(address => uint256) public rewards;

    error NotVault();
    error WithdrawFailed();

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

    function setWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
    }

    function setRevertAssetReads(bool shouldRevert) external {
        revertAssetReads = shouldRevert;
    }

    function setRevertWithdrawals(bool shouldRevert) external {
        revertWithdrawals = shouldRevert;
    }

    function setRewardTokens(address[] memory tokens_) external {
        _rewardTokens = tokens_;
    }

    function setClaimableReward(address token, uint256 amount) external {
        rewards[token] = amount;
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

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    function claimableReward(address token) external view returns (uint256) {
        return rewards[token];
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        reportedAssets += assets;
        withdrawableAssets += assets;
        return assets;
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
        if (revertWithdrawals) revert WithdrawFailed();

        withdrawCallCount += 1;
        lastWithdrawRequest = assets;
        returnedAssets = assets > withdrawableAssets ? withdrawableAssets : assets;
        withdrawableAssets -= returnedAssets;
        if (reportedAssets > returnedAssets) {
            reportedAssets -= returnedAssets;
        } else {
            reportedAssets = 0;
        }
        IERC20(assetAddress).safeTransfer(vaultAddress, returnedAssets);
    }
}
