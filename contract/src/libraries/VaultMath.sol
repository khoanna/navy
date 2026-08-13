// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title VaultMath Library
/// @notice Library for share/asset conversions used by NavyVault
/// @dev SECURITY: Implements proper ERC4626 rounding:
///      - convertToShares: rounds DOWN (favors vault, prevents inflation attacks)
///      - convertToAssets: rounds UP (favors vault for withdrawals)
///      - Includes virtual offset to prevent first-depositor inflation attacks
library VaultMath {
    /// @notice Virtual assets offset to prevent first-depositor inflation attacks
    /// @dev Per OpenZeppelin ERC4626, this creates a minimum exchange rate on first deposit
    uint256 private constant VIRTUAL_ASSETS = 1;

    /// @notice Virtual shares offset to prevent first-depositor inflation attacks
    uint256 private constant VIRTUAL_SHARES = 1e6;

    /// @notice Convert assets to shares with proper rounding (round DOWN per ERC4626)
    /// @param assets The amount of assets to convert
    /// @param totalAssets The total assets in the vault
    /// @param totalShares The total shares outstanding
    /// @return shares The resulting share amount
    /// @dev SECURITY: Uses virtual offset to prevent first-depositor inflation attacks.
    ///      Rounds DOWN so users get fewer shares, protecting against share price manipulation.
    function convertToShares(uint256 assets, uint256 totalAssets, uint256 totalShares)
        internal
        pure
        returns (uint256 shares)
    {
        shares = Math.mulDiv(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS, Math.Rounding.Floor);
    }

    /// @notice Convert shares to assets with proper rounding (round UP per ERC4626)
    /// @param shares The amount of shares to convert
    /// @param totalAssets The total assets in the vault
    /// @param totalShares The total shares outstanding
    /// @return assets The resulting asset amount
    /// @dev SECURITY: Rounds UP so users get fewer assets on withdrawal (vault favorable).
    function convertToAssets(uint256 shares, uint256 totalAssets, uint256 totalShares)
        internal
        pure
        returns (uint256 assets)
    {
        return Math.mulDiv(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES, Math.Rounding.Ceil);
    }

    /// @notice Preview deposit, respecting max deposit limit
    /// @param assets The requested deposit amount
    /// @param maxDeposit The maximum allowed deposit
    /// @return The actual deposit amount (min of assets and maxDeposit)
    function previewDeposit(uint256 assets, uint256 maxDeposit) internal pure returns (uint256) {
        if (maxDeposit == 0) {
            return 0;
        }
        return assets < maxDeposit ? assets : maxDeposit;
    }
}
