// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IAaveV3Pool, IAaveV3AToken} from "../interfaces/IAaveV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title AaveV3Adapter — supplies the vault's USDC to Aave V3 on Base.
/// @dev The adapter is msg.sender to Aave Pool, so Aave credits this contract.
/// totalAssets reads the aUSDC balance (indexed value). Only the vault may move funds.
/// Per SRCLA paper Section 6.3.
contract AaveV3Adapter is IYieldAdapter {
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant RAY = 1e27; // Aave ray unit for rate calculations

    address public immutable vault;
    IERC20 public immutable usdc;
    IAaveV3Pool public immutable pool;
    IAaveV3AToken public immutable aUsdc;

    error NotVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _pool, address _aUsdc) {
        vault = _vault;
        usdc = IERC20(_usdc);
        pool = IAaveV3Pool(_pool);
        aUsdc = IAaveV3AToken(_aUsdc);
    }

    /// @notice Supply USDC to Aave V3 Pool
    /// @dev Approves pool to pull USDC, then calls supply
    function deposit(uint256 amount) external onlyVault {
        usdc.approve(address(pool), amount);
        pool.supply(address(usdc), amount, address(this), 0);
    }

    /// @notice Withdraw USDC from Aave V3 Pool
    /// @dev Calls withdraw on the pool, sends to vault
    function withdraw(uint256 amount, address to) external onlyVault {
        pool.withdraw(address(usdc), amount, to);
    }

    /// @notice Current value of Aave position in USDC terms
    /// @dev Uses aToken balance which is already indexed to include accrued interest
    function totalAssets() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    /// @notice Annualized supply rate (APY) as 1e18-scaled integer
    /// @dev Reads current liquidity rate from pool reserve data.
    ///      currentLiquidityRate is in RAY (1e27) as a per-second rate.
    ///      To convert to annual APY in 1e18 scale: (rate_per_sec * 365 days) / RAY
    function supplyRatePerYear() external view returns (uint256) {
        IAaveV3Pool.ReserveData memory reserveData = pool.getReserveData(address(usdc));
        // currentLiquidityRate in RAY (1e27) — per second
        // Convert: (RAY_rate * 1 year) / RAY = dimensionless * 1e18
        // So: (liquidityRate * 365 days) / 1e27
        return (uint256(reserveData.currentLiquidityRate) * SECONDS_PER_YEAR) / RAY;
    }

    /// @notice Returns the vault asset (USDC)
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Returns the aToken address
    function aToken() external view returns (address) {
        return address(aUsdc);
    }

    /// @notice Returns the Aave Pool address
    function aavePool() external view returns (address) {
        return address(pool);
    }
}
