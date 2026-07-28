// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IMorphoView {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function market(bytes32 id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );
}

/// @dev Prints liquidity for a candidate Morpho market id so we can confirm a live Circle-USDC
/// market before wiring MorphoAdapter. Pass MORPHO_MARKET_ID + MORPHO_ADDRESS via env.
contract ResolveMorphoMarket is Script {
    function run() external view {
        address morpho = vm.envAddress("MORPHO_ADDRESS");
        bytes32 id = vm.envBytes32("MORPHO_MARKET_ID");
        (uint128 tsa,, uint128 tba,,, uint128 fee) = IMorphoView(morpho).market(id);
        console2.log("totalSupplyAssets:", tsa);
        console2.log("totalBorrowAssets:", tba);
        console2.log("fee:", fee);
    }
}
