// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {VaultMath} from "./libraries/VaultMath.sol";

/// @notice Strategy adapter interface
interface IStrategyAdapterVault {
    function vault() external view returns (address);
    function asset() external view returns (address);
    function deposit(uint256 assets) external returns (uint256 credited);
    function withdraw(uint256 assets) external returns (uint256 returned);
    function totalAssets() external view returns (uint256);
    function maxWithdrawable() external view returns (uint256);
    function rewardTokens() external view returns (address[] memory);
    function claimableReward(address token) external view returns (uint256);
}

/// @title NavyVaultSRCLA
/// @notice ERC-4626 vault with staged plan execution for SRCLA
/// @dev Uses ERC20 as base and ERC4626 separately with explicit constructor arguments
contract NavyVaultSRCLA is ERC20, ERC4626, AccessControl {
    using SafeERC20 for IERC20;

    /// @notice Role for vault administration
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice Role for plan execution
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");

    /// @notice Adapter operational state
    enum AdapterState {
        Active,
        Disabled,
        Impaired,
        Removed
    }

    /// @notice Plan action kinds
    enum ActionKind {
        Deploy,
        Divest,
        Harvest,
        EmergencyExit
    }

    /// @notice Adapter configuration
    struct AdapterConfig {
        uint16 capBps;
        uint16 maxLossBps;
        AdapterState state;
        uint256 lastSyncIdleBase;
    }

    /// @notice Action for execution plans
    struct Action {
        ActionKind kind;
        address adapter;
        uint256 amount;
        uint256 minOut;
    }

    // ---- State Variables ----

    /// @notice Minimum idle base units to maintain
    uint256 public minIdleBps = 50; // 0.5%

    /// @notice Recognized rewards from strategies
    uint256 public recognizedRewards;

    /// @notice Recognized losses from strategies
    uint256 public recognizedLosses;

    /// @notice Whether deposits/mints are paused
    bool public paused;

    /// @notice Active plan ID
    bytes32 public activePlanId;

    /// @notice Decision hash for active plan
    bytes32 public activePlanDecisionHash;

    /// @notice Expiration timestamp for active plan
    uint64 public activePlanExpiresAt;

    /// @notice Next action index to execute
    uint64 public activePlanNextActionIndex;

    /// @notice Total actions in active plan
    uint64 public activePlanActionCount;

    /// @notice Tracks used plan IDs for replay protection
    mapping(bytes32 => bool) public usedPlanIds;

    /// @notice Adapter configuration mapping
    mapping(address => AdapterConfig) public adapters;

    /// @notice Tracks if adapter has been registered
    mapping(address => bool) public registeredAdapters;

    /// @notice List of active adapters
    address[] private _activeAdapters;

    /// @notice Tracked strategy assets per adapter
    mapping(address => uint256) public strategyAssets;

    /// @notice Actions in the active plan (keyed by index)
    mapping(bytes32 => mapping(uint256 => Action)) private _planActions;

    // ---- Custom Errors ----

    error AdapterAlreadyRegistered();
    error AdapterNotFound();
    error AdapterNotActive();
    error AdapterAssetMismatch();
    error AdapterVaultMismatch();
    error AdapterConfigInvalid();
    error AdapterNotEmpty();
    error AdapterCapExceeded();
    error AdapterLossExceeded();
    error InsufficientIdle();
    error InsufficientSynchronousLiquidity();
    error InvalidPlan();
    error PlanAlreadyActive();
    error PlanNotActive();
    error PlanExecutionExpired();
    error PlanAlreadyExecuted();
    error InvalidNonce();
    error InvalidActionIndex();
    error DepositPaused();
    error MintPaused();
    error ZeroAddress();
    error ZeroAmount();

    // ---- Events ----

    event AdapterRegistered(
        address indexed adapter,
        string name,
        uint256 capBps,
        uint256 maxLossBps
    );

    event AdapterStateChanged(
        address indexed adapter,
        uint8 state
    );

    event PlanCreated(
        bytes32 indexed planId,
        bytes32 indexed decisionHash,
        uint256 expiresAt
    );

    event PlanActionExecuted(
        bytes32 indexed planId,
        uint256 indexed actionIndex,
        bytes32 kind,
        uint256 amount
    );

    event PlanCompleted(bytes32 indexed planId);
    event PlanCancelled(bytes32 indexed planId);

    event EmergencyExit(
        address indexed adapter,
        uint256 amount
    );

    event Pause();
    event Unpause();

    // ---- ExecutionPlan Accessors ----

    function getActivePlanPlanId() external view returns (bytes32) {
        return activePlanId;
    }

    function getActivePlanDecisionHash() external view returns (bytes32) {
        return activePlanDecisionHash;
    }

    function getActivePlanExpiresAt() external view returns (uint64) {
        return activePlanExpiresAt;
    }

    function getActivePlanUsedNonce() external view returns (uint64) {
        return activePlanNextActionIndex;
    }

    function getActivePlanActionCount() external view returns (uint256) {
        return activePlanActionCount;
    }

    function getActivePlanAction(uint256 index) external view returns (ActionKind kind, address adapter, uint256 amount, uint256 minOut) {
        Action memory action = _planActions[activePlanId][index];
        return (action.kind, action.adapter, action.amount, action.minOut);
    }

    // ---- Constructor ----

    constructor(IERC20 asset_) ERC20("Navy Vault SRCLA", "nvSRCLA") ERC4626(asset_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // ---- ERC20/ERC4626 Overrides ----

    /// @notice Returns vault decimals (inherited from ERC4626)
    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return ERC4626.decimals();
    }

    // ---- ERC4626 Overrides ----

    function totalAssets() public view override(ERC4626) returns (uint256 assets_) {
        assets_ = IERC20(asset()).balanceOf(address(this));

        uint256 adapterCount = _activeAdapters.length;
        for (uint256 i = 0; i < adapterCount; i++) {
            assets_ += strategyAssets[_activeAdapters[i]];
        }

        assets_ += recognizedRewards;

        if (assets_ >= recognizedLosses) {
            assets_ -= recognizedLosses;
        } else {
            assets_ = 0;
        }
    }

    function maxDeposit(address) public view override(ERC4626) returns (uint256) {
        if (paused) return 0;
        return type(uint256).max;
    }

    function maxMint(address) public view override(ERC4626) returns (uint256) {
        if (paused) return 0;
        return type(uint256).max;
    }

    function maxWithdraw(address owner_) public view override(ERC4626) returns (uint256) {
        uint256 claim = convertToAssets(balanceOf(owner_));
        return Math.min(claim, synchronousLiquidity());
    }

    function maxRedeem(address owner_) public view override(ERC4626) returns (uint256) {
        if (paused) return 0;
        uint256 assets = convertToAssets(balanceOf(owner_));
        uint256 shares = _convertToShares(synchronousLiquidity(), Math.Rounding.Floor);
        return Math.min(balanceOf(owner_), shares);
    }

    // ---- ERC4626 Deposit/Mint ----

    function deposit(uint256 assets_, address receiver) public override(ERC4626) returns (uint256 shares) {
        if (paused) revert DepositPaused();
        return super.deposit(assets_, receiver);
    }

    function mint(uint256 shares, address receiver) public override(ERC4626) returns (uint256 assets) {
        if (paused) revert MintPaused();
        return super.mint(shares, receiver);
    }

    // ---- Admin Functions ----

    /// @notice Register a new adapter
    function registerAdapter(
        address adapter,
        uint16 capBps,
        uint16 maxLossBps,
        string calldata name
    ) external onlyRole(ADMIN_ROLE) {
        if (adapter == address(0)) revert ZeroAddress();
        if (adapters[adapter].state != AdapterState.Removed && adapters[adapter].state != AdapterState(0)) {
            revert AdapterAlreadyRegistered();
        }

        IStrategyAdapterVault a = IStrategyAdapterVault(adapter);
        if (a.asset() != asset()) revert AdapterAssetMismatch();
        if (a.vault() != address(this)) revert AdapterVaultMismatch();

        adapters[adapter] = AdapterConfig({
            capBps: capBps,
            maxLossBps: maxLossBps,
            state: AdapterState.Active,
            lastSyncIdleBase: 0
        });

        _activeAdapters.push(adapter);
        strategyAssets[adapter] = 0;
        registeredAdapters[adapter] = true;
        _syncStrategyAssets(adapter);

        emit AdapterRegistered(adapter, name, capBps, maxLossBps);
    }

    /// @notice Set adapter state
    function setAdapterState(address adapter, uint8 state_) external onlyRole(ADMIN_ROLE) {
        AdapterState newState = AdapterState(state_);

        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (newState == AdapterState.Removed) {
            _requireAdapterEmpty(adapter);
        }

        adapters[adapter].state = newState;

        if (newState == AdapterState.Removed) {
            _removeAdapter(adapter);
        }

        emit AdapterStateChanged(adapter, state_);
    }

    /// @notice Set minimum idle bps
    function setMinIdleBps(uint256 bps) external onlyRole(ADMIN_ROLE) {
        minIdleBps = bps;
    }

    /// @notice Pause deposits and mints
    function pause() external onlyRole(ADMIN_ROLE) {
        paused = true;
        emit Pause();
    }

    /// @notice Unpause deposits and mints
    function unpause() external onlyRole(ADMIN_ROLE) {
        paused = false;
        emit Unpause();
    }

    /// @notice Emergency exit all funds from an adapter
    function emergencyExit(address adapter) external onlyRole(ADMIN_ROLE) {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();

        uint256 strategyBalance = strategyAssets[adapter];

        if (strategyBalance > 0) {
            _divest(adapter, strategyBalance, 0);
        }

        emit EmergencyExit(adapter, strategyBalance);
    }

    // ---- Plan Execution Functions ----

    /// @notice Create and activate a new execution plan
    function executePlan(
        bytes32 planId,
        bytes32 decisionHash,
        uint64 expiresAt,
        Action[] calldata actions
    ) external onlyRole(ALLOCATOR_ROLE) {
        if (usedPlanIds[planId]) revert PlanAlreadyExecuted();
        if (activePlanId != bytes32(0)) revert PlanAlreadyActive();
        if (expiresAt < block.timestamp) revert PlanExecutionExpired();
        if (actions.length == 0) revert InvalidPlan();

        // Store actions in the mapping
        for (uint256 i = 0; i < actions.length; i++) {
            _planActions[planId][i] = actions[i];
        }

        activePlanId = planId;
        activePlanDecisionHash = decisionHash;
        activePlanExpiresAt = expiresAt;
        activePlanNextActionIndex = 0;
        activePlanActionCount = uint64(actions.length);

        emit PlanCreated(planId, decisionHash, expiresAt);
    }

    /// @notice Execute the next action in the active plan
    function executeNextAction() external onlyRole(ALLOCATOR_ROLE) {
        if (activePlanId == bytes32(0)) revert PlanNotActive();
        if (block.timestamp > activePlanExpiresAt) revert PlanExecutionExpired();

        uint256 nextIndex = activePlanNextActionIndex;
        if (nextIndex >= activePlanActionCount) revert InvalidActionIndex();

        Action memory action = _planActions[activePlanId][nextIndex];
        _executeAction(action);

        activePlanNextActionIndex = uint64(nextIndex + 1);

        if (activePlanNextActionIndex >= activePlanActionCount) {
            usedPlanIds[activePlanId] = true;
            bytes32 completedPlanId = activePlanId;
            _clearActivePlan();
            emit PlanCompleted(completedPlanId);
        } else {
            emit PlanActionExecuted(
                activePlanId,
                nextIndex,
                keccak256(abi.encode(action.kind)),
                action.amount
            );
        }
    }

    /// @notice Cancel the active plan
    function cancelPlan() external onlyRole(ALLOCATOR_ROLE) {
        if (activePlanId == bytes32(0)) revert PlanNotActive();

        bytes32 planId = activePlanId;
        _clearActivePlan();

        emit PlanCancelled(planId);
    }

    /// @notice Clear the active plan state
    function _clearActivePlan() internal {
        delete activePlanId;
        delete activePlanDecisionHash;
        delete activePlanExpiresAt;
        delete activePlanNextActionIndex;
        delete activePlanActionCount;
    }

    // ---- Internal Helpers ----

    /// @notice Deploy funds to an adapter
    function _deploy(address adapter, uint256 amount, uint256 minOut) internal {
        if (adapters[adapter].state != AdapterState.Active) revert AdapterNotActive();

        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 requiredIdle = _requiredIdle();

        if (idle < amount || idle - amount < requiredIdle) revert InsufficientIdle();

        uint256 currentStrategyAssets = strategyAssets[adapter];
        uint256 nav = totalAssets();
        uint256 cap = Math.mulDiv(nav, adapters[adapter].capBps, 10_000);

        if (currentStrategyAssets + amount > cap) revert AdapterCapExceeded();

        IERC20(asset()).safeTransfer(adapter, amount);
        uint256 credited = IStrategyAdapterVault(adapter).deposit(amount);
        if (credited < minOut) revert AdapterLossExceeded();

        strategyAssets[adapter] += credited;
    }

    /// @notice Divest funds from an adapter
    function _divest(address adapter, uint256 amount, uint256 minOut) internal {
        if (adapters[adapter].state == AdapterState.Removed) revert AdapterNotFound();
        if (
            adapters[adapter].state != AdapterState.Active &&
            adapters[adapter].state != AdapterState.Disabled &&
            adapters[adapter].state != AdapterState.Impaired
        ) {
            revert AdapterNotActive();
        }

        uint256 beforeBalance = IERC20(asset()).balanceOf(address(this));
        uint256 returned = IStrategyAdapterVault(adapter).withdraw(amount);
        uint256 afterBalance = IERC20(asset()).balanceOf(address(this));
        uint256 received = afterBalance - beforeBalance;

        if (received < amount) {
            uint256 loss = amount - received;
            uint256 allowedLoss = Math.mulDiv(amount, adapters[adapter].maxLossBps, 10_000);
            if (loss > allowedLoss) revert AdapterLossExceeded();
            recognizedLosses += loss;
        }

        if (received < minOut) revert AdapterLossExceeded();
        if (strategyAssets[adapter] >= received) {
            strategyAssets[adapter] -= received;
        } else {
            strategyAssets[adapter] = 0;
        }
    }

    /// @notice Harvest rewards from an adapter
    function _harvest(address adapter) internal {
        if (adapters[adapter].state != AdapterState.Active) revert AdapterNotActive();

        IStrategyAdapterVault a = IStrategyAdapterVault(adapter);
        address[] memory tokens = a.rewardTokens();

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 claimable = a.claimableReward(tokens[i]);
            if (claimable > 0) {
                recognizedRewards += claimable;
            }
        }

        _syncStrategyAssets(adapter);
    }

    /// @notice Execute a single action
    function _executeAction(Action memory action) internal {
        if (action.kind == ActionKind.Deploy) {
            _deploy(action.adapter, action.amount, action.minOut);
        } else if (action.kind == ActionKind.Divest) {
            _divest(action.adapter, action.amount, action.minOut);
        } else if (action.kind == ActionKind.Harvest) {
            _harvest(action.adapter);
        } else if (action.kind == ActionKind.EmergencyExit) {
            uint256 balance = strategyAssets[action.adapter];
            if (balance > 0) {
                _divest(action.adapter, balance, action.minOut);
            }
        }
    }

    /// @notice Sync strategy assets from adapter
    function _syncStrategyAssets(address adapter) internal {
        try IStrategyAdapterVault(adapter).totalAssets() returns (uint256 assets_) {
            strategyAssets[adapter] = assets_;
        } catch {
            // Keep existing value on read failure
        }
    }

    /// @notice Remove adapter from active list
    function _removeAdapter(address adapter) internal {
        uint256 count = _activeAdapters.length;
        for (uint256 i = 0; i < count; i++) {
            if (_activeAdapters[i] == adapter) {
                _activeAdapters[i] = _activeAdapters[count - 1];
                _activeAdapters.pop();
                break;
            }
        }
    }

    /// @notice Require adapter is empty before removal
    function _requireAdapterEmpty(address adapter) internal view {
        if (strategyAssets[adapter] != 0) revert AdapterNotEmpty();
    }

    /// @notice Calculate required idle balance
    function _requiredIdle() internal view returns (uint256) {
        return Math.mulDiv(totalAssets(), minIdleBps, 10_000);
    }

    /// @notice Get synchronous liquidity (idle + max withdrawable)
    function synchronousLiquidity() public view returns (uint256) {
        uint256 liquidity = IERC20(asset()).balanceOf(address(this));

        uint256 adapterCount = _activeAdapters.length;
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = _activeAdapters[i];
            if (adapters[adapter].state == AdapterState.Active ||
                adapters[adapter].state == AdapterState.Disabled) {
                // slither-disable-next-line calls-loop
                try IStrategyAdapterVault(adapter).maxWithdrawable() returns (uint256 maxWd) {
                    uint256 assets = strategyAssets[adapter];
                    liquidity += maxWd < assets ? maxWd : assets;
                } catch {
                    liquidity += strategyAssets[adapter];
                }
            }
        }

        return liquidity;
    }

    /// @notice Get list of active adapters
    function getActiveAdapters() external view returns (address[] memory) {
        return _activeAdapters;
    }

    /// @notice Convert shares to assets
    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override(ERC4626) returns (uint256) {
        return VaultMath.convertToShares(assets, totalAssets(), totalSupply(), rounding == Math.Rounding.Ceil);
    }

    /// @notice Convert assets to shares
    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override(ERC4626) returns (uint256) {
        return VaultMath.convertToAssets(shares, totalAssets(), totalSupply());
    }
}
