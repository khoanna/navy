// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IMToken, IMComptroller, IMInterestRateModel, IMultiRewardDistributor} from "../interfaces/IMToken.sol";
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
    uint256 private constant BORROW_RATE_MAX_MANTISSA = 0.0005e16;

    address public immutable vault;
    address public immutable admin;
    IERC20 public immutable usdc;
    IMToken public immutable mUsdc;
    IMComptroller public immutable comptroller;
    IMInterestRateModel public immutable interestRateModel;
    IMultiRewardDistributor public immutable rewardDistributor;

    /// @notice Exact newly claimed reward remainder retained by a bounded claim.
    /// @dev Unrelated pre-existing balances are deliberately excluded from this ledger.
    mapping(address token => uint256 amount) public pendingRewards;

    bool private _claimEntered;

    error NotVault();
    error NotAdmin();
    error UnsupportedRewardToken();
    error MintFailed();
    error RedeemFailed();
    error ProtocolPaused();
    error InvalidConfiguration();
    error SupplyCapExceeded();
    error InvalidRecipient();
    error RewardClaimMismatch();
    error ProtectedRecoveryToken();
    error ProtectedRewardBalance();
    error ReentrantRewardOperation();

    event UnsupportedRewardRecovered(address indexed token, address indexed recipient, uint256 amount);
    event RewardQuarantined(address indexed token, uint256 amount);

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier nonReentrantRewardOperation() {
        if (_claimEntered) revert ReentrantRewardOperation();
        _claimEntered = true;
        _;
        _claimEntered = false;
    }

    constructor(address _vault, address _usdc, address _mUsdc, address _comptroller, address _interestRateModel) {
        if (
            _vault == address(0) || _usdc == address(0) || _mUsdc == address(0) || _comptroller == address(0)
                || _interestRateModel == address(0) || _mUsdc.code.length == 0 || _comptroller.code.length == 0
                || _interestRateModel.code.length == 0
        ) revert InvalidConfiguration();
        if (
            IMToken(_mUsdc).underlying() != _usdc || IMToken(_mUsdc).comptroller() != _comptroller
                || IMToken(_mUsdc).interestRateModel() != _interestRateModel
        ) revert InvalidConfiguration();
        address resolvedDistributor = IMComptroller(_comptroller).rewardDistributor();
        if (
            resolvedDistributor == address(0) || resolvedDistributor.code.length == 0
                || IMultiRewardDistributor(resolvedDistributor).comptroller() != _comptroller
        ) revert InvalidConfiguration();
        vault = _vault;
        admin = msg.sender;
        usdc = IERC20(_usdc);
        mUsdc = IMToken(_mUsdc);
        comptroller = IMComptroller(_comptroller);
        interestRateModel = IMInterestRateModel(_interestRateModel);
        rewardDistributor = IMultiRewardDistributor(resolvedDistributor);
    }

    /// @notice Supply USDC to Moonwell by minting mUSDC
    /// @dev First transfers USDC to this adapter, then mints mTokens
    /// @dev Uses try/catch for protocol pause resilience
    function deposit(uint256 amount) external onlyVault returns (uint256 credited) {
        if (amount > maxDeployable()) revert SupplyCapExceeded();
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

    /// @notice Live Moonwell mint headroom, including the market pause and supply cap.
    function maxDeployable() public view returns (uint256) {
        (bool isListed,) = comptroller.markets(address(mUsdc));
        if (!isListed) return 0;
        if (comptroller.mintGuardianPaused(address(mUsdc))) return 0;
        uint256 supplyCap = comptroller.supplyCaps(address(mUsdc));
        if (supplyCap == 0) return type(uint256).max;
        (bool valid, uint256 marketSupply) = _projectedMarketSupply();
        if (!valid) return 0;
        if (marketSupply >= supplyCap - 1) return 0;
        return supplyCap - marketSupply - 1;
    }

    /// @notice Unique digest of current protocol configuration
    /// @dev Implements IStrategyAdapter.configurationDigest()
    function configurationDigest() external view returns (bytes32) {
        address currentDistributor = comptroller.rewardDistributor();
        bytes32 marketConfigDigest;
        if (currentDistributor == address(rewardDistributor)) {
            marketConfigDigest = keccak256(abi.encode(rewardDistributor.getAllMarketConfigs(address(mUsdc))));
        }
        return keccak256(
            abi.encode(
                address(mUsdc),
                address(mUsdc).codehash,
                address(comptroller),
                address(comptroller).codehash,
                address(interestRateModel),
                currentDistributor,
                address(rewardDistributor),
                address(rewardDistributor).codehash,
                marketConfigDigest,
                address(usdc),
                block.chainid
            )
        );
    }

    /// @notice List of reward tokens this strategy can claim
    /// @dev Implements IStrategyAdapter.rewardTokens()
    function rewardTokens() external view returns (address[] memory) {
        if (!_rewardConfigurationCurrent()) return new address[](0);
        IMultiRewardDistributor.MarketConfig[] memory configs = rewardDistributor.getAllMarketConfigs(address(mUsdc));
        address[] memory active = new address[](configs.length);
        uint256 cursor;
        for (uint256 i = 0; i < configs.length; ++i) {
            address token = configs[i].emissionToken;
            if (_seenToken(active, cursor, token)) continue;
            (bool discovered, uint256 upstream) = _activeFundedOutstanding(token, configs);
            if (discovered && (pendingRewards[token] != 0 || upstream != 0)) active[cursor++] = token;
        }
        assembly ("memory-safe") {
            mstore(active, cursor)
        }
        return active;
    }

    /// @notice Claimable reward amount for a given token
    /// @dev Includes only a measured bounded remainder plus exact active, funded upstream rewards.
    function claimableReward(address token) external view onlyVault returns (uint256) {
        uint256 pending = _availablePending(token);
        IMultiRewardDistributor.MarketConfig[] memory configs = rewardDistributor.getAllMarketConfigs(address(mUsdc));
        (bool discovered, uint256 upstream) = _activeFundedOutstanding(token, configs);
        if (!discovered && pending == 0) revert UnsupportedRewardToken();
        return pending + upstream;
    }

    /// @notice Claims every configured Moonwell stream and transfers only bounded requested-token rewards.
    /// @dev Every exact configured-token delta is measured. Non-requested tokens remain quarantined here.
    function claimReward(address token, uint256 maxAmount, address recipient)
        external
        onlyVault
        nonReentrantRewardOperation
        returns (uint256 claimed)
    {
        if (recipient == address(0)) revert InvalidRecipient();

        uint256 pending = _availablePending(token);
        if (pending != 0) return _payPending(token, pending, maxAmount, recipient);

        IMultiRewardDistributor.MarketConfig[] memory configs = rewardDistributor.getAllMarketConfigs(address(mUsdc));
        (bool discovered, uint256 upstream) = _activeFundedOutstanding(token, configs);
        if (!discovered) revert UnsupportedRewardToken();
        if (upstream == 0 || maxAmount == 0) return 0;

        (address[] memory tokens, uint256[] memory beforeBalances) = _snapshotConfiguredTokens(configs);
        address[] memory markets = new address[](1);
        markets[0] = address(mUsdc);
        comptroller.claimReward(address(this), markets);

        uint256 requestedDelta;
        for (uint256 i = 0; i < tokens.length; ++i) {
            uint256 afterBalance = IERC20(tokens[i]).balanceOf(address(this));
            if (afterBalance < beforeBalances[i]) revert RewardClaimMismatch();
            uint256 delta = afterBalance - beforeBalances[i];
            if (tokens[i] == token) requestedDelta = delta;
            else if (delta != 0) emit RewardQuarantined(tokens[i], delta);
        }
        if (requestedDelta == 0 || requestedDelta > upstream) revert RewardClaimMismatch();

        pendingRewards[token] = requestedDelta;
        return _payPending(token, requestedDelta, maxAmount, recipient);
    }

    /// @notice Recovers quarantined or accidentally sent non-principal tokens.
    /// @dev The deployment caller is the recovery admin. The allocator and vault have no implicit authority.
    function recoverUnsupportedReward(address token, address recipient, uint256 amount)
        external
        onlyAdmin
        nonReentrantRewardOperation
    {
        if (recipient == address(0)) revert InvalidRecipient();
        if (token == address(usdc) || token == address(mUsdc)) revert ProtectedRecoveryToken();

        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        uint256 protected = pendingRewards[token];
        if (beforeBalance < protected || amount > beforeBalance - protected) revert ProtectedRewardBalance();
        IERC20(token).safeTransfer(recipient, amount);
        uint256 afterBalance = IERC20(token).balanceOf(address(this));
        if (afterBalance > beforeBalance || beforeBalance - afterBalance != amount) revert RewardClaimMismatch();
        emit UnsupportedRewardRecovered(token, recipient, amount);
    }

    function _activeFundedOutstanding(address token, IMultiRewardDistributor.MarketConfig[] memory configs)
        internal
        view
        returns (bool discovered, uint256 outstanding)
    {
        bool active;
        for (uint256 i = 0; i < configs.length; ++i) {
            if (configs[i].emissionToken != token) continue;
            discovered = true;
            if (configs[i].supplyEmissionsPerSec != 0 && block.timestamp < configs[i].endTime) active = true;
        }
        if (!active || !_rewardConfigurationCurrent() || rewardDistributor.paused() || token.code.length == 0) {
            return (discovered, 0);
        }

        IMultiRewardDistributor.RewardInfo[] memory rewards =
            rewardDistributor.getOutstandingRewardsForUser(address(mUsdc), address(this));
        for (uint256 i = 0; i < rewards.length; ++i) {
            if (rewards[i].emissionToken == token) outstanding += rewards[i].supplySide;
        }
        if (outstanding == 0) return (discovered, 0);
        try IERC20(token).balanceOf(address(rewardDistributor)) returns (uint256 funding) {
            if (funding < outstanding) outstanding = 0;
        } catch {
            outstanding = 0;
        }
    }

    function _rewardConfigurationCurrent() internal view returns (bool) {
        try comptroller.rewardDistributor() returns (address currentDistributor) {
            if (currentDistributor != address(rewardDistributor)) return false;
        } catch {
            return false;
        }
        try rewardDistributor.comptroller() returns (address configuredComptroller) {
            return configuredComptroller == address(comptroller);
        } catch {
            return false;
        }
    }

    function _snapshotConfiguredTokens(IMultiRewardDistributor.MarketConfig[] memory configs)
        internal
        view
        returns (address[] memory tokens, uint256[] memory balances)
    {
        tokens = new address[](configs.length);
        uint256 cursor;
        for (uint256 i = 0; i < configs.length; ++i) {
            address configuredToken = configs[i].emissionToken;
            if (configuredToken == address(0) || _seenToken(tokens, cursor, configuredToken)) continue;
            tokens[cursor++] = configuredToken;
        }
        assembly ("memory-safe") {
            mstore(tokens, cursor)
        }

        balances = new uint256[](cursor);
        for (uint256 i = 0; i < cursor; ++i) {
            balances[i] = IERC20(tokens[i]).balanceOf(address(this));
        }
    }

    function _payPending(address token, uint256 pending, uint256 maxAmount, address recipient)
        internal
        returns (uint256 claimed)
    {
        claimed = pending < maxAmount ? pending : maxAmount;
        if (claimed == 0) return 0;

        uint256 adapterBefore = IERC20(token).balanceOf(address(this));
        uint256 recipientBefore = IERC20(token).balanceOf(recipient);
        pendingRewards[token] = pending - claimed;
        IERC20(token).safeTransfer(recipient, claimed);
        uint256 adapterAfter = IERC20(token).balanceOf(address(this));
        uint256 recipientAfter = IERC20(token).balanceOf(recipient);
        if (
            adapterAfter > adapterBefore || adapterBefore - adapterAfter != claimed || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != claimed
        ) revert RewardClaimMismatch();
    }

    function _availablePending(address token) internal view returns (uint256 pending) {
        pending = pendingRewards[token];
        if (pending == 0) return 0;
        if (IERC20(token).balanceOf(address(this)) < pending) revert RewardClaimMismatch();
    }

    function _seenToken(address[] memory tokens, uint256 length, address token) internal pure returns (bool) {
        for (uint256 i = 0; i < length; ++i) {
            if (tokens[i] == token) return true;
        }
        return false;
    }

    function _positionAssets() internal view returns (uint256) {
        return (mUsdc.balanceOf(address(this)) * mUsdc.exchangeRateStored()) / MANTISSA;
    }

    /// @dev Mirrors MToken.accrueInterest floor arithmetic without mutating protocol state.
    function _projectedMarketSupply() internal view returns (bool valid, uint256 supply) {
        uint256 cash = mUsdc.getCash();
        uint256 borrows = mUsdc.totalBorrows();
        uint256 reserves = mUsdc.totalReserves();
        uint256 accruedAt = mUsdc.accrualBlockTimestamp();
        if (accruedAt == 0 || accruedAt > block.timestamp) return (false, 0);

        uint256 elapsed = block.timestamp - accruedAt;
        if (elapsed != 0) {
            uint256 rate;
            try mUsdc.borrowRatePerTimestamp() returns (uint256 currentRate) {
                rate = currentRate;
            } catch {
                return (false, 0);
            }
            if (rate > BORROW_RATE_MAX_MANTISSA || rate > type(uint256).max / elapsed) return (false, 0);
            uint256 simpleInterestFactor = rate * elapsed;
            if (simpleInterestFactor != 0 && borrows > type(uint256).max / simpleInterestFactor) return (false, 0);
            uint256 interestAccumulated = (simpleInterestFactor * borrows) / MANTISSA;
            uint256 reserveFactor = mUsdc.reserveFactorMantissa();
            if (reserveFactor > MANTISSA) return (false, 0);
            if (reserveFactor != 0 && interestAccumulated > type(uint256).max / reserveFactor) return (false, 0);
            uint256 reservesAccrued = (reserveFactor * interestAccumulated) / MANTISSA;
            if (interestAccumulated > type(uint256).max - borrows) return (false, 0);
            if (reservesAccrued > type(uint256).max - reserves) return (false, 0);
            borrows += interestAccumulated;
            reserves += reservesAccrued;
        }

        if (cash > type(uint256).max - borrows) return (false, 0);
        uint256 supplied = cash + borrows;
        if (reserves > supplied) return (false, 0);
        return (true, supplied - reserves);
    }
}
