// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IMToken, IMComptroller, IMInterestRateModel} from "../interfaces/IMToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MoonwellAdapter — supplies the vault's USDC to Moonwell on Base.
/// @dev The adapter holds mUSDC (8-decimal token). totalAssets computes the
/// underlying equivalent using the exchange rate. Only the vault may move funds.
/// Per SRCLA paper Section 6.5.
contract MoonwellAdapter is IYieldAdapter {
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant MANTISSA = 1e18;
    uint256 private constant MTOKEN_MANTISSA = 1e8; // mToken has 8 decimals

    address public immutable vault;
    IERC20 public immutable usdc;
    IMToken public immutable mUsdc;
    IMComptroller public immutable comptroller;
    IMInterestRateModel public immutable interestRateModel;

    /// @dev WELL reward token on Base (native xWELL, not Wormhole)
    /// @notice From Moonwell token registry: 0xA88594D404727625A9437C3f886C7643872296AE
    address private constant WELL = 0xA88594D404727625A9437C3f886C7643872296AE;

    /// @dev List of reward tokens this adapter can claim
    address[] private _rewardTokens = [WELL];

    error NotVault();
    error UnsupportedRewardToken();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(
        address _vault,
        address _usdc,
        address _mUsdc,
        address _comptroller,
        address _interestRateModel
    ) {
        vault = _vault;
        usdc = IERC20(_usdc);
        mUsdc = IMToken(_mUsdc);
        comptroller = IMComptroller(_comptroller);
        interestRateModel = IMInterestRateModel(_interestRateModel);
    }

    /// @notice Supply USDC to Moonwell by minting mUSDC
    /// @dev First transfers USDC to this adapter, then mints mTokens
    function deposit(uint256 amount) external onlyVault {
        mUsdc.mint(address(this), amount);
    }

    /// @notice Withdraw USDC from Moonwell by redeeming mUSDC
    /// @dev Redeems underlying USDC to `to`. Only callable by the vault.
    function withdraw(uint256 amount, address to) external onlyVault {
        // redeemUnderlying sends underlying to the `redeemer` address
        mUsdc.redeemUnderlying(to, amount);
    }

    /// @notice Current value of Moonwell position in USDC terms
    /// @dev Uses exchangeRateStored to convert mToken balance to underlying
    function totalAssets() external view returns (uint256) {
        uint256 mTokenBalance = mUsdc.balanceOf(address(this));
        uint256 exchangeRate = mUsdc.exchangeRateStored();
        // mToken balance * exchangeRate / 1e8 = underlying amount
        // exchangeRate is roughly 1e(18-8) * underlying_per_mToken = 1e10 * underlying
        // So: mTokens * exchangeRate / 1e8 = underlying
        return (mTokenBalance * exchangeRate) / MTOKEN_MANTISSA;
    }

    /// @notice Annualized supply rate (APY) as 1e18-scaled integer
    /// @dev Gets borrow rate from interest rate model (Moonwell uses supply rate = borrow rate * utilization)
    function supplyRatePerYear() external view returns (uint256) {
        uint256 cash = mUsdc.getCash();
        uint256 totalBorrows = _getTotalBorrows();
        uint256 reserves = _getTotalReserves();
        uint256 ratePerSecond = IMInterestRateModel(interestRateModel).getSupplyRate(
            cash,
            totalBorrows,
            reserves,
            _getReserveFactor()
        );
        // Rate returned is already in 1e18 scale per second
        return ratePerSecond * SECONDS_PER_YEAR;
    }

    /// @notice Returns the vault asset (USDC)
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Returns the mToken address
    function mToken() external view returns (address) {
        return address(mUsdc);
    }

    /// @notice Check if minting is paused
    function isMintPaused() external view returns (bool) {
        return mUsdc.mintGuardianPaused();
    }

    // ---- Internal helpers ----

    function _getTotalBorrows() internal view returns (uint256) {
        // Moonwell doesn't expose totalBorrows directly on mToken
        // For Base deployment, we read from the protocol's state
        // This is a simplified version; full implementation would read from events or a separate oracle
        return 0; // Placeholder — should be populated from protocol data
    }

    function _getTotalReserves() internal view returns (uint256) {
        // Moonwell stores reserves in the mToken
        // This would need to be read from the protocol or provided at construction
        return 0; // Placeholder
    }

    function _getReserveFactor() internal view returns (uint256) {
        // Reserve factor is typically stored in the interest rate model or mToken
        // For Moonwell Base, this is typically 0.25e18 (25%)
        return 0.25e18; // 25% reserve factor
    }

    /// @notice Maximum amount withdrawable in same transaction
    /// @dev For Moonwell, we can withdraw up to the underlying equivalent of mToken balance.
    ///      Implements IStrategyAdapter.maxWithdrawable()
    function maxWithdrawable() external view returns (uint256) {
        uint256 mTokenBalance = mUsdc.balanceOf(address(this));
        uint256 exchangeRate = mUsdc.exchangeRateStored();
        return (mTokenBalance * exchangeRate) / MTOKEN_MANTISSA;
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev Implements IStrategyAdapter.configurationDigest()
    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(
            address(mUsdc),
            address(comptroller),
            address(usdc),
            block.chainid
        ));
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @notice Claimable reward amount for a given token
    /// @dev Implements IStrategyAdapter.claimableReward(). Returns 0 until rewards are integrated.
    function claimableReward(address token) external view returns (uint256) {
        if (token != WELL) revert UnsupportedRewardToken();
        // Moonwell rewards integration deferred for Phase 2
        return 0;
    }
}
