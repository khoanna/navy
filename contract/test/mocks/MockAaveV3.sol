// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock Aave V3 Pool and aToken for testing
/// @dev Simulates Aave V3 Pool behavior with indexed balance tracking
contract MockAaveV3 {
    using SafeERC20 for IERC20;

    /// @notice Address of the underlying asset (USDC)
    address public immutable underlying;

    /// @notice Address of the aToken
    address public immutable aToken;

    /// @notice Total cash available in the pool
    uint256 public cash;

    /// @notice Current liquidity index (ray, 1e27)
    uint256 public currentLiquidityIndex;

    /// @notice Rate strategy parameters
    uint256 public rateSpread; // additional rate above base
    uint256 public baseRate; // base rate per second

    /// @notice Indexed balance per user (scaled balance)
    mapping(address => uint256) public scaledBalance;

    /// @notice Total supply of aTokens
    uint256 public totalSupply;

    /// @notice Aave incentives controller address
    address public incentivesController;

    /// @notice Reserve configuration
    uint256 public reserveFactor = 1000; // 10% by default

    /// @notice Event for supply
    event Supplied(address indexed user, uint256 amount, uint256 scaledAmount);

    /// @notice Event for withdraw
    event Withdrawn(address indexed user, uint256 amount, uint256 scaledAmount);

    constructor(address underlying_) {
        underlying = underlying_;
        currentLiquidityIndex = 1e27; // Initial index at 1 ray
        rateSpread = 3000000000000000; // ~3% annual rate in ray
        baseRate = 0;

        // Create mock aToken
        aToken = address(new MockAToken(address(this), underlying_));
    }

    /// @notice Supply assets to Aave
    /// @param amount The amount to supply
    /// @param onBehalfOf The user to supply for
    function supply(address, uint256 amount, address onBehalfOf, uint16) external {
        // Transfer USDC from caller to this pool
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);

        // Calculate scaled amount
        uint256 scaledAmount = _toScaledAmount(amount);

        // Update scaled balance for onBehalfOf
        scaledBalance[onBehalfOf] += scaledAmount;
        totalSupply += scaledAmount;

        // Update cash
        cash += amount;

        // Mint aTokens to onBehalfOf
        MockAToken(aToken).mint(onBehalfOf, amount);

        emit Supplied(onBehalfOf, amount, scaledAmount);
    }

    /// @notice Withdraw assets from Aave
    /// @param amount The amount to withdraw
    /// @param to The recipient address
    /// @return actualAmount The actual amount withdrawn
    function withdraw(address, uint256 amount, address to) external returns (uint256 actualAmount) {
        // Get current scaled balance of caller (who should have aTokens)
        uint256 callerScaledBalance = scaledBalance[msg.sender];

        // Calculate the scaled amount needed for the withdrawal
        uint256 scaledNeeded = _toScaledAmount(amount);

        // Cap at caller's balance
        if (scaledNeeded > callerScaledBalance) {
            scaledNeeded = callerScaledBalance;
        }

        // Calculate actual amount based on index
        actualAmount = _fromScaledAmount(scaledNeeded);

        // Ensure we don't withdraw more than cash
        if (actualAmount > cash) {
            actualAmount = cash;
            scaledNeeded = _toScaledAmount(actualAmount);
        }

        // Update scaled balance
        scaledBalance[msg.sender] -= scaledNeeded;
        totalSupply -= scaledNeeded;

        // Update cash
        cash -= actualAmount;

        // Transfer USDC to recipient
        IERC20(underlying).safeTransfer(to, actualAmount);

        emit Withdrawn(to, actualAmount, scaledNeeded);
    }

    /// @notice Get aToken balance for a user
    /// @param user The user address
    /// @return The balance in underlying units
    function balanceOf(address user) external view returns (uint256) {
        return _fromScaledAmount(scaledBalance[user]);
    }

    /// @notice Get current liquidity index
    /// @return The current liquidity index
    function getReserveNormalizedIncome(address) external view returns (uint256) {
        return currentLiquidityIndex;
    }

    /// @notice Simulate interest accrual
    /// @param deltaT Time elapsed in seconds
    function accrueInterest(uint256 deltaT) external {
        // Simple interest accrual simulation
        uint256 totalScaled = totalSupply;
        if (totalScaled == 0) return;

        // Calculate interest based on current rate
        uint256 ratePerSecond = baseRate + rateSpread / 365 days;
        uint256 interest = (totalScaled * ratePerSecond * deltaT) / 1e27;

        // Update index: newIndex = oldIndex * (1 + interestRate * deltaT)
        uint256 indexIncrease = (currentLiquidityIndex * ratePerSecond * deltaT) / 1e27;
        currentLiquidityIndex += indexIncrease;

        // Increase total supply (as aTokens accrue value)
        totalSupply += interest;
    }

    /// @notice Set liquidity index for testing
    function setLiquidityIndex(uint256 index_) external {
        currentLiquidityIndex = index_;
    }

    /// @notice Set cash amount for testing
    function setCash(uint256 cash_) external {
        cash = cash_;
    }

    /// @notice Set rate strategy parameters
    function setRateStrategy(uint256 baseRate_, uint256 rateSpread_) external {
        baseRate = baseRate_;
        rateSpread = rateSpread_;
    }

    /// @notice Set indexed balance directly for testing
    function setIndexedBalance(address user, uint256 scaledBalance_) external {
        uint256 oldScaledBalance = scaledBalance[user];
        scaledBalance[user] = scaledBalance_;

        // Update total supply
        if (scaledBalance_ > oldScaledBalance) {
            totalSupply += (scaledBalance_ - oldScaledBalance);
        } else {
            totalSupply -= (oldScaledBalance - scaledBalance_);
        }
    }

    /// @notice Set incentives controller
    function setIncentivesController(address controller_) external {
        incentivesController = controller_;
    }

    /// @notice Convert amount to scaled amount using current index
    function _toScaledAmount(uint256 amount) internal view returns (uint256) {
        return (amount * 1e27) / currentLiquidityIndex;
    }

    /// @notice Convert scaled amount to actual amount using current index
    function _fromScaledAmount(uint256 scaledAmount) internal view returns (uint256) {
        return (scaledAmount * currentLiquidityIndex) / 1e27;
    }

    /// @notice Get configuration digest for testing
    function getConfigurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(reserveFactor, baseRate, rateSpread, currentLiquidityIndex));
    }
}

/// @notice Mock aToken that wraps the underlying asset
contract MockAToken {
    using SafeERC20 for IERC20;

    address public immutable pool;
    address public immutable underlying;

    mapping(address => uint256) public balanceOf;

    constructor(address pool_, address underlying_) {
        pool = pool_;
        underlying = underlying_;
    }

    /// @notice Mint aTokens (called by pool on supply)
    function mint(address user, uint256 amount) external {
        require(msg.sender == pool, "MockAToken: caller not pool");
        // No underlying transfer needed - pool already has it
        balanceOf[user] += amount;
    }

    /// @notice Burn aTokens (called by pool on withdraw)
    function burn(address user, uint256 amount) external {
        require(msg.sender == pool, "MockAToken: caller not pool");
        require(balanceOf[user] >= amount, "burn exceeds balance");
        balanceOf[user] -= amount;
    }

    function scaledBalanceOf(address user) external view returns (uint256) {
        return MockAaveV3(pool).scaledBalance(user);
    }

    function getReserveNormalizedIncome() external view returns (uint256) {
        return MockAaveV3(pool).getReserveNormalizedIncome(address(0));
    }
}
