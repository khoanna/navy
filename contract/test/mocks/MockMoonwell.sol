// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock Moonwell mToken for testing
/// @dev Simulates Moonwell mToken with exchange rate mechanics like cTokens
contract MockMoonwell {
    using SafeERC20 for IERC20;

    /// @notice Address of the underlying asset (USDC)
    address public immutable underlying;

    /// @notice Total cash available for withdrawals
    uint256 public cash;

    /// @notice Total supply of mTokens
    uint256 public totalSupply;

    /// @notice Per-user mToken balance
    mapping(address => uint256) public balanceOf;

    /// @notice Exchange rate: mToken * exchangeRate / 1e18 = underlying
    uint256 public exchangeRate;

    /// @notice Return code for mint (0 = success, non-zero = error)
    uint256 public mintReturnCode;

    /// @notice Return code for redeemUnderlying (0 = success, non-zero = error)
    uint256 public redeemReturnCode;

    /// @notice Whether redeem is paused
    bool public redeemPaused;

    /// @notice Last accrual timestamp
    uint256 public lastAccrualTime;

    /// @notice Base interest rate per second
    uint256 public baseInterestRate;

    /// @notice Events
    event Minted(address indexed minter, uint256 assets, uint256 mTokens);
    event Redeemed(address indexed redeemer, uint256 assets, uint256 mTokens);
    event AccruedInterest(uint256 interestAccrued);
    event ExchangeRateUpdated(uint256 newRate);

    uint256 public constant INITIAL_EXCHANGE_RATE = 1e18; // 1:1 initially

    constructor(address underlying_) {
        underlying = underlying_;
        exchangeRate = INITIAL_EXCHANGE_RATE;
        lastAccrualTime = block.timestamp;
    }

    /// @notice Mint mTokens by depositing underlying
    /// @param minter Address receiving the mTokens
    /// @param assets Amount of underlying to deposit
    /// @return mTokensMinted Amount of mTokens minted
    /// @return code 0 = success, non-zero = error code
    function mint(address minter, uint256 assets)
        external
        returns (uint256 mTokensMinted, uint256 code)
    {
        // Transfer underlying from caller
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), assets);

        // Calculate mTokens to mint
        mTokensMinted = _underlyingToMToken(assets);

        // Update balance
        balanceOf[minter] += mTokensMinted;

        // Update total supply
        totalSupply += mTokensMinted;

        // Update cash
        cash += assets;

        // Check error code
        if (mintReturnCode != 0) {
            return (mTokensMinted, mintReturnCode);
        }

        emit Minted(minter, assets, mTokensMinted);
        return (mTokensMinted, 0);
    }

    /// @notice Redeem mTokens for underlying
    /// @param redeemer Address receiving the underlying
    /// @param assets Amount of underlying to redeem
    /// @return mTokensRedeemed Amount of mTokens burned
    /// @return code 0 = success, non-zero = error code
    function redeemUnderlying(address redeemer, uint256 assets)
        external
        returns (uint256 mTokensRedeemed, uint256 code)
    {
        if (redeemPaused) revert("Redeem is paused");

        // Calculate mTokens needed
        mTokensRedeemed = _underlyingToMToken(assets);

        // Check balance
        require(balanceOf[msg.sender] >= mTokensRedeemed, "Insufficient balance");

        // Check cash available
        require(cash >= assets, "Insufficient cash");

        // Update balance
        balanceOf[msg.sender] -= mTokensRedeemed;

        // Update total supply
        totalSupply -= mTokensRedeemed;

        // Update cash
        cash -= assets;

        // Check error code
        if (redeemReturnCode != 0) {
            return (mTokensRedeemed, redeemReturnCode);
        }

        // Transfer underlying
        IERC20(underlying).safeTransfer(redeemer, assets);

        emit Redeemed(redeemer, assets, mTokensRedeemed);
        return (mTokensRedeemed, 0);
    }

    /// @notice Get available cash for withdrawals
    /// @return Cash available
    function getCash() external view returns (uint256) {
        return cash;
    }

    /// @notice Get mToken balance for an account
    /// @param account The account to check
    /// @return mToken balance
    function getMTokenBalance(address account) external view returns (uint256) {
        return balanceOf[account];
    }

    /// @notice Convert underlying amount to mToken amount
    /// @param assets Amount of underlying
    /// @return mToken amount
    function _underlyingToMToken(uint256 assets) internal view returns (uint256) {
        if (exchangeRate == 0) return 0;
        return (assets * 1e18) / exchangeRate;
    }

    /// @notice Convert mToken amount to underlying amount
    /// @param mTokens Amount of mTokens
    /// @return Underlying amount
    function _mTokenToUnderlying(uint256 mTokens) internal view returns (uint256) {
        return (mTokens * exchangeRate) / 1e18;
    }

    /// @notice Set exchange rate for testing
    function setExchangeRate(uint256 rate_) external {
        require(rate_ > 0, "Exchange rate must be positive");
        exchangeRate = rate_;
        emit ExchangeRateUpdated(rate_);
    }

    /// @notice Set cash amount for testing
    function setCash(uint256 cash_) external {
        cash = cash_;
    }

    /// @notice Set mint return code for testing
    function setMintCode(uint256 code_) external {
        mintReturnCode = code_;
    }

    /// @notice Set redeem return code for testing
    function setRedeemCode(uint256 code_) external {
        redeemReturnCode = code_;
    }

    /// @notice Set redeem paused state
    function setRedeemPaused(bool paused_) external {
        redeemPaused = paused_;
    }

    /// @notice Set base interest rate for testing
    function setBaseInterestRate(uint256 rate_) external {
        baseInterestRate = rate_;
    }

    /// @notice Simulate interest accrual (increases exchange rate)
    /// @param deltaT Time elapsed in seconds
    function accrueInterest(uint256 deltaT) external {
        if (totalSupply == 0) return; // No deposits

        uint256 totalMTokens = totalSupply;
        uint256 underlyingValue = _mTokenToUnderlying(totalMTokens);

        // Calculate interest
        uint256 interest = (underlyingValue * baseInterestRate * deltaT) / 1e18;

        // Update cash (interest added)
        cash += interest;

        // Update exchange rate: newRate = oldRate * (underlying + interest) / underlying
        // Simplified: increase exchange rate proportionally
        uint256 newRate = exchangeRate + (exchangeRate * interest) / underlyingValue;
        exchangeRate = newRate;

        lastAccrualTime = block.timestamp;

        emit AccruedInterest(interest);
    }

    /// @notice Set mToken balance directly for testing
    function setBalance(address user, uint256 balance_) external {
        balanceOf[user] = balance_;
    }
}
