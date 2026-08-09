// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @notice Interface for Compound V3 Comet
interface IComet {
    /// @notice Supply assets to Compound
    function supply(address from, uint256 amount, address destination) external;

    /// @notice Withdraw assets from Compound
    function withdrawTo(address src, uint256 amount, address to) external;

    /// @notice Get user's balance in underlying units (positive = lending, negative = borrowing)
    function balanceOf(address account) external view returns (int256);

    /// @notice Get cToken address
    function cToken() external view returns (address);

    /// @notice Get available cash for withdrawals
    function getCash() external view returns (uint256);
}

/// @notice Interface for cToken
interface ICToken {
    /// @notice Get balance of cToken
    function balanceOf(address user) external view returns (uint256);

    /// @notice Get underlying asset address
    function underlying() external view returns (address);
}

/// @title CompoundV3Strategy
/// @notice Strategy adapter for Compound V3 protocol
/// @dev Deposits USDC to Compound Comet, tracks position via cToken balance with accrued interest
contract CompoundV3Strategy is IStrategyAdapter {
    using SafeERC20 for IERC20;

    /// @notice Address of the vault
    address public immutable override vault;

    /// @notice Address of the underlying asset (USDC)
    address public immutable override asset;

    /// @notice Address of the Compound Comet
    IComet public immutable comet;

    /// @notice Address of the cToken (cUSDCv3)
    ICToken public immutable cToken;

    /// @notice Cached configuration digest
    bytes32 public cachedConfigDigest;

    /// @notice Custom errors
    error OnlyVault();
    error ZeroAddress();
    error WithdrawPaused();
    error InsufficientProtocolCash();

    /// @notice Event when configuration changes
    event ConfigurationUpdated(bytes32 indexed digest);

    /// @param vault_ Address of the vault
    /// @param asset_ Address of the underlying asset (USDC)
    /// @param comet_ Address of the Compound Comet
    constructor(address vault_, address asset_, address comet_) {
        if (vault_ == address(0)) revert ZeroAddress();
        if (asset_ == address(0)) revert ZeroAddress();
        if (comet_ == address(0)) revert ZeroAddress();

        vault = vault_;
        asset = asset_;
        comet = IComet(comet_);
        cToken = ICToken(IComet(comet_).cToken());

        cachedConfigDigest = _computeConfigDigest();
    }

    /// @notice Deposit assets into Compound V3
    /// @dev Vault sends USDC before calling this function
    /// @param assets Amount of USDC to deposit
    /// @return credited Amount of position credited (cTokens received)
    function deposit(uint256 assets) external override returns (uint256 credited) {
        if (msg.sender != vault) revert OnlyVault();
        if (assets == 0) return 0;

        // Approve comet to spend USDC
        _approveIfNeeded(IERC20(asset), address(comet), assets);

        // Record cToken balance before
        uint256 cTokenBalanceBefore = IERC20(address(cToken)).balanceOf(address(this));

        // Supply to Compound
        comet.supply(address(this), assets, address(this));

        // Calculate actual amount credited
        uint256 cTokenBalanceAfter = IERC20(address(cToken)).balanceOf(address(this));
        credited = cTokenBalanceAfter - cTokenBalanceBefore;

        if (credited > assets) {
            credited = assets;
        }
    }

    /// @dev Helper to approve token spending
    function _approveIfNeeded(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) < amount) {
            SafeERC20.forceApprove(token, spender, amount);
        }
    }

    /// @notice Withdraw assets from Compound V3
    /// @param assets Amount of USDC to withdraw
    /// @return returned Amount of USDC returned to vault
    function withdraw(uint256 assets) external override returns (uint256 returned) {
        if (msg.sender != vault) revert OnlyVault();
        if (assets == 0) return 0;

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));

        // Withdraw from Compound
        comet.withdrawTo(address(this), assets, address(this));

        // Transfer to vault
        uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;

        IERC20(asset).safeTransfer(vault, received);
        returned = received;
    }

    /// @notice Total assets held in strategy
    /// @return Total USDC value including accrued interest
    function totalAssets() external view override returns (uint256) {
        // cToken balance represents our share of Compound pool
        // Compound balance can be negative (borrowing), so we cap at 0
        int256 cometBalance = comet.balanceOf(address(this));
        return cometBalance > 0 ? uint256(cometBalance) : 0;
    }

    /// @notice Maximum amount that can be withdrawn in a single transaction
    /// @return Maximum withdrawable USDC
    function maxWithdrawable() external view override returns (uint256) {
        // Get cToken balance (represents our position)
        int256 position = comet.balanceOf(address(this));
        if (position <= 0) return 0;

        // Limit by protocol cash (available liquidity)
        uint256 protocolCash = comet.getCash();
        uint256 positionValue = uint256(position);

        return positionValue < protocolCash ? positionValue : protocolCash;
    }

    /// @notice List of reward tokens
    /// @return Array of reward token addresses
    function rewardTokens() external pure override returns (address[] memory) {
        // Compound V3 has COMP rewards, return empty for basic implementation
        address[] memory empty = new address[](0);
        return empty;
    }

    /// @notice Claimable reward amount
    /// @param /*token*/ Token address to check rewards for
    /// @return Amount of claimable rewards
    function claimableReward(address /*token*/) external pure override returns (uint256) {
        // Simplified: return 0 for mock testing
        return 0;
    }

    /// @notice Configuration digest for the strategy
    /// @return Unique digest of current protocol configuration
    function configurationDigest() external view override returns (bytes32) {
        return cachedConfigDigest;
    }

    /// @notice Compute configuration digest
    /// @return Configuration digest
    function _computeConfigDigest() internal view returns (bytes32) {
        return keccak256(abi.encode(address(comet), asset, address(cToken)));
    }

    /// @notice Update cached configuration (call after rate model changes)
    function updateConfigDigest() external {
        cachedConfigDigest = _computeConfigDigest();
        emit ConfigurationUpdated(cachedConfigDigest);
    }
}
