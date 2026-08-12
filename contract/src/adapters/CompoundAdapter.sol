// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CompoundAdapter — supplies the vault's USDC to Compound III (Comet).
/// @dev The adapter is msg.sender to Comet, so Comet credits this contract. totalAssets reads the
/// Comet supplier balance. Only the vault may move funds.
contract CompoundAdapter is IYieldAdapter {
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    address public immutable vault;
    IERC20 public immutable usdc;
    IComet public immutable comet;

    /// @dev COMP reward token on Base
    /// @dev COMP reward token on Base
    /// @notice From official compound-finance/comet roots: 0x9e1028F5F1D5eDE59748FFceE5532509976840E0
    address private constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;

    /// @dev List of reward tokens this adapter can claim
    address[] private _rewardTokens = [COMP];

    error NotVault();
    error UnsupportedRewardToken();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _comet) {
        vault = _vault;
        usdc = IERC20(_usdc);
        comet = IComet(_comet);
    }

    function deposit(uint256 amount) external onlyVault {
        usdc.approve(address(comet), amount);
        comet.supply(address(usdc), amount);
    }

    function withdraw(uint256 amount, address to) external onlyVault {
        comet.withdrawTo(to, address(usdc), amount);
    }

    function totalAssets() external view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    function supplyRatePerYear() external view returns (uint256) {
        uint256 util = comet.getUtilization();
        uint64 ratePerSecond = comet.getSupplyRate(util); // 1e18-scaled per-second
        return uint256(ratePerSecond) * SECONDS_PER_YEAR;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Maximum amount withdrawable in same transaction
    /// @dev Comet supplier balance is always withdrawable. Implements IStrategyAdapter.maxWithdrawable()
    function maxWithdrawable() external view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev Implements IStrategyAdapter.configurationDigest()
    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(
            address(comet),
            address(usdc),
            block.chainid
        ));
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @notice Claimable reward amount for a given token
    /// @dev Implements IStrategyAdapter.claimableReward(). Returns 0 until rewards are integrated.
    function claimableReward(address token) external view returns (uint256) {
        if (token != COMP) revert UnsupportedRewardToken();
        // Compound rewards integration deferred for Phase 2
        return 0;
    }
}
