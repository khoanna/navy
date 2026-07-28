// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

struct Market {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

struct Position {
    uint256 supplyShares;
    uint128 borrowShares;
    uint128 collateral;
}

interface IMorpho {
    function supply(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256 assetsSupplied, uint256 sharesSupplied);
    function withdraw(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);
    function market(bytes32 id) external view returns (Market memory);
    function position(bytes32 id, address user) external view returns (Position memory);
}

interface IIrm {
    function borrowRateView(MarketParams memory p, Market memory m) external view returns (uint256);
}
