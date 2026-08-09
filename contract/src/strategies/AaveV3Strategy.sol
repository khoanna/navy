// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @notice Interface for Aave V3 Pool
interface IAaveV3Pool {
    /// @notice Supply assets to the pool
    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external;

    /// @notice Withdraw assets from the pool
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    /// @notice Get reserve normalized income
    function getReserveNormalizedIncome(address asset) external view returns (uint256);
}

/// @notice Interface for aToken
interface IAToken {
    /// @notice Get scaled balance
    function scaledBalanceOf(address user) external view returns (uint256);

    /// @notice Get reserve normalized income
    function getReserveNormalizedIncome() external view returns (uint256);

    /// @notice Balance of underlying asset
    function balanceOf(address user) external view returns (uint256);
}

/// @title AaveV3Strategy
/// @notice Strategy adapter for Aave V3 protocol
/// @dev Deposits USDC to Aave V3 Pool, tracks position via aUSDC balance with accrued interest
contract AaveV3Strategy is IStrategyAdapter {
    using SafeERC20 for IERC20;

    /// @notice Precision for index conversion
    uint256 public constant INDEX_PRECISION = 1e27;

    /// @notice Address of the vault
    address public immutable override vault;

    /// @notice Address of the underlying asset (USDC)
    address public immutable override asset;

    /// @notice Address of the Aave V3 Pool
    IAaveV3Pool public immutable pool;

    /// @notice Address of the aToken
    IAToken public immutable aToken;

    /// @notice Address of the Aave incentives controller
    address public immutable incentivesController;

    /// @notice Cached configuration digest
    bytes32 public cachedConfigDigest;

    /// @notice Cached liquidity index
    uint256 public cachedLiquidityIndex;

    /// @notice Custom errors
    error OnlyVault();
    error AssetMismatch();
    error WithdrawExceedsBalance();
    error ZeroAddress();

    /// @notice Event when configuration changes
    event ConfigurationUpdated(bytes32 indexed digest, uint256 indexed liquidityIndex);

    /// @param vault_ Address of the vault
    /// @param asset_ Address of the underlying asset (USDC)
    /// @param pool_ Address of the Aave V3 Pool
    /// @param aToken_ Address of the aToken
    /// @param incentivesController_ Address of the Aave incentives controller
    constructor(
        address vault_,
        address asset_,
        address pool_,
        address aToken_,
        address incentivesController_
    ) {
        if (vault_ == address(0)) revert ZeroAddress();
        if (asset_ == address(0)) revert ZeroAddress();
        if (pool_ == address(0)) revert ZeroAddress();
        if (aToken_ == address(0)) revert ZeroAddress();

        vault = vault_;
        asset = asset_;
        pool = IAaveV3Pool(pool_);
        aToken = IAToken(aToken_);
        incentivesController = incentivesController_;

        // Initialize cache
        cachedLiquidityIndex = 1e27; // Initial index
        cachedConfigDigest = _computeConfigDigest();
    }

    /// @notice Deposit assets into Aave V3
    /// @dev Vault sends USDC before calling this function
    /// @param assets Amount of USDC to deposit
    /// @return credited Amount of position credited (after slippage/protocol fees)
    function deposit(uint256 assets) external override returns (uint256 credited) {
        if (msg.sender != vault) revert OnlyVault();
        if (assets == 0) return 0;

        // USDC already transferred by vault via safeTransfer
        // Approve pool to spend USDC (skip if already approved or for mock testing)
        _approveIfNeeded(IERC20(asset), address(pool), assets);

        // Supply to Aave
        uint256 assetsBeforeSupply = IERC20(asset).balanceOf(address(this));
        pool.supply(asset, assets, address(this), 0);
        uint256 assetsAfterSupply = IERC20(asset).balanceOf(address(this));

        // Calculate actual amount supplied (may be less due to dust/rounding)
        credited = assetsBeforeSupply - assetsAfterSupply;
        if (credited > assets) {
            credited = assets;
        }
    }

    /// @dev Helper to approve token spending
    function _approveIfNeeded(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) < amount) {
            SafeERC20.forceApprove(token, spender, amount);
        }
    }

    /// @notice Withdraw assets from Aave V3
    /// @param assets Amount of USDC to withdraw
    /// @return returned Amount of USDC returned to vault
    function withdraw(uint256 assets) external override returns (uint256 returned) {
        if (msg.sender != vault) revert OnlyVault();
        if (assets == 0) return 0;

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));

        // Withdraw from Aave
        returned = pool.withdraw(asset, assets, address(this));

        // Transfer to vault
        uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;

        IERC20(asset).safeTransfer(vault, received);
    }

    /// @notice Total assets held in strategy
    /// @return Total USDC value including accrued interest
    function totalAssets() external view override returns (uint256) {
        // aToken balance represents our share of the Aave pool
        return IERC20(address(aToken)).balanceOf(address(this));
    }

    /// @notice Maximum amount that can be withdrawn in a single transaction
    /// @return Maximum withdrawable USDC
    function maxWithdrawable() external view override returns (uint256) {
        // Get our aToken balance (capped by protocol cash in real implementation)
        uint256 aTokenBalance = IERC20(address(aToken)).balanceOf(address(this));
        return aTokenBalance;
    }

    /// @notice List of reward tokens
    /// @return Array of reward token addresses
    function rewardTokens() external view override returns (address[] memory) {
        if (incentivesController == address(0)) {
            address[] memory empty = new address[](0);
            return empty;
        }

        // Return Aave incentive token
        address[] memory rewards = new address[](1);
        rewards[0] = incentivesController;
        return rewards;
    }

    /// @notice Claimable reward amount
    /// @param /*token*/ Token address to check rewards for
    /// @return Amount of claimable rewards
    function claimableReward(address /*token*/) external pure override returns (uint256) {
        // Simplified: return 0 for mock testing
        // Real implementation would query incentives controller
        return 0;
    }

    /// @notice Configuration digest for the strategy
    /// @return Unique digest of current protocol configuration
    function configurationDigest() external view override returns (bytes32) {
        // Always compute fresh digest including current index
        uint256 currentIndex = pool.getReserveNormalizedIncome(asset);
        return keccak256(abi.encode(cachedConfigDigest, currentIndex));
    }

    /// @notice Compute configuration digest
    /// @return Configuration digest
    function _computeConfigDigest() internal view returns (bytes32) {
        return keccak256(abi.encode(address(pool), asset, address(aToken), incentivesController));
    }

    /// @notice Update cached configuration (call after rate model changes)
    function updateConfigDigest() external {
        cachedLiquidityIndex = pool.getReserveNormalizedIncome(asset);
        cachedConfigDigest = _computeConfigDigest();
        emit ConfigurationUpdated(cachedConfigDigest, cachedLiquidityIndex);
    }
}
