// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IComet, ICometRewards} from "../interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CompoundAdapter — supplies the vault's USDC to Compound III (Comet).
/// @dev The adapter is msg.sender to Comet, so Comet credits this contract. totalAssets reads the
/// Comet supplier balance. Only the vault may move funds.
contract CompoundAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant FACTOR_SCALE = 1e18;

    /// @dev Official Compound III CometRewards deployment on Base.
    address private constant COMET_REWARDS = 0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1;

    /// @dev Exact COMP token configured for Base USDC Comet rewards.
    address private constant COMP = 0x9e1028F5F1D5eDE59748FFceE5532509976840E0;

    address public immutable vault;
    IERC20 public immutable usdc;
    IComet public immutable comet;
    ICometRewards public immutable cometRewards;
    uint64 public immutable rewardRescaleFactor;
    bool public immutable rewardShouldUpscale;
    uint256 public immutable rewardMultiplier;

    /// @notice Newly claimed COMP retained only because an upstream claim cannot be partially bounded.
    uint256 public pendingRewards;

    error NotVault();
    error UnsupportedRewardToken();
    error DepositFailed();
    error WithdrawFailed();
    error InvalidConfiguration();
    error InvalidRecipient();
    error RewardClaimMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _usdc, address _comet) {
        if (_vault == address(0) || _usdc == address(0) || _comet == address(0)) revert InvalidConfiguration();
        if (_comet.code.length == 0 || COMET_REWARDS.code.length == 0) revert InvalidConfiguration();
        if (IComet(_comet).baseToken() != _usdc) revert InvalidConfiguration();
        ICometRewards.RewardConfig memory rewardConfig = ICometRewards(COMET_REWARDS).rewardConfig(_comet);
        if (rewardConfig.token != COMP || rewardConfig.rescaleFactor == 0) revert InvalidConfiguration();
        vault = _vault;
        usdc = IERC20(_usdc);
        comet = IComet(_comet);
        cometRewards = ICometRewards(COMET_REWARDS);
        rewardRescaleFactor = rewardConfig.rescaleFactor;
        rewardShouldUpscale = rewardConfig.shouldUpscale;
        rewardMultiplier = rewardConfig.multiplier;
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
    /// @dev Returns the adapter's own USDC balance + Comet supplier balance
    function totalAssets() external view returns (uint256) {
        return usdc.balanceOf(address(this)) + comet.balanceOf(address(this));
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

    /// @notice Compound III base supply is uncapped but independently pausable.
    function maxDeployable() external view returns (uint256) {
        return comet.isSupplyPaused() ? 0 : type(uint256).max;
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev The proxy's EIP-1967 implementation slot cannot be read by another contract. Bind the accessible proxy
    /// bytecode, extension implementation identity/code, and every reward-critical live configuration value instead.
    function configurationDigest() external view returns (bytes32) {
        ICometRewards.RewardConfig memory current = cometRewards.rewardConfig(address(comet));
        address extension = comet.extensionDelegate();
        bytes32 codeIdentity = keccak256(
            abi.encode(
                address(comet),
                address(comet).codehash,
                extension,
                extension.codehash,
                address(cometRewards),
                address(cometRewards).codehash
            )
        );
        bytes32 rewardRegime = keccak256(
            abi.encode(
                current.token,
                current.rescaleFactor,
                current.shouldUpscale,
                current.multiplier,
                comet.baseTrackingSupplySpeed(),
                comet.baseMinForRewards()
            )
        );
        return keccak256(abi.encode(codeIdentity, address(usdc), rewardRegime, block.chainid));
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        address[] memory active = new address[](1);
        if (_hasPendingReward() || _hasFundedRewardSource()) {
            active[0] = COMP;
            return active;
        }
        assembly ("memory-safe") {
            mstore(active, 0)
        }
        return active;
    }

    /// @notice Accrues Compound state and reports only exact, fully funded COMP.
    function claimableReward(address token) external onlyVault returns (uint256) {
        _requireRewardToken(token);
        uint256 pending = _availablePending();
        if (!_upstreamRewardActive()) return pending;

        ICometRewards.RewardOwed memory rewardOwed = cometRewards.getRewardOwed(address(comet), address(this));
        if (rewardOwed.token != COMP) revert RewardClaimMismatch();
        if (rewardOwed.owed == 0 || IERC20(COMP).balanceOf(address(cometRewards)) < rewardOwed.owed) return pending;
        return pending + rewardOwed.owed;
    }

    /// @notice Claims Compound rewards to this adapter and pays at most `maxAmount` to `recipient`.
    /// @dev CometRewards claims all accrued rewards. Any bounded remainder is tracked and can be paid by a later call;
    /// unrelated COMP already held by the adapter is never included in that accounting.
    function claimReward(address token, uint256 maxAmount, address recipient)
        external
        onlyVault
        returns (uint256 claimed)
    {
        _requireRewardToken(token);
        if (recipient == address(0)) revert InvalidRecipient();
        if (maxAmount == 0) return 0;

        if (pendingRewards != 0) return _payPending(maxAmount, recipient);
        if (!_upstreamRewardActive()) return 0;

        ICometRewards.RewardOwed memory rewardOwed = cometRewards.getRewardOwed(address(comet), address(this));
        if (rewardOwed.token != COMP) revert RewardClaimMismatch();
        uint256 owed = rewardOwed.owed;
        if (owed == 0 || IERC20(COMP).balanceOf(address(cometRewards)) < owed) return 0;

        uint256 beforeBalance = IERC20(COMP).balanceOf(address(this));
        cometRewards.claim(address(comet), address(this), true);
        uint256 afterBalance = IERC20(COMP).balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != owed) revert RewardClaimMismatch();

        pendingRewards = owed;
        return _payPending(maxAmount, recipient);
    }

    function _payPending(uint256 maxAmount, address recipient) internal returns (uint256 claimed) {
        uint256 pending = _availablePending();
        claimed = pending < maxAmount ? pending : maxAmount;
        if (claimed == 0) return 0;

        uint256 adapterBefore = IERC20(COMP).balanceOf(address(this));
        uint256 recipientBefore = IERC20(COMP).balanceOf(recipient);
        pendingRewards = pending - claimed;
        IERC20(COMP).safeTransfer(recipient, claimed);
        uint256 adapterAfter = IERC20(COMP).balanceOf(address(this));
        uint256 recipientAfter = IERC20(COMP).balanceOf(recipient);
        if (
            adapterAfter > adapterBefore || adapterBefore - adapterAfter != claimed || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != claimed
        ) revert RewardClaimMismatch();
    }

    function _requireRewardToken(address token) internal pure {
        if (token != COMP) revert UnsupportedRewardToken();
    }

    function _hasPendingReward() internal view returns (bool) {
        return pendingRewards != 0 && IERC20(COMP).balanceOf(address(this)) >= pendingRewards;
    }

    function _availablePending() internal view returns (uint256) {
        uint256 pending = pendingRewards;
        if (IERC20(COMP).balanceOf(address(this)) < pending) revert RewardClaimMismatch();
        return pending;
    }

    function _hasFundedRewardSource() internal view returns (bool) {
        if (!_upstreamRewardActive()) return false;
        uint256 funding = IERC20(COMP).balanceOf(address(cometRewards));
        if (funding == 0) return false;
        uint256 owed = _storedRewardOwed();
        return owed == 0 || funding >= owed;
    }

    function _upstreamRewardActive() internal view returns (bool) {
        if (!_rewardConfigurationCurrent()) return false;
        IComet.TotalsBasic memory totals = comet.totalsBasic();
        return comet.baseTrackingSupplySpeed() != 0 && totals.totalSupplyBase >= comet.baseMinForRewards();
    }

    function _rewardConfigurationCurrent() internal view returns (bool) {
        ICometRewards.RewardConfig memory current = cometRewards.rewardConfig(address(comet));
        return current.token == COMP && current.rescaleFactor == rewardRescaleFactor
            && current.shouldUpscale == rewardShouldUpscale && current.multiplier == rewardMultiplier;
    }

    function _storedRewardOwed() internal view returns (uint256) {
        uint256 accrued = comet.baseTrackingAccrued(address(this));
        if (rewardShouldUpscale) accrued *= rewardRescaleFactor;
        else accrued /= rewardRescaleFactor;
        accrued = accrued * rewardMultiplier / FACTOR_SCALE;
        uint256 claimed = cometRewards.rewardsClaimed(address(comet), address(this));
        return accrued > claimed ? accrued - claimed : 0;
    }
}
