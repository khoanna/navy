// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CompoundAdapter — supplies the vault's USDC to Compound III (Comet).
/// @dev The adapter is msg.sender to Comet, so Comet credits this contract. totalAssets reads the
/// Comet supplier balance. Only the vault may move funds.
contract CompoundAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    address public immutable vault;
    IERC20 public immutable usdc;
    IComet public immutable comet;

    /// @dev COMP reward token on Base
    /// @notice From official compound-finance/comet roots: 0x9e1028F5F1D5eDE59748FFceE5532509976840E0
    address private constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;

    /// @dev List of reward tokens this adapter can claim
    address[] private _rewardTokens = [COMP];

    error NotVault();
    error UnsupportedRewardToken();
    error DepositFailed();
    error WithdrawFailed();
    error InvalidConfiguration();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _comet) {
        if (_vault == address(0) || _usdc == address(0) || _comet == address(0)) revert InvalidConfiguration();
        if (_comet.code.length != 0 && IComet(_comet).baseToken() != _usdc) revert InvalidConfiguration();
        vault = _vault;
        usdc = IERC20(_usdc);
        comet = IComet(_comet);
    }

    /// @notice Supply USDC to Compound III (Comet)
    /// @dev Uses try/catch for protocol pause resilience
    function deposit(uint256 amount) external onlyVault returns (uint256 credited) {
        uint256 beforeAssets = comet.balanceOf(address(this));
        usdc.forceApprove(address(comet), amount);
        try comet.supply(address(usdc), amount) {}
        catch {
            revert DepositFailed();
        }
        usdc.forceApprove(address(comet), 0);
        credited = comet.balanceOf(address(this)) - beforeAssets;
    }

    /// @notice Withdraw USDC from Compound III (Comet)
    /// @dev Uses try/catch for protocol pause resilience
    function withdraw(uint256 amount) external onlyVault returns (uint256 returned) {
        uint256 beforeBalance = usdc.balanceOf(vault);
        try comet.withdrawTo(vault, address(usdc), amount) {}
        catch {
            revert WithdrawFailed();
        }
        returned = usdc.balanceOf(vault) - beforeBalance;
    }

    /// @notice Current value of Compound position in USDC terms
    /// @dev Uses Comet supplier balance which includes accrued interest
    function totalAssets() external view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    function sync() external view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    /// @notice Annualized supply rate (APY) as 1e18-scaled integer
    /// @dev Reads utilization-based supply rate from Comet
    function supplyRatePerYear() external view returns (uint256) {
        uint256 util = comet.getUtilization();
        uint64 ratePerSecond = comet.getSupplyRate(util); // 1e18-scaled per-second
        return uint256(ratePerSecond) * SECONDS_PER_YEAR;
    }

    /// @notice Returns the vault asset (USDC)
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Maximum amount withdrawable in same transaction
    /// @dev Considers protocol liquidity to prevent over-reporting at high utilization
    function maxWithdrawable() external view returns (uint256) {
        uint256 balance = comet.balanceOf(address(this));
        // Check how much USDC is available in Comet for withdrawal
        uint256 availableInComet = IERC20(usdc).balanceOf(address(comet));
        // Withdrawable is the minimum of our balance and available liquidity
        return balance < availableInComet ? balance : availableInComet;
    }

    /// @notice Compound III base-asset supply has no protocol supply cap.
    function maxDeployable() external pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev Implements IStrategyAdapter.configurationDigest()
    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(address(comet), address(usdc), block.chainid));
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    /// @notice Claimable reward amount for a given token
    /// @dev Implements IStrategyAdapter.claimableReward(). Returns 0 until rewards are integrated.
    function claimableReward(address token) external pure returns (uint256) {
        if (token != COMP) revert UnsupportedRewardToken();
        // Compound rewards integration deferred for Phase 2
        return 0;
    }
}
