// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IMToken, IMComptroller, IMInterestRateModel} from "../interfaces/IMToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MoonwellAdapter — supplies the vault's USDC to Moonwell on Base.
/// @dev The adapter holds mUSDC (8-decimal token). totalAssets computes the
/// underlying equivalent using the exchange rate. Only the vault may move funds.
/// Per SRCLA paper Section 6.5.
contract MoonwellAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

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
    error MintFailed();
    error RedeemFailed();
    error ProtocolPaused();
    error InvalidConfiguration();
    error SupplyCapExceeded();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _mUsdc, address _comptroller, address _interestRateModel) {
        if (
            _vault == address(0) || _usdc == address(0) || _mUsdc == address(0) || _comptroller == address(0)
                || _interestRateModel == address(0)
        ) revert InvalidConfiguration();
        if (_mUsdc.code.length != 0) {
            if (
                IMToken(_mUsdc).underlying() != _usdc || IMToken(_mUsdc).comptroller() != _comptroller
                    || IMToken(_mUsdc).interestRateModel() != _interestRateModel
            ) revert InvalidConfiguration();
        }
        vault = _vault;
        usdc = IERC20(_usdc);
        mUsdc = IMToken(_mUsdc);
        comptroller = IMComptroller(_comptroller);
        interestRateModel = IMInterestRateModel(_interestRateModel);
    }

    /// @notice Supply USDC to Moonwell by minting mUSDC
    /// @dev First transfers USDC to this adapter, then mints mTokens
    /// @dev Uses try/catch for protocol pause resilience
    function deposit(uint256 amount) external onlyVault returns (uint256 credited) {
        uint256 supplyCap = comptroller.supplyCaps(address(mUsdc));
        uint256 marketSupply = (mUsdc.totalSupply() * mUsdc.exchangeRateStored()) / MANTISSA;
        if (supplyCap != 0 && marketSupply + amount > supplyCap) revert SupplyCapExceeded();
        uint256 beforeAssets = _positionAssets();
        usdc.forceApprove(address(mUsdc), amount);
        try mUsdc.mint(amount) returns (uint256 code) {
            if (code != 0) revert MintFailed();
        } catch {
            revert MintFailed();
        }
        usdc.forceApprove(address(mUsdc), 0);
        credited = _positionAssets() - beforeAssets;
    }

    /// @notice Withdraw USDC from Moonwell by redeeming mUSDC
    /// @dev Redeems underlying USDC to `to`. Only callable by the vault.
    /// @dev Uses try/catch for protocol pause resilience
    function withdraw(uint256 amount) external onlyVault returns (uint256 returned) {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        try mUsdc.redeemUnderlying(amount) returns (uint256 code) {
            if (code != 0) revert RedeemFailed();
        } catch {
            revert RedeemFailed();
        }
        returned = usdc.balanceOf(address(this)) - beforeBalance;
        usdc.safeTransfer(vault, returned);
    }

    /// @notice Current value of Moonwell position in USDC terms
    /// @dev Uses exchangeRateStored to convert mToken balance to underlying
    function totalAssets() external view returns (uint256) {
        return _positionAssets();
    }

    function sync() external returns (uint256) {
        uint256 exchangeRate = mUsdc.exchangeRateCurrent();
        return (mUsdc.balanceOf(address(this)) * exchangeRate) / MANTISSA;
    }

    /// @notice Annualized supply rate (APY) as 1e18-scaled integer
    /// @dev Gets supply rate from interest rate model using current protocol state
    function supplyRatePerYear() external view returns (uint256) {
        if (mUsdc.interestRateModel() != address(interestRateModel)) revert InvalidConfiguration();
        uint256 cash = mUsdc.getCash();
        uint256 ratePerSecond = IMInterestRateModel(interestRateModel)
            .getSupplyRate(cash, mUsdc.totalBorrows(), mUsdc.totalReserves(), mUsdc.reserveFactorMantissa());
        // Rate returned is in 1e18 scale per second
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
        return comptroller.mintGuardianPaused(address(mUsdc));
    }

    /// @notice Maximum amount withdrawable in same transaction
    /// @dev Considers protocol liquidity to prevent over-reporting at high utilization
    function maxWithdrawable() external view returns (uint256) {
        uint256 mTokenBalance = mUsdc.balanceOf(address(this));
        uint256 exchangeRate = mUsdc.exchangeRateStored();
        uint256 underlyingBalance = (mTokenBalance * exchangeRate) / MANTISSA;

        // Check how much underlying is available in the protocol
        uint256 availableInProtocol = mUsdc.getCash();

        // Return minimum of our underlying balance and available liquidity
        return underlyingBalance < availableInProtocol ? underlyingBalance : availableInProtocol;
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev Implements IStrategyAdapter.configurationDigest()
    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(address(mUsdc), address(comptroller), address(usdc), block.chainid));
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @notice Claimable reward amount for a given token
    /// @dev Implements IStrategyAdapter.claimableReward(). Returns 0 until rewards are integrated.
    function claimableReward(address token) external pure returns (uint256) {
        if (token != WELL) revert UnsupportedRewardToken();
        // Moonwell rewards integration deferred for Phase 2
        return 0;
    }

    function _positionAssets() internal view returns (uint256) {
        return (mUsdc.balanceOf(address(this)) * mUsdc.exchangeRateStored()) / MANTISSA;
    }
}
