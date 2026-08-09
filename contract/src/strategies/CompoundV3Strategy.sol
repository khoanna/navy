// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @notice Interface for Compound III (Comet) — matches the deployed Base market ABI.
/// @dev Comet has no cToken: positions are tracked via `balanceOf` in base-token units.
interface IComet {
    /// @notice Supply an asset to the market (pulls from msg.sender)
    function supply(address asset, uint256 amount) external;

    /// @notice Withdraw an asset from the market and send to `to`
    function withdrawTo(address to, address asset, uint256 amount) external;

    /// @notice User's balance in base-token units (positive = lending, negative = borrowing)
    function balanceOf(address account) external view returns (int256);

    /// @notice Base token (USDC for this strategy)
    function baseToken() external view returns (address);

    /// @notice Whether withdrawals are paused
    function isWithdrawPaused() external view returns (bool);
}

/// @title CompoundV3Strategy
/// @notice Strategy adapter for Compound III (Comet) on Base
/// @dev Deposits USDC to the Base USDC Comet. Positions are tracked as the positive Comet
///      supplier balance (base-token units); the strategy never borrows. Withdrawal is capped
///      by protocol cash.
contract CompoundV3Strategy is IStrategyAdapter {
    using SafeERC20 for IERC20;

    /// @notice Address of the vault
    address public immutable override vault;

    /// @notice Address of the underlying asset (USDC)
    address public immutable override asset;

    /// @notice Address of the Compound Comet
    IComet public immutable comet;

    /// @notice Cached configuration digest
    bytes32 public cachedConfigDigest;

    /// @notice Custom errors
    error OnlyVault();
    error ZeroAddress();
    error WithdrawPaused();
    error ExceedsPositiveBalance();

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

        cachedConfigDigest = _computeConfigDigest();
    }

    /// @notice Deposit assets into Compound V3
    /// @dev Vault sends USDC before calling this function
    /// @param assets Amount of USDC to deposit
    /// @return credited Amount of position credited (in base-token units)
    function deposit(uint256 assets) external override returns (uint256 credited) {
        if (msg.sender != vault) revert OnlyVault();
        if (assets == 0) return 0;

        int256 balanceBefore = comet.balanceOf(address(this));

        // Approve comet to spend USDC
        _approveIfNeeded(IERC20(asset), address(comet), assets);

        // Supply to Compound
        comet.supply(asset, assets);

        int256 balanceAfter = comet.balanceOf(address(this));
        credited = balanceAfter > balanceBefore ? uint256(balanceAfter - balanceBefore) : 0;

        // Account for any dust/rounding so credited never exceeds requested assets
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

        int256 balance = comet.balanceOf(address(this));
        if (balance < int256(assets)) revert ExceedsPositiveBalance();
        if (comet.isWithdrawPaused()) revert WithdrawPaused();

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));

        // Withdraw from Compound to this strategy, then forward to the vault
        comet.withdrawTo(address(this), asset, assets);

        uint256 received = IERC20(asset).balanceOf(address(this)) - balanceBefore;

        IERC20(asset).safeTransfer(vault, received);
        returned = received;
    }

    /// @notice Total assets held in strategy
    /// @return Total USDC value in base-token units (positive supplier balance only)
    function totalAssets() external view override returns (uint256) {
        int256 balance = comet.balanceOf(address(this));
        return balance > 0 ? uint256(balance) : 0;
    }

    /// @notice Maximum amount that can be withdrawn in a single transaction
    /// @return Maximum withdrawable USDC (position capped by protocol cash)
    /// @dev Reads protocol cash directly as the Comet's base-token balance: the deployed Base
    ///      Comet (v1) has no `getCash()` accessor, and `baseToken().balanceOf(comet)` is
    ///      exactly what that accessor computes on newer versions.
    function maxWithdrawable() external view override returns (uint256) {
        int256 position = comet.balanceOf(address(this));
        if (position <= 0) return 0;

        uint256 protocolCash = IERC20(asset).balanceOf(address(comet));
        uint256 positionValue = uint256(position);

        return positionValue < protocolCash ? positionValue : protocolCash;
    }

    /// @notice List of reward tokens
    /// @return Array of reward token addresses
    function rewardTokens() external pure override returns (address[] memory) {
        // Compound V3 on Base distributes COMP; reward harvesting arrives in Phase 3.
        address[] memory empty = new address[](0);
        return empty;
    }

    /// @notice Claimable reward amount
    /// @param /*token*/ Token address to check rewards for
    /// @return Amount of claimable rewards
    function claimableReward(
        address /*token*/
    )
        external
        pure
        override
        returns (uint256)
    {
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
        return keccak256(abi.encode(address(comet), asset, comet.baseToken()));
    }

    /// @notice Update cached configuration (call after rate model changes)
    function updateConfigDigest() external {
        cachedConfigDigest = _computeConfigDigest();
        emit ConfigurationUpdated(cachedConfigDigest);
    }
}
