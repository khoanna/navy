// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev A yield venue behind the vault. The adapter is the on-chain position holder
/// (it is `msg.sender` to the underlying protocol). The vault sends USDC to the adapter
/// before calling `deposit`, and `withdraw` returns USDC to `to`. All state-changing
/// methods are `onlyVault`.
interface IYieldAdapter {
    /// @dev Supply `amount` of the vault asset already transferred to this adapter.
    function deposit(uint256 amount) external;

    /// @dev Redeem `amount` of the vault asset from the venue and send it to `to`.
    function withdraw(uint256 amount, address to) external;

    /// @dev Current value of this adapter's position, denominated in the vault asset.
    function totalAssets() external view returns (uint256);

    /// @dev Annualized supply rate, 1e18-scaled (e.g. 5% APR == 5e16). Simple APR, not compounded.
    function supplyRatePerYear() external view returns (uint256);

    /// @dev The vault asset (Circle USDC).
    function asset() external view returns (address);
}
