// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title VaultMath Library
/// @notice Library for share/asset conversions used by NavyVault
library VaultMath {
    /// @notice Thrown when denominator is zero in mulDiv
    error DivisionByZero();

    /// @notice Convert assets to shares with optional rounding up
    /// @param assets The amount of assets to convert
    /// @param totalAssets The total assets in the vault
    /// @param totalShares The total shares outstanding
    /// @param roundUp Whether to round up on division
    /// @return shares The resulting share amount
    function convertToShares(
        uint256 assets,
        uint256 totalAssets,
        uint256 totalShares,
        bool roundUp
    ) internal pure returns (uint256 shares) {
        if (totalAssets == 0) {
            return assets;
        }
        shares = mulDiv(assets, totalShares, totalAssets);
        if (roundUp && mulDiv(shares, totalAssets, totalShares) < assets) {
            shares += 1;
        }
    }

    /// @notice Convert shares to assets (always rounds down)
    /// @param shares The amount of shares to convert
    /// @param totalAssets The total assets in the vault
    /// @param totalShares The total shares outstanding
    /// @return assets The resulting asset amount
    function convertToAssets(
        uint256 shares,
        uint256 totalAssets,
        uint256 totalShares
    ) internal pure returns (uint256 assets) {
        if (totalShares == 0) {
            return shares;
        }
        assets = mulDiv(shares, totalAssets, totalShares);
    }

    /// @notice Safe multiplication with division
    /// @dev Reverts on division by zero
    /// @param a The first operand
    /// @param b The second operand
    /// @param denominator The divisor
    /// @return result The result of (a * b) / denominator
    function mulDiv(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        if (denominator == 0) {
            revert DivisionByZero();
        }

        assembly {
            let prod1 := 0
            let prod2 := 0

            // Check for overflow: if either factor is non-zero and product would overflow
            if iszero(iszero(mul(a, b))) {
                prod1 := mul(a, b)
                prod2 := div(prod1, denominator)
            }

            // If prod1 != 0 && prod1 * b / denominator overflowed, revert
            if iszero(iszero(prod1)) {
                if iszero(eq(div(prod1, a), b)) {
                    revert(0, 0)
                }
            }

            result := prod2
        }
    }

    /// @notice Preview deposit, respecting max deposit limit
    /// @param assets The requested deposit amount
    /// @param maxDeposit The maximum allowed deposit
    /// @return The actual deposit amount (min of assets and maxDeposit)
    function previewDeposit(
        uint256 assets,
        uint256 maxDeposit
    ) internal pure returns (uint256) {
        if (maxDeposit == 0) {
            return 0;
        }
        return assets < maxDeposit ? assets : maxDeposit;
    }
}
