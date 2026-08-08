// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IEIP3009} from "./interfaces/IEIP3009.sol";
import {IRewardAccountant} from "./interfaces/IRewardAccountant.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";
import {IYieldAdapter} from "./interfaces/IYieldAdapter.sol";
import {VaultTypes} from "./libraries/VaultTypes.sol";

/// @title NavyVault
/// @dev Immutable ERC-4626 Base vault core. This task implements the accounting and
/// adapter-lifecycle slice required by the Base SRCLA plans while keeping minimal legacy
/// compile shims so the existing repository test suite can still compile.
contract NavyVault is ERC4626, ERC20Permit, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct AdapterInfo {
        bool exists;
        uint16 targetBps;
        uint16 capBps;
    }

    address public owner;
    address public pendingOwner;
    address public allocator;
    IRewardAccountant public rewardAccountant;
    uint256 public recognizedLosses;

    mapping(address => bool) public relayers;
    mapping(address => bool) public allocators;
    bool public paused;

    uint16 public minIdleBps;
    uint16 public maxLossBps;

    uint256 public constant MAX_ADAPTERS = 10;

    mapping(address => AdapterInfo) public adapterInfo;
    mapping(address => VaultTypes.AdapterConfig) public adapterConfig;
    mapping(address => uint256) public adapterImpairments;
    mapping(address => bytes32) public adapterConfigurationDigests;

    address[] private _configuredAdapters;
    mapping(address => bool) private _knownAdapters;
    mapping(address => bool) private _enumeratedAdapters;

    event RelayerSet(address indexed relayer, bool allowed);
    event AllocatorSet(address indexed allocator, bool allowed);
    event AdapterAdded(address indexed adapter, uint16 targetBps, uint16 capBps);
    event AdapterRemoved(address indexed adapter);
    event TargetsSet(address indexed adapter, uint16 targetBps, uint16 capBps);
    event ParamsSet(uint16 minIdleBps, uint16 maxLossBps);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PausedSet(bool paused);
    event AdapterValidated(address indexed adapter, bytes32 configurationDigest);
    event AdapterStatusSet(
        address indexed adapter, VaultTypes.AdapterStatus previousStatus, VaultTypes.AdapterStatus newStatus
    );
    event AdapterLimitsSet(
        address indexed adapter, uint16 capBps, uint256 absoluteCap, uint16 maxLossBps, uint256 accountingCap
    );
    event RewardAccountantSet(address indexed previousAccountant, address indexed newAccountant);
    event ImpairmentRecorded(
        address indexed adapter, uint256 impairment, uint256 cumulativeImpairment, uint256 recognizedLosses
    );

    error NotOwner();
    error NotRelayer();
    error NotAllocator();
    error ZeroAddress();
    error AdapterExists();
    error UnknownAdapter();
    error AdapterNotEmpty();
    error BpsTooHigh();
    error IdleBufferBreached();
    error CapExceeded();
    error LossTooHigh();
    error TooManyAdapters();
    error ZeroShares();
    error NotPendingOwner();
    error EnforcedPause();
    error InvalidAdapterAsset();
    error InvalidAdapterVault();
    error InvalidAdapterConfiguration();
    error InvalidAdapterStatus();
    error ImpairmentExceedsAssets();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert EnforcedPause();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    modifier onlyAllocator() {
        if (msg.sender != allocator && !allocators[msg.sender]) revert NotAllocator();
        _;
    }

    constructor(IERC20 asset_, address owner_)
        ERC20("Navy Vault USDC", "navUSDC")
        ERC4626(asset_)
        ERC20Permit("Navy Vault USDC")
    {
        _initialize(asset_, owner_, address(0));
    }

    function _initialize(IERC20 asset_, address owner_, address allocator_) internal {
        if (address(asset_) == address(0) || owner_ == address(0)) revert ZeroAddress();

        owner = owner_;
        maxLossBps = 50;

        if (allocator_ != address(0)) {
            allocator = allocator_;
            allocators[allocator_] = true;
        }
    }

    function totalAssets() public view override returns (uint256 assets_) {
        assets_ = IERC20(asset()).balanceOf(address(this));

        uint256 adapterCount_ = _configuredAdapters.length;
        for (uint256 i; i < adapterCount_; ++i) {
            assets_ += _recognizedStrategyAssets(_configuredAdapters[i]);
        }

        if (address(rewardAccountant) != address(0)) {
            try rewardAccountant.recognizedRewardAssets() returns (uint256 recognizedRewardAssets_) {
                assets_ += recognizedRewardAssets_;
            } catch {}
        }

        return assets_ > recognizedLosses ? assets_ - recognizedLosses : 0;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused || !_canIssueShares()) return 0;
        return type(uint256).max;
    }

    function maxMint(address) public view override returns (uint256) {
        if (paused || !_canIssueShares()) return 0;
        return type(uint256).max;
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return ERC4626.decimals();
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        _syncRewardAccountant(true);
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        _syncRewardAccountant(true);
        return super.mint(shares, receiver);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function setAllocator(address allocator_, bool allowed) external onlyOwner {
        if (allocator_ == address(0)) revert ZeroAddress();

        allocators[allocator_] = allowed;
        if (allowed) {
            allocator = allocator_;
        } else if (allocator == allocator_) {
            allocator = address(0);
        }

        emit AllocatorSet(allocator_, allowed);
    }

    function setParams(uint16 minIdleBps_, uint16 maxLossBps_) external onlyOwner {
        if (minIdleBps_ > 10_000 || maxLossBps_ > 10_000) revert BpsTooHigh();
        minIdleBps = minIdleBps_;
        maxLossBps = maxLossBps_;
        emit ParamsSet(minIdleBps_, maxLossBps_);
    }

    function adapterCount() external view returns (uint256) {
        return _configuredAdapters.length;
    }

    function configuredAdapters() external view returns (address[] memory adapters_) {
        return _configuredAdapters;
    }

    function adapterStatus(address adapter) external view returns (VaultTypes.AdapterStatus) {
        return adapterConfig[adapter].status;
    }

    function strategyAssets(address adapter) external view returns (uint256) {
        return _recognizedStrategyAssets(adapter);
    }

    function addAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();

        address adapterAsset = IStrategyAdapter(adapter).asset();
        if (adapterAsset != asset()) revert InvalidAdapterAsset();

        address adapterVault = IStrategyAdapter(adapter).vault();
        if (adapterVault != address(this)) revert InvalidAdapterVault();

        bytes32 configurationDigest = IStrategyAdapter(adapter).configurationDigest();
        if (configurationDigest == bytes32(0)) revert InvalidAdapterConfiguration();

        _registerAdapter(adapter, configurationDigest, 0, 10_000);
        emit AdapterValidated(adapter, configurationDigest);
    }

    function addAdapter(address adapter, uint16 targetBps, uint16 capBps) external onlyOwner {
        if (targetBps > 10_000 || capBps > 10_000) revert BpsTooHigh();
        _registerAdapter(adapter, bytes32(0), targetBps, capBps);
    }

    function setTargets(address adapter, uint16 targetBps, uint16 capBps) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();
        if (targetBps > 10_000 || capBps > 10_000) revert BpsTooHigh();

        adapterInfo[adapter].targetBps = targetBps;
        adapterInfo[adapter].capBps = capBps;
        adapterConfig[adapter].capBps = capBps;

        emit TargetsSet(adapter, targetBps, capBps);
    }

    function setAdapterStatus(address adapter, VaultTypes.AdapterStatus status) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();
        if (status == VaultTypes.AdapterStatus.None) revert InvalidAdapterStatus();

        VaultTypes.AdapterStatus previousStatus = adapterConfig[adapter].status;
        adapterConfig[adapter].status = status;
        emit AdapterStatusSet(adapter, previousStatus, status);

        if (status == VaultTypes.AdapterStatus.Removed && _isPrunableAdapter(adapter)) {
            _pruneAdapter(adapter);
        }
    }

    function setAdapterLimits(
        address adapter,
        uint16 capBps,
        uint256 absoluteCap,
        uint16 adapterMaxLossBps,
        uint256 accountingCap
    ) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();
        if (capBps > 10_000 || adapterMaxLossBps > 10_000) revert BpsTooHigh();

        VaultTypes.AdapterConfig storage config = adapterConfig[adapter];
        config.capBps = capBps;
        config.absoluteCap = absoluteCap;
        config.maxLossBps = adapterMaxLossBps;
        config.accountingCap = accountingCap;

        adapterInfo[adapter].capBps = capBps;

        emit AdapterLimitsSet(adapter, capBps, absoluteCap, adapterMaxLossBps, accountingCap);
    }

    function setRewardAccountant(address accountant) external onlyOwner {
        address previous = address(rewardAccountant);
        rewardAccountant = IRewardAccountant(accountant);
        emit RewardAccountantSet(previous, accountant);
    }

    function recordImpairment(address adapter, uint256 impairment) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();

        uint256 currentAssets = _recognizedStrategyAssets(adapter);
        uint256 nextImpairment = adapterImpairments[adapter] + impairment;
        if (nextImpairment > currentAssets) revert ImpairmentExceedsAssets();

        adapterImpairments[adapter] = nextImpairment;
        recognizedLosses += impairment;

        emit ImpairmentRecorded(adapter, impairment, nextImpairment, recognizedLosses);

        if (adapterConfig[adapter].status == VaultTypes.AdapterStatus.Removed && _isPrunableAdapter(adapter)) {
            _pruneAdapter(adapter);
        }
    }

    function removeAdapter(address adapter) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();
        if (_recognizedStrategyAssets(adapter) != 0 || !_liveAssetsAreZero(adapter)) revert AdapterNotEmpty();

        adapterConfig[adapter].status = VaultTypes.AdapterStatus.Removed;
        _pruneAdapter(adapter);
    }

    function forceRemoveAdapter(address adapter) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();
        adapterConfig[adapter].status = VaultTypes.AdapterStatus.Removed;

        if (_isPrunableAdapter(adapter)) {
            _pruneAdapter(adapter);
        }
    }

    function depositWithAuthorization(
        address user,
        uint256 assets,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRelayer nonReentrant whenNotPaused returns (uint256 shares) {
        _syncRewardAccountant(true);
        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroShares();

        IEIP3009(asset()).receiveWithAuthorization(user, address(this), assets, validAfter, validBefore, nonce, v, r, s);
        _mint(user, shares);

        emit Deposit(msg.sender, user, assets, shares);
    }

    function deployToAdapter(address adapter, uint256 amount) external onlyAllocator nonReentrant whenNotPaused {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();

        uint256 total = totalAssets();
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 minIdle = (total * minIdleBps) / 10_000;
        if (amount > idle || idle - amount < minIdle) revert IdleBufferBreached();

        uint256 capBps = adapterInfo[adapter].capBps;
        if (capBps != 0) {
            uint256 adapterAssets = _recognizedStrategyAssets(adapter);
            uint256 projected = adapterAssets + amount;
            if (projected > (total * capBps) / 10_000) revert CapExceeded();
        }

        IERC20(asset()).safeTransfer(adapter, amount);
        IYieldAdapter(adapter).deposit(amount);
    }

    function withdrawFromAdapter(address adapter, uint256 amount) external onlyAllocator nonReentrant {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();

        uint256 beforeBalance = IERC20(asset()).balanceOf(address(this));
        IYieldAdapter(adapter).withdraw(amount, address(this));
        uint256 received = IERC20(asset()).balanceOf(address(this)) - beforeBalance;

        if (amount > received) {
            uint256 allowedLoss = _allowedLoss(amount);
            if (amount - received > allowedLoss) revert LossTooHigh();
        }
    }

    function reallocate(address from, address to, uint256 amount) external onlyAllocator nonReentrant whenNotPaused {
        if (!adapterInfo[from].exists || !adapterInfo[to].exists) revert UnknownAdapter();

        uint256 beforeBalance = IERC20(asset()).balanceOf(address(this));
        IYieldAdapter(from).withdraw(amount, address(this));
        uint256 received = IERC20(asset()).balanceOf(address(this)) - beforeBalance;

        if (amount > received) {
            uint256 allowedLoss = _allowedLoss(amount);
            if (amount - received > allowedLoss) revert LossTooHigh();
        }

        IERC20(asset()).safeTransfer(to, amount);
        IYieldAdapter(to).deposit(amount);
    }

    function _registerAdapter(address adapter, bytes32 configurationDigest, uint16 targetBps, uint16 capBps) internal {
        if (adapter == address(0)) revert ZeroAddress();
        if (_knownAdapters[adapter]) revert AdapterExists();
        if (_configuredAdapters.length >= MAX_ADAPTERS) revert TooManyAdapters();

        _knownAdapters[adapter] = true;
        _enumeratedAdapters[adapter] = true;
        _configuredAdapters.push(adapter);

        adapterInfo[adapter] = AdapterInfo({exists: true, targetBps: targetBps, capBps: capBps});
        adapterConfig[adapter] = VaultTypes.AdapterConfig({
            status: VaultTypes.AdapterStatus.Active,
            capBps: capBps,
            absoluteCap: type(uint256).max,
            maxLossBps: 0,
            accountingCap: type(uint256).max
        });
        adapterConfigurationDigests[adapter] = configurationDigest;

        emit AdapterAdded(adapter, targetBps, capBps);
    }

    function _recognizedStrategyAssets(address adapter) internal view returns (uint256) {
        if (!_knownAdapters[adapter]) return 0;
        if (!_enumeratedAdapters[adapter] && adapterConfig[adapter].status == VaultTypes.AdapterStatus.Removed) {
            return 0;
        }

        try IStrategyAdapter(adapter).totalAssets() returns (uint256 liveAssets) {
            uint256 accountingCap = adapterConfig[adapter].accountingCap;
            if (accountingCap != type(uint256).max && liveAssets > accountingCap) {
                return accountingCap;
            }
            return liveAssets;
        } catch {
            return 0;
        }
    }

    function _liveAssetsAreZero(address adapter) internal view returns (bool) {
        try IStrategyAdapter(adapter).totalAssets() returns (uint256 liveAssets) {
            return liveAssets == 0;
        } catch {
            return false;
        }
    }

    function _isPrunableAdapter(address adapter) internal view returns (bool) {
        return _recognizedStrategyAssets(adapter) == 0 && _liveAssetsAreZero(adapter);
    }

    function _pruneAdapter(address adapter) internal {
        if (!_enumeratedAdapters[adapter]) return;

        _enumeratedAdapters[adapter] = false;
        adapterInfo[adapter].exists = false;

        uint256 adapterCount_ = _configuredAdapters.length;
        for (uint256 i; i < adapterCount_; ++i) {
            if (_configuredAdapters[i] == adapter) {
                _configuredAdapters[i] = _configuredAdapters[adapterCount_ - 1];
                _configuredAdapters.pop();
                break;
            }
        }

        emit AdapterRemoved(adapter);
    }

    function _canIssueShares() internal view returns (bool) {
        uint256 adapterCount_ = _configuredAdapters.length;
        for (uint256 i; i < adapterCount_; ++i) {
            try IStrategyAdapter(_configuredAdapters[i]).totalAssets() returns (uint256) {}
            catch {
                return false;
            }
        }

        if (address(rewardAccountant) != address(0)) {
            try rewardAccountant.recognizedRewardAssets() returns (uint256) {}
            catch {
                return false;
            }
        }

        return true;
    }

    function _syncRewardAccountant(bool issuingShares) internal {
        if (address(rewardAccountant) != address(0)) {
            rewardAccountant.syncForShareAction(issuingShares);
        }
    }

    function _allowedLoss(uint256 amount) internal view returns (uint256) {
        uint256 bpsLoss = (amount * maxLossBps) / 10_000;
        return bpsLoss > 10 ? bpsLoss : 10;
    }
}
