// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Aave V3 Pool interface for USDC supply operations
interface IAaveV3Pool {
    /// @notice Supply underlying asset to the pool
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    /// @notice Withdraw underlying asset from the pool
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    /// @notice Get the reserve data for an asset
    function getReserveData(address asset) external view returns (ReserveData memory);

    /// @notice Current reserve income index, including accrued interest.
    function getReserveNormalizedIncome(address asset) external view returns (uint256);

    struct ReserveData {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate;
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }

    struct ReserveConfigurationMap {
        uint256 data;
    }
}

/// @dev Aave V3 aToken (interest-bearing token)
interface IAaveV3AToken {
    function balanceOf(address account) external view returns (uint256);
    function scaledBalanceOf(address user) external view returns (uint256);
    function getScaledUserBalanceAndSupply(address user) external view returns (uint256, uint256);
    function totalSupply() external view returns (uint256);
    function scaledTotalSupply() external view returns (uint256);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}
