// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock Compound III Comet for testing
/// @dev Mirrors the deployed Comet ABI: positions are tracked in base-token units (no cToken),
///      `supply` pulls from msg.sender, `withdrawTo` sends to `to`.
contract MockComet {
    using SafeERC20 for IERC20;

    /// @notice Address of the underlying asset (USDC)
    address public immutable underlying;

    /// @notice Per-user principal balance (int256, negative if borrowed)
    mapping(address => int256) public balanceOf;

    /// @notice Total cash available for withdrawals (positive = available)
    int256 public cash;

    /// @notice Total supplied principal
    uint256 public totalPrincipal;

    /// @notice Whether withdraw is paused
    bool public withdrawPaused;

    /// @notice Base interest rate per second
    uint256 public baseInterestRate;

    /// @notice Last accrual timestamp
    uint256 public lastAccrualTime;

    /// @notice Accrued comp rewards (simplified)
    uint256 public accruedRewards;

    /// @notice Events
    event Supplied(address indexed from, address indexed to, uint256 amount);
    event Withdrawn(address indexed from, address indexed to, uint256 amount);

    constructor(address underlying_) {
        underlying = underlying_;
        lastAccrualTime = block.timestamp;
    }

    /// @notice Supply USDC to Compound (pulls from msg.sender)
    /// @param asset The asset to supply (must be the base token)
    /// @param amount Amount of USDC to supply
    function supply(address asset, uint256 amount) external {
        require(asset == underlying, "!base");

        // Transfer USDC from caller to this comet
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);

        // Update balances
        balanceOf[msg.sender] += int256(amount);
        totalPrincipal += amount;

        // Update cash (positive = available for withdrawal)
        cash += int256(amount);

        emit Supplied(msg.sender, msg.sender, amount);
    }

    /// @notice Withdraw USDC from Compound
    /// @param to Address receiving the USDC
    /// @param asset The asset to withdraw (must be the base token)
    /// @param amount Amount of USDC to withdraw
    function withdrawTo(address to, address asset, uint256 amount) external {
        require(asset == underlying, "!base");
        require(!withdrawPaused, "Withdraw is paused");

        int256 srcBalance = balanceOf[msg.sender];
        require(srcBalance >= int256(amount), "Insufficient balance");
        require(cash >= int256(amount), "Insufficient cash");

        // Update balances
        balanceOf[msg.sender] = srcBalance - int256(amount);
        totalPrincipal -= amount;

        // Update cash
        cash -= int256(amount);

        // Transfer USDC to destination
        IERC20(underlying).safeTransfer(to, amount);

        emit Withdrawn(msg.sender, to, amount);
    }

    /// @notice Get the present value of a position (assets - liabilities)
    /// @param account The account to check
    /// @return The present value
    function balanceOfUnderlying(address account) external view returns (uint256) {
        int256 bal = balanceOf[account];
        return bal > 0 ? uint256(bal) : 0;
    }

    /// @notice Get total supply of underlying assets
    /// @return Total USDC held by the comet
    function totalSupplyUnderlying() external view returns (uint256) {
        return totalPrincipal;
    }

    /// @notice Get available cash for withdrawals
    /// @return Cash available (uint256 version)
    function getCash() external view returns (uint256) {
        return cash > 0 ? uint256(cash) : 0;
    }

    /// @notice Base token of the market
    function baseToken() external view returns (address) {
        return underlying;
    }

    /// @notice Whether withdrawals are paused
    function isWithdrawPaused() external view returns (bool) {
        return withdrawPaused;
    }

    /// @notice Utilization placeholder (mock)
    function getUtilization() external pure returns (uint256) {
        return 0;
    }

    /// @notice Supply rate placeholder (mock)
    function getSupplyRate(uint256) external pure returns (uint64) {
        return 0;
    }

    /// @notice Simulate interest accrual
    /// @param deltaT Time elapsed in seconds
    function accrueInterest(uint256 deltaT) external {
        if (totalPrincipal == 0) return;

        // Calculate simple interest on the supplied principal
        uint256 interest = (totalPrincipal * baseInterestRate * deltaT) / 1e18;

        // Interest becomes available cash (mimics suppliers' interest accrual)
        cash += int256(interest);

        lastAccrualTime = block.timestamp;
    }

    /// @notice Set cash amount for testing
    function setCash(int256 cash_) external {
        cash = cash_;
    }

    /// @notice Set withdraw paused state
    function setWithdrawPaused(bool paused_) external {
        withdrawPaused = paused_;
    }

    /// @notice Set base interest rate
    function setBaseInterestRate(uint256 rate_) external {
        baseInterestRate = rate_;
    }

    /// @notice Set user balance directly for testing
    function setBalance(address user, int256 balance_) external {
        int256 oldBalance = balanceOf[user];
        balanceOf[user] = balance_;

        // Update total principal if needed
        if (oldBalance > 0) {
            if (balance_ > oldBalance) {
                totalPrincipal += uint256(balance_ - oldBalance);
            } else {
                totalPrincipal -= uint256(oldBalance - balance_);
            }
        } else if (balance_ > 0) {
            totalPrincipal += uint256(balance_);
        }
    }

    /// @notice Accrue COMP-like rewards for an account
    function accrueRewards(address account, uint256 amount) external {
        accruedRewards += amount;
    }
}
