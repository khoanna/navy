// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Moonwell mToken interface (Compound-like with 8 decimals)
interface IMToken {
    /// @notice Mints mTokens to the recipient
    function mint(uint256 mintAmount) external returns (uint256);

    /// @notice Redeems mTokens for underlying
    function redeem(uint256 redeemTokens) external returns (uint256);

    /// @notice Redeems underlying for mTokens
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    /// @notice Get cash balance (available underlying)
    function getCash() external view returns (uint256);

    /// @notice Current exchange rate (mToken -> underlying)
    function exchangeRateCurrent() external returns (uint256);

    /// @notice Exchange rate stored (view-safe)
    function exchangeRateStored() external view returns (uint256);

    /// @notice Total supply of mTokens
    function totalSupply() external view returns (uint256);

    /// @notice Balance of mTokens for an account
    function balanceOf(address account) external view returns (uint256);

    /// @notice Underlying asset address
    function underlying() external view returns (address);

    /// @notice Comptroller address
    function comptroller() external view returns (address);

    /// @notice Interest rate model
    function interestRateModel() external view returns (address);
    function totalBorrows() external view returns (uint256);
    function totalReserves() external view returns (uint256);
    function reserveFactorMantissa() external view returns (uint256);
    function accrualBlockTimestamp() external view returns (uint256);
    function borrowRatePerTimestamp() external view returns (uint256);
}

/// @dev Moonwell Comptroller interface
interface IMComptroller {
    function markets(address market) external view returns (bool isListed, uint256 collateralFactorMantissa);
    function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256);
    function enterMarkets(address[] memory markets) external returns (uint256[] memory);
    function exitMarket(address market) external returns (uint256);
    function claimReward(uint8 rewardType, address holder, address[] memory realms, bool verbose) external;
    function mintGuardianPaused(address market) external view returns (bool);
    function supplyCaps(address market) external view returns (uint256);
}

/// @dev Moonwell Interest Rate Model
interface IMInterestRateModel {
    function getSupplyRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa)
        external
        view
        returns (uint256);
    function getBorrowRate(uint256 cash, uint256 borrows, uint256 reserves, uint256 reserveFactorMantissa)
        external
        view
        returns (uint256);
}
