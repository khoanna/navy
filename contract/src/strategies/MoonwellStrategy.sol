// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @notice Interface for Moonwell mToken (Compound-v2-style ABI)
interface IMToken {
    /// @notice Mint mTokens by depositing underlying (pulls from msg.sender)
    /// @return code 0 = success, non-zero = error code
    function mint(uint256 underlyingAmount) external returns (uint256 code);

    /// @notice Redeem mTokens for underlying (sends underlying to msg.sender)
    /// @return code 0 = success, non-zero = error code
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256 code);

    /// @notice Available cash for withdrawals
    function getCash() external view returns (uint256);

    /// @notice Exchange rate: mToken * exchangeRateStored / 1e18 = underlying
    function exchangeRateStored() external view returns (uint256);

    /// @notice Get underlying asset address
    function underlying() external view returns (address);
}

/// @title MoonwellStrategy
/// @notice Strategy adapter for Moonwell (mUSDC) on Base
/// @dev Deposits USDC to Moonwell's mUSDC market. Position = mToken balance converted by the
///      stored exchange rate; withdrawal is capped by protocol cash. The strategy never borrows.
contract MoonwellStrategy is IStrategyAdapter {
    using SafeERC20 for IERC20;

    /// @notice Exchange rate precision (Compound-style expScale)
    uint256 public constant EXCHANGE_RATE_PRECISION = 1e18;

    /// @notice Address of the vault
    address public immutable override vault;

    /// @notice Address of the underlying asset (USDC)
    address public immutable override asset;

    /// @notice Address of the Moonwell mToken
    IMToken public immutable mToken;

    /// @notice Cached configuration digest
    bytes32 public cachedConfigDigest;

    /// @notice Custom errors
    error OnlyVault();
    error ZeroAddress();
    error MintFailed(uint256 code);
    error RedeemFailed(uint256 code);
    error RedeemPaused();
    error InsufficientAssets();

    /// @notice Event when configuration changes
    event ConfigurationUpdated(bytes32 indexed digest);

    /// @param vault_ Address of the vault
    /// @param asset_ Address of the underlying asset (USDC)
    /// @param mToken_ Address of the Moonwell mToken
    constructor(address vault_, address asset_, address mToken_) {
        if (vault_ == address(0)) revert ZeroAddress();
        if (asset_ == address(0)) revert ZeroAddress();
        if (mToken_ == address(0)) revert ZeroAddress();

        vault = vault_;
        asset = asset_;
        mToken = IMToken(mToken_);

        cachedConfigDigest = _computeConfigDigest();
    }

    /// @notice Deposit assets into Moonwell
    /// @dev Vault sends USDC before calling this function. Credited is measured as the USDC
    ///      actually pulled by the mToken (an exact transferFrom of `assets`), matching the
    ///      balance-delta pattern of the Aave/Compound strategies — the contract never calls its
    ///      own interface-overriding `totalAssets()` internally (unreliable under solc 0.8.24).
    /// @param assets Amount of USDC to deposit
    /// @return credited Amount of underlying credited to the position
    function deposit(uint256 assets) external override returns (uint256 credited) {
        if (msg.sender != vault) revert OnlyVault();
        if (assets == 0) return 0;

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));

        // Approve mToken to spend USDC
        _approveIfNeeded(IERC20(asset), address(mToken), assets);

        // Mint mTokens; Moonwell returns a non-zero error code on failure
        uint256 code = mToken.mint(assets);
        if (code != 0) revert MintFailed(code);

        credited = balanceBefore - IERC20(asset).balanceOf(address(this));
    }

    /// @dev Helper to approve token spending
    function _approveIfNeeded(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) < amount) {
            SafeERC20.forceApprove(token, spender, amount);
        }
    }

    /// @notice Withdraw assets from Moonwell
    /// @param assets Amount of USDC to withdraw
    /// @return returned Amount of USDC returned to vault
    function withdraw(uint256 assets) external override returns (uint256 returned) {
        if (msg.sender != vault) revert OnlyVault();
        if (assets == 0) return 0;

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));

        // Redeem mTokens for underlying; underlying is sent to this strategy
        uint256 code = mToken.redeemUnderlying(assets);
        if (code != 0) revert RedeemFailed(code);

        returned = IERC20(asset).balanceOf(address(this)) - balanceBefore;

        // Forward to the vault
        IERC20(asset).safeTransfer(vault, returned);

        // Redeem must not return less than requested
        if (returned < assets) revert InsufficientAssets();
    }

    /// @notice Total assets held in strategy
    /// @return Total USDC value including accrued interest
    function totalAssets() external view override returns (uint256) {
        uint256 mTokenBalance = IERC20(address(mToken)).balanceOf(address(this));
        return _mTokenToUnderlying(mTokenBalance);
    }

    /// @notice Maximum amount that can be withdrawn in a single transaction
    /// @return Maximum withdrawable USDC (position capped by protocol cash)
    function maxWithdrawable() external view override returns (uint256) {
        uint256 mTokenBalance = IERC20(address(mToken)).balanceOf(address(this));
        if (mTokenBalance == 0) return 0;

        uint256 positionValue = _mTokenToUnderlying(mTokenBalance);
        uint256 protocolCash = mToken.getCash();

        return positionValue < protocolCash ? positionValue : protocolCash;
    }

    /// @notice Convert mToken amount to underlying amount
    /// @dev Compound-style: exchangeRateStored = (cash + borrows - reserves) * 1e18 / totalSupply,
    ///      so underlying = mTokens * exchangeRateStored / 1e18 (verified against the Base market).
    function _mTokenToUnderlying(uint256 mTokens) internal view returns (uint256) {
        uint256 rate = mToken.exchangeRateStored();
        if (rate == 0) return 0;
        return (mTokens * rate) / EXCHANGE_RATE_PRECISION;
    }

    /// @notice List of reward tokens
    /// @return Array of reward token addresses
    function rewardTokens() external pure override returns (address[] memory) {
        // Moonwell distributes WELL on Base; reward harvesting arrives in Phase 3.
        address[] memory empty = new address[](0);
        return empty;
    }

    /// @notice Claimable reward amount
    /// @param /*token*/ Token address to check rewards for
    /// @return Amount of claimable rewards
    function claimableReward(
        address /*token*/
    )
        external
        pure
        override
        returns (uint256)
    {
        return 0;
    }

    /// @notice Configuration digest for the strategy
    /// @return Unique digest of current protocol configuration
    function configurationDigest() external view override returns (bytes32) {
        return cachedConfigDigest;
    }

    /// @notice Compute configuration digest
    /// @return Configuration digest
    function _computeConfigDigest() internal view returns (bytes32) {
        return keccak256(abi.encode(address(mToken), asset));
    }

    /// @notice Update cached configuration (call after rate model changes)
    function updateConfigDigest() external {
        cachedConfigDigest = _computeConfigDigest();
        emit ConfigurationUpdated(cachedConfigDigest);
    }
}
