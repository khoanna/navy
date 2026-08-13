// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IAaveV3Pool, IAaveV3AToken, IAaveV3RewardsController} from "../interfaces/IAaveV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AaveV3Adapter — supplies the vault's USDC to Aave V3 on Base.
/// @dev The adapter is msg.sender to Aave Pool, so Aave credits this contract.
/// totalAssets reads the aUSDC balance (indexed value). Only the vault may move funds.
/// Per SRCLA paper Section 6.3.
contract AaveV3Adapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

    uint256 private constant RAY = 1e27;
    uint256 private constant HALF_RAY = 5e26;
    uint256 private constant SUPPLY_CAP_MASK = (uint256(1) << 36) - 1;

    address public immutable vault;
    IERC20 public immutable usdc;
    IAaveV3Pool public immutable pool;
    IAaveV3AToken public immutable aUsdc;
    IAaveV3RewardsController public immutable incentivesController;

    error NotVault();
    error UnsupportedRewardToken();
    error ProtocolPaused();
    error DepositFailed();
    error WithdrawFailed();
    error InvalidConfiguration();
    error InvalidRecipient();
    error RewardClaimMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _pool, address _aUsdc) {
        if (_vault == address(0) || _usdc == address(0) || _pool == address(0) || _aUsdc == address(0)) {
            revert InvalidConfiguration();
        }
        if (_aUsdc.code.length == 0 || _pool.code.length == 0) revert InvalidConfiguration();
        IAaveV3AToken aToken_ = IAaveV3AToken(_aUsdc);
        if (aToken_.UNDERLYING_ASSET_ADDRESS() != _usdc) revert InvalidConfiguration();
        if (IAaveV3Pool(_pool).getReserveData(_usdc).aTokenAddress != _aUsdc) revert InvalidConfiguration();
        address controller_ = aToken_.getIncentivesController();
        if (controller_ == address(0) || controller_.code.length == 0) revert InvalidConfiguration();
        vault = _vault;
        usdc = IERC20(_usdc);
        pool = IAaveV3Pool(_pool);
        aUsdc = aToken_;
        incentivesController = IAaveV3RewardsController(controller_);
    }

    /// @notice Supply USDC to Aave V3 Pool
    /// @dev Approves pool to pull USDC, then calls supply
    /// @dev Uses try/catch for protocol pause resilience
    function deposit(uint256 amount) external onlyVault returns (uint256 credited) {
        uint256 beforeAssets = aUsdc.balanceOf(address(this));
        usdc.forceApprove(address(pool), amount);
        try pool.supply(address(usdc), amount, address(this), 0) {}
        catch {
            revert DepositFailed();
        }
        usdc.forceApprove(address(pool), 0);
        credited = aUsdc.balanceOf(address(this)) - beforeAssets;
    }

    /// @notice Withdraw USDC from Aave V3 Pool
    /// @dev Calls withdraw on the pool, sends to vault
    /// @dev Uses try/catch for protocol pause resilience
    function withdraw(uint256 amount) external onlyVault returns (uint256 returned) {
        uint256 beforeBalance = usdc.balanceOf(vault);
        try pool.withdraw(address(usdc), amount, vault) returns (uint256) {}
        catch {
            revert WithdrawFailed();
        }
        returned = usdc.balanceOf(vault) - beforeBalance;
    }

    /// @notice Current value of Aave position in USDC terms
    /// @dev Uses aToken balance which is already indexed to include accrued interest
    function totalAssets() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    function sync() external view returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    /// @notice Annualized supply rate (APY) as 1e18-scaled integer
    /// @dev Reads current liquidity rate from pool reserve data.
    ///      currentLiquidityRate is already annualized in RAY (1e27).
    function supplyRatePerYear() external view returns (uint256) {
        IAaveV3Pool.ReserveData memory reserveData = pool.getReserveData(address(usdc));
        // Convert the annualized RAY value directly to WAD.
        return uint256(reserveData.currentLiquidityRate) / 1e9;
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

    /// @notice Maximum amount withdrawable in same transaction
    /// @dev aUSDC is 1:1 mint/burn, always fully redeemable. Implements IStrategyAdapter.maxWithdrawable()
    /// @dev Note: Aave V3 allows instant withdrawals as aTokens are rebasing
    function maxWithdrawable() external view returns (uint256) {
        uint256 position = aUsdc.balanceOf(address(this));
        uint256 cash = usdc.balanceOf(address(aUsdc));
        return position < cash ? position : cash;
    }

    /// @notice Live Aave supply headroom after reserve state, cap, and accrued treasury usage.
    function maxDeployable() external view returns (uint256) {
        IAaveV3Pool.ReserveData memory reserve = pool.getReserveData(address(usdc));
        uint256 config = reserve.configuration.data;
        bool active = ((config >> 56) & 1) != 0;
        bool frozen = ((config >> 57) & 1) != 0;
        bool paused = ((config >> 60) & 1) != 0;
        if (!active || frozen || paused) return 0;

        uint256 supplyCap = (config >> 116) & SUPPLY_CAP_MASK;
        if (supplyCap == 0) return type(uint256).max;
        uint256 decimals_ = (config >> 48) & 0xff;
        if (decimals_ > 77) return 0;

        uint256 index = pool.getReserveNormalizedIncome(address(usdc));
        if (index == 0) return 0;
        uint256 capBase = supplyCap * (10 ** decimals_);
        uint256 scaledUsage = aUsdc.scaledTotalSupply() + uint256(reserve.accruedToTreasury);
        uint256 usage = _rayMul(scaledUsage, index);
        if (usage >= capBase) return 0;

        uint256 headroom = capBase - usage;
        uint256 projected = _rayMul(scaledUsage + _rayDiv(headroom, index), index);
        while (projected > capBase && headroom != 0) {
            unchecked {
                --headroom;
            }
            projected = _rayMul(scaledUsage + _rayDiv(headroom, index), index);
        }
        return headroom;
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev Implements IStrategyAdapter.configurationDigest()
    function configurationDigest() external view returns (bytes32) {
        return keccak256(
            abi.encode(address(pool), address(aUsdc), address(usdc), address(incentivesController), block.chainid)
        );
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        address[] memory configured = incentivesController.getRewardsByAsset(address(aUsdc));
        address[] memory active = new address[](configured.length);
        uint256 cursor;
        for (uint256 i = 0; i < configured.length; ++i) {
            if (_isActiveReward(configured[i])) active[cursor++] = configured[i];
        }
        assembly ("memory-safe") {
            mstore(active, cursor)
        }
        return active;
    }

    /// @notice Claimable reward amount for a given token
    /// @dev Ended and zero-emission controller entries remain discoverable but contribute zero.
    function claimableReward(address token) external view returns (uint256) {
        (bool discovered, bool active) = _rewardState(token);
        if (!discovered) revert UnsupportedRewardToken();
        if (!active) return 0;
        return incentivesController.getUserRewards(_assets(), address(this), token);
    }

    /// @notice Claims at most `maxAmount` of one exact active Aave reward to `recipient`.
    /// @dev The controller return is not trusted: it must equal the recipient's measured balance delta.
    function claimReward(address token, uint256 maxAmount, address recipient)
        external
        onlyVault
        returns (uint256 claimed)
    {
        if (recipient == address(0)) revert InvalidRecipient();
        (bool discovered, bool active) = _rewardState(token);
        if (!discovered) revert UnsupportedRewardToken();
        if (!active || maxAmount == 0) return 0;

        address[] memory assets = _assets();
        uint256 owed = incentivesController.getUserRewards(assets, address(this), token);
        uint256 requested = owed < maxAmount ? owed : maxAmount;
        if (requested == 0) return 0;

        uint256 beforeBalance = IERC20(token).balanceOf(recipient);
        uint256 controllerClaimed = incentivesController.claimRewards(assets, requested, recipient, token);
        uint256 afterBalance = IERC20(token).balanceOf(recipient);
        if (afterBalance < beforeBalance) revert RewardClaimMismatch();
        claimed = afterBalance - beforeBalance;
        if (claimed != controllerClaimed || claimed > requested) revert RewardClaimMismatch();
    }

    function _rewardState(address token) internal view returns (bool discovered, bool active) {
        address[] memory configured = incentivesController.getRewardsByAsset(address(aUsdc));
        for (uint256 i = 0; i < configured.length; ++i) {
            if (configured[i] == token) {
                discovered = true;
                active = _isActiveReward(token);
                break;
            }
        }
    }

    function _isActiveReward(address token) internal view returns (bool) {
        if (token == address(0) || token.code.length == 0) return false;
        (, uint256 emissionPerSecond,, uint256 distributionEnd) =
            incentivesController.getRewardsData(address(aUsdc), token);
        return emissionPerSecond != 0 && block.timestamp < distributionEnd;
    }

    function _assets() internal view returns (address[] memory assets) {
        assets = new address[](1);
        assets[0] = address(aUsdc);
    }

    function _rayMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b + HALF_RAY) / RAY;
    }

    function _rayDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * RAY + b / 2) / b;
    }
}
