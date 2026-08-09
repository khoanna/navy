// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock Compound V3 Comet for testing
/// @dev Simulates Compound III Comet with int256 balances (can be negative for borrowing)
contract MockComet {
    using SafeERC20 for IERC20;

    /// @notice Address of the underlying asset (USDC)
    address public immutable underlying;

    /// @notice Address of the cToken (cUSDCv3)
    address public immutable cToken;

    /// @notice Total cash available for withdrawals (positive = available)
    int256 public cash;

    /// @notice Per-user balance (int256, negative if borrowed)
    mapping(address => int256) public balanceOf;

    /// @notice Total supply of cTokens
    uint256 public totalSupply;

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
    event AccruedInterest(uint256 interestAccrued);

    constructor(address underlying_) {
        underlying = underlying_;
        lastAccrualTime = block.timestamp;

        // Create mock cToken
        cToken = address(new MockCToken(address(this), underlying_));
    }

    /// @notice Supply USDC to Compound
    /// @param from Address supplying the USDC
    /// @param amount Amount of USDC to supply
    /// @param destination Address receiving the cTokens
    function supply(address from, uint256 amount, address destination) external {
        // Transfer USDC from caller to this comet
        IERC20(underlying).safeTransferFrom(from, address(this), amount);

        // Update balances
        balanceOf[address(this)] += int256(amount); // Comet holds the asset
        balanceOf[destination] += int256(amount);   // User gets the cToken balance

        // Update total supply
        totalSupply += amount;

        // Update cash (positive = available for withdrawal)
        cash += int256(amount);

        // Mint cTokens to destination
        MockCToken(cToken).mint(destination, amount);

        emit Supplied(from, destination, amount);
    }

    /// @notice Withdraw USDC from Compound
    /// @param src Address to withdraw from
    /// @param amount Amount of USDC to withdraw
    /// @param destination Address receiving the USDC
    function withdrawTo(address src, uint256 amount, address destination) external {
        require(!withdrawPaused, "Withdraw is paused");

        int256 srcBalance = balanceOf[src];
        require(srcBalance >= int256(amount), "Insufficient balance");

        // Update balances
        balanceOf[src] = srcBalance - int256(amount);
        balanceOf[address(this)] -= int256(amount);

        // Update cash
        cash -= int256(amount);

        // Transfer USDC to destination
        IERC20(underlying).safeTransfer(destination, amount);

        emit Withdrawn(src, destination, amount);
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
        return totalSupply;
    }

    /// @notice Get available cash for withdrawals
    /// @return Cash available (uint256 version)
    function getCash() external view returns (uint256) {
        return cash > 0 ? uint256(cash) : 0;
    }

    /// @notice Simulate interest accrual
    /// @param deltaT Time elapsed in seconds
    function accrueInterest(uint256 deltaT) external {
        if (totalSupply == 0) return;

        // Calculate simple interest
        uint256 interest = (totalSupply * baseInterestRate * deltaT) / 1e18;

        // Increase total supply (cTokens accrue value)
        totalSupply += interest;

        // Increase comet's balance (represents reserves)
        cash += int256(interest);

        lastAccrualTime = block.timestamp;

        emit AccruedInterest(interest);
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

        // Update total supply if needed
        if (oldBalance > 0) {
            if (balance_ > oldBalance) {
                totalSupply += uint256(balance_ - oldBalance);
            } else {
                totalSupply -= uint256(oldBalance - balance_);
            }
        } else if (balance_ > 0) {
            totalSupply += uint256(balance_);
        }
    }

    /// @notice Accrue COMP-like rewards for an account
    function accrueRewards(address account, uint256 amount) external {
        accruedRewards += amount;
    }
}

/// @notice Mock cToken (cUSDCv3) for testing
contract MockCToken {
    using SafeERC20 for IERC20;

    address public immutable comet;
    address public immutable underlying;

    mapping(address => uint256) public balanceOf;

    constructor(address comet_, address underlying_) {
        comet = comet_;
        underlying = underlying_;
    }

    /// @notice Mint cTokens
    function mint(address user, uint256 amount) external {
        require(msg.sender == comet, "MockCToken: caller not comet");
        balanceOf[user] += amount;
    }

    /// @notice Burn cTokens
    function burn(address user, uint256 amount) external {
        require(msg.sender == comet, "MockCToken: caller not comet");
        require(balanceOf[user] >= amount, "burn exceeds balance");
        balanceOf[user] -= amount;
    }
}
