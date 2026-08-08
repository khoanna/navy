// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IRewardAccountant} from "./interfaces/IRewardAccountant.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";
import {VaultTypes} from "./libraries/VaultTypes.sol";

/// @title NavyVault
/// @dev Immutable Base ERC-4626 core for accounting and adapter lifecycle.
contract NavyVault is ERC4626, ERC20Permit, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct DependencyConfig {
        uint16 capBps;
        uint256 absoluteCap;
        bool configured;
    }

    address public owner;
    address public pendingOwner;
    address public allocator;
    IRewardAccountant public rewardAccountant;
    uint256 public recognizedLosses;
    bool public paused;
    uint256 public adminIdleFloor;
    uint256 public activePlanReserve;

    uint256 public constant MAX_ADAPTERS = 10;
    uint256 public constant LOSS_DUST = 10;

    mapping(address => VaultTypes.AdapterConfig) public adapterConfig;
    mapping(address => uint256) public adapterImpairments;
    mapping(address => bytes32) public adapterConfigurationDigests;
    mapping(address => uint256) public storedStrategyAssets;
    mapping(bytes32 => DependencyConfig) private _dependencyConfig;
    mapping(address => bytes32[]) private _adapterDependencies;
    mapping(address => mapping(bytes32 => bool)) private _adapterDependencyMembership;

    address[] private _configuredAdapters;
    mapping(address => bool) private _knownAdapters;
    mapping(address => bool) private _enumeratedAdapters;

    event AllocatorUpdated(address indexed previousAllocator, address indexed newAllocator);
    event AdapterAdded(address indexed adapter, bytes32 configurationDigest);
    event AdapterRemoved(address indexed adapter);
    event AdapterStatusSet(
        address indexed adapter, VaultTypes.AdapterStatus previousStatus, VaultTypes.AdapterStatus newStatus
    );
    event AdapterLimitsSet(
        address indexed adapter, uint16 capBps, uint256 absoluteCap, uint16 maxLossBps, uint256 accountingCap
    );
    event DependencyCapSet(bytes32 indexed dependencyId, uint16 capBps, uint256 absoluteCap);
    event AdapterDependenciesSet(address indexed adapter, bytes32[] dependencyIds);
    event AdminIdleFloorSet(uint256 previousFloor, uint256 newFloor);
    event RewardAccountantSet(address indexed previousAccountant, address indexed newAccountant);
    event ImpairmentRecorded(
        address indexed adapter, uint256 impairment, uint256 cumulativeImpairment, uint256 recognizedLosses
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PausedSet(bool paused);

    error NotOwner();
    error NotAllocator();
    error ZeroAddress();
    error AdapterExists();
    error UnknownAdapter();
    error AdapterNotEmpty();
    error TooManyAdapters();
    error NotPendingOwner();
    error EnforcedPause();
    error InvalidAdapterAsset();
    error InvalidAdapterVault();
    error InvalidAdapterConfiguration();
    error InvalidAdapterStatus();
    error InvalidDependencyCap();
    error ImpairmentExceedsAssets();
    error UnsafeStrategyAccounting();
    error AdapterCapExceeded();
    error DependencyCapExceeded();
    error DuplicateDependencyGroup();
    error InsufficientSynchronousLiquidity();
    error WithdrawalLossExceeded();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert EnforcedPause();
        _;
    }

    modifier onlyAllocator() {
        if (msg.sender != allocator) revert NotAllocator();
        _;
    }

    constructor(IERC20 asset_, address owner_, address allocator_)
        ERC20("Navy Vault USDC", "navUSDC")
        ERC4626(asset_)
        ERC20Permit("Navy Vault USDC")
    {
        if (address(asset_) == address(0) || owner_ == address(0) || allocator_ == address(0)) {
            revert ZeroAddress();
        }

        owner = owner_;
        allocator = allocator_;
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
        _refreshStrategyAccountingOrRevert();
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
        _refreshStrategyAccountingOrRevert();
        _syncRewardAccountant(true);
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        _refreshStrategyAccountingOrRevert();
        _syncRewardAccountant(false);
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        _refreshStrategyAccountingOrRevert();
        _syncRewardAccountant(false);
        return super.redeem(shares, receiver, owner_);
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

    function setAllocator(address newAllocator) external onlyOwner {
        if (newAllocator == address(0)) revert ZeroAddress();

        address previousAllocator = allocator;
        allocator = newAllocator;
        emit AllocatorUpdated(previousAllocator, newAllocator);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function configuredAdapters() external view returns (address[] memory adapters_) {
        return _configuredAdapters;
    }

    function adapterCount() external view returns (uint256) {
        return _configuredAdapters.length;
    }

    function adapterStatus(address adapter) external view returns (VaultTypes.AdapterStatus) {
        return adapterConfig[adapter].status;
    }

    function strategyAssets(address adapter) external view returns (uint256) {
        return _recognizedStrategyAssets(adapter);
    }

    function effectiveAdapterCap(address adapter) public view returns (uint256) {
        return _effectiveCap(totalAssets(), adapterConfig[adapter].capBps, adapterConfig[adapter].absoluteCap);
    }

    function dependencyCap(bytes32 dependencyId) public view returns (uint256) {
        return _dependencyCap(dependencyId, totalAssets());
    }

    function dependencyExposure(bytes32 dependencyId) public view returns (uint256 exposure_) {
        uint256 adapterCount_ = _configuredAdapters.length;
        for (uint256 i; i < adapterCount_; ++i) {
            address adapter = _configuredAdapters[i];
            if (_adapterDependencyMembership[adapter][dependencyId]) {
                exposure_ += _recognizedStrategyAssets(adapter);
            }
        }
    }

    function requiredIdle() public view returns (uint256) {
        return adminIdleFloor > activePlanReserve ? adminIdleFloor : activePlanReserve;
    }

    function addAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (_knownAdapters[adapter]) revert AdapterExists();
        if (_configuredAdapters.length >= MAX_ADAPTERS) revert TooManyAdapters();
        if (IStrategyAdapter(adapter).asset() != asset()) revert InvalidAdapterAsset();
        if (IStrategyAdapter(adapter).vault() != address(this)) revert InvalidAdapterVault();

        bytes32 configurationDigest = IStrategyAdapter(adapter).configurationDigest();
        if (configurationDigest == bytes32(0)) revert InvalidAdapterConfiguration();

        _knownAdapters[adapter] = true;
        _enumeratedAdapters[adapter] = true;
        _configuredAdapters.push(adapter);

        adapterConfig[adapter] = VaultTypes.AdapterConfig({
            status: VaultTypes.AdapterStatus.Active,
            capBps: 10_000,
            absoluteCap: type(uint256).max,
            maxLossBps: 0,
            accountingCap: type(uint256).max
        });
        adapterConfigurationDigests[adapter] = configurationDigest;
        _refreshStrategyAsset(adapter);

        emit AdapterAdded(adapter, configurationDigest);
    }

    function setAdapterStatus(address adapter, VaultTypes.AdapterStatus status) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();
        if (status == VaultTypes.AdapterStatus.None) revert InvalidAdapterStatus();

        if (status == VaultTypes.AdapterStatus.Removed) {
            if (_recognizedStrategyAssets(adapter) != 0 || !_liveAssetsAreZero(adapter)) revert AdapterNotEmpty();
        }

        VaultTypes.AdapterStatus previousStatus = adapterConfig[adapter].status;
        adapterConfig[adapter].status = status;
        emit AdapterStatusSet(adapter, previousStatus, status);

        if (status == VaultTypes.AdapterStatus.Removed) {
            _pruneAdapter(adapter);
        } else {
            _refreshStrategyAsset(adapter);
        }
    }

    function setAdapterLimits(
        address adapter,
        uint16 capBps,
        uint256 absoluteCap,
        uint16 maxLossBps,
        uint256 accountingCap
    ) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();
        if (capBps > 10_000 || maxLossBps > 10_000) revert InvalidAdapterStatus();
        if (_recognizedStrategyAssets(adapter) > _effectiveCap(totalAssets(), capBps, absoluteCap)) {
            revert AdapterCapExceeded();
        }

        VaultTypes.AdapterConfig storage config = adapterConfig[adapter];
        config.capBps = capBps;
        config.absoluteCap = absoluteCap;
        config.maxLossBps = maxLossBps;
        config.accountingCap = accountingCap;

        _refreshStrategyAsset(adapter);
        emit AdapterLimitsSet(adapter, capBps, absoluteCap, maxLossBps, accountingCap);
    }

    function setDependencyCap(bytes32 dependencyId, uint16 capBps, uint256 absoluteCap) external onlyOwner {
        if (capBps > 10_000) revert InvalidDependencyCap();
        if (dependencyExposure(dependencyId) > _effectiveCap(totalAssets(), capBps, absoluteCap)) {
            revert DependencyCapExceeded();
        }

        _dependencyConfig[dependencyId] = DependencyConfig({capBps: capBps, absoluteCap: absoluteCap, configured: true});
        emit DependencyCapSet(dependencyId, capBps, absoluteCap);
    }

    function setAdapterDependencies(address adapter, bytes32[] calldata dependencyIds) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();

        uint256 dependencyCount_ = dependencyIds.length;
        for (uint256 i; i < dependencyCount_; ++i) {
            for (uint256 j = i + 1; j < dependencyCount_; ++j) {
                if (dependencyIds[i] == dependencyIds[j]) revert DuplicateDependencyGroup();
            }
        }

        bytes32[] storage previousDependencies = _adapterDependencies[adapter];
        uint256 previousCount_ = previousDependencies.length;
        for (uint256 i; i < previousCount_; ++i) {
            _adapterDependencyMembership[adapter][previousDependencies[i]] = false;
        }
        delete _adapterDependencies[adapter];

        for (uint256 i; i < dependencyCount_; ++i) {
            bytes32 dependencyId = dependencyIds[i];
            _adapterDependencyMembership[adapter][dependencyId] = true;
            _adapterDependencies[adapter].push(dependencyId);
        }

        uint256 nav = totalAssets();
        for (uint256 i; i < dependencyCount_; ++i) {
            if (dependencyExposure(dependencyIds[i]) > _dependencyCap(dependencyIds[i], nav)) {
                revert DependencyCapExceeded();
            }
        }

        emit AdapterDependenciesSet(adapter, dependencyIds);
    }

    function setAdminIdleFloor(uint256 newFloor) external onlyOwner {
        uint256 previousFloor = adminIdleFloor;
        adminIdleFloor = newFloor;
        emit AdminIdleFloorSet(previousFloor, newFloor);
    }

    function setRewardAccountant(address accountant) external onlyOwner {
        address previous = address(rewardAccountant);
        rewardAccountant = IRewardAccountant(accountant);
        emit RewardAccountantSet(previous, accountant);
    }

    function recordImpairment(address adapter, uint256 impairment) external onlyOwner {
        if (!_knownAdapters[adapter]) revert UnknownAdapter();

        _refreshStrategyAsset(adapter);
        uint256 currentAssets = _recognizedStrategyAssets(adapter);
        uint256 nextImpairment = adapterImpairments[adapter] + impairment;
        if (nextImpairment > currentAssets) revert ImpairmentExceedsAssets();

        adapterImpairments[adapter] = nextImpairment;
        recognizedLosses += impairment;

        emit ImpairmentRecorded(adapter, impairment, nextImpairment, recognizedLosses);
    }

    function _recognizedStrategyAssets(address adapter) internal view returns (uint256) {
        if (!_knownAdapters[adapter]) return 0;
        if (!_enumeratedAdapters[adapter] && adapterConfig[adapter].status == VaultTypes.AdapterStatus.Removed) {
            return 0;
        }

        (bool ok, uint256 liveAssets) = _readLiveStrategyAssets(adapter);
        if (ok) {
            return _applyAccountingCap(adapter, liveAssets);
        }

        return _applyAccountingCap(adapter, storedStrategyAssets[adapter]);
    }

    function _applyAccountingCap(address adapter, uint256 assets_) internal view returns (uint256) {
        uint256 accountingCap = adapterConfig[adapter].accountingCap;
        if (accountingCap != type(uint256).max && assets_ > accountingCap) {
            return accountingCap;
        }
        return assets_;
    }

    function _refreshStrategyAsset(address adapter) internal {
        (bool ok, uint256 liveAssets) = _readLiveStrategyAssets(adapter);
        if (ok) {
            storedStrategyAssets[adapter] = _applyAccountingCap(adapter, liveAssets);
        }
    }

    function _refreshStrategyAccountingOrRevert() internal {
        uint256 adapterCount_ = _configuredAdapters.length;
        for (uint256 i; i < adapterCount_; ++i) {
            (bool ok, uint256 liveAssets) = _readLiveStrategyAssets(_configuredAdapters[i]);
            if (!ok) revert UnsafeStrategyAccounting();
            storedStrategyAssets[_configuredAdapters[i]] = _applyAccountingCap(_configuredAdapters[i], liveAssets);
        }
    }

    function _readLiveStrategyAssets(address adapter) internal view returns (bool ok, uint256 liveAssets) {
        try IStrategyAdapter(adapter).totalAssets() returns (uint256 assets_) {
            return (true, assets_);
        } catch {
            return (false, 0);
        }
    }

    function _readMaxWithdrawable(address adapter) internal view returns (bool ok, uint256 maxWithdrawable_) {
        try IStrategyAdapter(adapter).maxWithdrawable() returns (uint256 assets_) {
            return (true, assets_);
        } catch {
            return (false, 0);
        }
    }

    function _liveAssetsAreZero(address adapter) internal view returns (bool) {
        (bool ok, uint256 liveAssets) = _readLiveStrategyAssets(adapter);
        return ok && liveAssets == 0;
    }

    function _pruneAdapter(address adapter) internal {
        if (!_enumeratedAdapters[adapter]) return;

        _enumeratedAdapters[adapter] = false;
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
            (bool ok,) = _readLiveStrategyAssets(_configuredAdapters[i]);
            if (!ok) return false;
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

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets) {
            _ensureIdle(assets - idle);
        }
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    function _ensureIdle(uint256 needed) internal {
        uint256 totalRequested;
        uint256 totalReceived;
        uint256 totalAllowedLoss;
        uint256 adapterCount_ = _configuredAdapters.length;

        for (uint256 i; i < adapterCount_ && needed > 0; ++i) {
            address adapter = _configuredAdapters[i];
            (bool ok, uint256 maxWithdrawable_) = _readMaxWithdrawable(adapter);
            if (!ok || maxWithdrawable_ == 0) continue;

            uint16 maxLossBps = adapterConfig[adapter].maxLossBps;
            uint256 requestedAssets = _grossUpForAllowedLoss(needed, maxLossBps);
            if (requestedAssets > maxWithdrawable_) {
                requestedAssets = maxWithdrawable_;
            }
            if (requestedAssets == 0) continue;

            uint256 beforeBalance = IERC20(asset()).balanceOf(address(this));
            try IStrategyAdapter(adapter).withdraw(requestedAssets) returns (uint256 returnedAssets) {
                uint256 receivedAssets = IERC20(asset()).balanceOf(address(this)) - beforeBalance;
                if (receivedAssets != returnedAssets) revert UnsafeStrategyAccounting();

                totalRequested += requestedAssets;
                totalReceived += receivedAssets;
                totalAllowedLoss += _allowedLoss(requestedAssets, maxLossBps);

                if (receivedAssets >= needed) {
                    needed = 0;
                } else {
                    needed -= receivedAssets;
                }
                _refreshStrategyAsset(adapter);
            } catch {
                continue;
            }
        }

        if (totalRequested > totalReceived && totalRequested - totalReceived > totalAllowedLoss) {
            revert WithdrawalLossExceeded();
        }
        if (needed != 0) revert InsufficientSynchronousLiquidity();
    }

    function _effectiveCap(uint256 nav, uint16 capBps, uint256 absoluteCap) internal pure returns (uint256) {
        uint256 bpsCap = Math.mulDiv(nav, capBps, 10_000);
        return Math.min(bpsCap, absoluteCap);
    }

    function _dependencyCap(bytes32 dependencyId, uint256 nav) internal view returns (uint256) {
        DependencyConfig memory config = _dependencyConfig[dependencyId];
        if (!config.configured) return type(uint256).max;
        return _effectiveCap(nav, config.capBps, config.absoluteCap);
    }

    function _checkExposure(address adapter, uint256 projectedAssets, uint256 nav) internal view {
        VaultTypes.AdapterConfig memory config = adapterConfig[adapter];
        if (projectedAssets > _effectiveCap(nav, config.capBps, config.absoluteCap)) {
            revert AdapterCapExceeded();
        }
        _checkEveryDependency(adapter, projectedAssets, nav);
    }

    function _checkEveryDependency(address adapter, uint256 projectedAssets, uint256 nav) internal view {
        bytes32[] storage dependencyIds = _adapterDependencies[adapter];
        uint256 dependencyCount_ = dependencyIds.length;
        uint256 currentAssets = _recognizedStrategyAssets(adapter);

        for (uint256 i; i < dependencyCount_; ++i) {
            bytes32 dependencyId = dependencyIds[i];
            uint256 exposure = dependencyExposure(dependencyId);
            uint256 adjustedExposure = exposure + projectedAssets;
            if (currentAssets <= exposure) {
                adjustedExposure -= currentAssets;
            }
            if (adjustedExposure > _dependencyCap(dependencyId, nav)) revert DependencyCapExceeded();
        }
    }

    function _allowedLoss(uint256 amount, uint16 maxLossBps) internal pure returns (uint256) {
        return Math.max(LOSS_DUST, Math.mulDiv(amount, maxLossBps, 10_000));
    }

    function _grossUpForAllowedLoss(uint256 needed, uint16 maxLossBps) internal pure returns (uint256) {
        if (needed == 0) return 0;
        if (maxLossBps >= 10_000) return type(uint256).max;
        return Math.ceilDiv(needed * 10_000, 10_000 - maxLossBps) + LOSS_DUST;
    }
}
