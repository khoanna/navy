// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IMorpho, IIrm, MarketParams, Market, Position} from "../interfaces/IMorpho.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MorphoAdapter — supplies the vault's USDC to a Morpho Blue market.
/// @dev The adapter is the `onBehalf` supplier. totalAssets converts supplyShares→assets using the
/// market totals; supplyRatePerYear = borrowRate * utilization * (1 - fee), annualized.
contract MorphoAdapter is IYieldAdapter {
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant WAD = 1e18;
    uint256 private constant VIRTUAL_ASSETS = 1;
    uint256 private constant VIRTUAL_SHARES = 1e6; // matches Morpho SharesMathLib

    address public immutable vault;
    IERC20 public immutable usdc;
    IMorpho public immutable morpho;
    bytes32 public immutable marketId;
    MarketParams public marketParams;

    error NotVault();
    error LoanTokenMismatch();
    error MarketIdMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _morpho, MarketParams memory _params, bytes32 _id) {
        vault = _vault;
        usdc = IERC20(_usdc);
        morpho = IMorpho(_morpho);
        marketParams = _params;
        marketId = _id;

        if (_params.loanToken != _usdc) revert LoanTokenMismatch();
        // Morpho derives a market's Id as keccak256 over the packed MarketParams (5 static 32-byte
        // fields = 160 bytes); abi.encode of the struct yields exactly those 160 bytes.
        if (keccak256(abi.encode(_params)) != _id) revert MarketIdMismatch();
    }

    function deposit(uint256 amount) external onlyVault {
        usdc.approve(address(morpho), amount);
        morpho.supply(marketParams, amount, 0, address(this), "");
    }

    function withdraw(uint256 amount, address to) external onlyVault {
        morpho.withdraw(marketParams, amount, 0, address(this), to);
    }

    function totalAssets() external view returns (uint256) {
        Market memory m = morpho.market(marketId);
        uint256 shares = morpho.position(marketId, address(this)).supplyShares;
        if (shares == 0) return 0;
        // toAssetsDown(shares, totalAssets, totalShares) with Morpho's virtual amounts.
        uint256 totalA = uint256(m.totalSupplyAssets) + VIRTUAL_ASSETS;
        uint256 totalS = uint256(m.totalSupplyShares) + VIRTUAL_SHARES;
        return (shares * totalA) / totalS;
    }

    function supplyRatePerYear() external view returns (uint256) {
        Market memory m = morpho.market(marketId);
        if (m.totalSupplyAssets == 0) return 0;
        uint256 borrowRate = IIrm(marketParams.irm).borrowRateView(marketParams, m); // per-second WAD
        uint256 utilization = (uint256(m.totalBorrowAssets) * WAD) / uint256(m.totalSupplyAssets);
        uint256 supplyRatePerSecond = (borrowRate * utilization / WAD) * (WAD - uint256(m.fee)) / WAD;
        return supplyRatePerSecond * SECONDS_PER_YEAR;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }
}
