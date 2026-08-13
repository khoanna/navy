// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IVaultEvents} from "./interfaces/IVaultEvents.sol";
import {IRewardExecutor} from "./interfaces/IRewardExecutor.sol";
import {MerkleTree} from "./libraries/MerkleTree.sol";
import {VaultTypes} from "./libraries/VaultTypes.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";

/// @notice Strategy adapter interface
/// @title NavyVaultSRCLA
/// @notice ERC-4626 vault with staged plan execution for SRCLA
/// @dev Uses ERC20 as base and ERC4626 separately with explicit constructor arguments
contract NavyVaultSRCLA is ERC20, ERC4626, AccessControl, IVaultEvents {
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
        uint256 planId;
        uint32 index;
        ActionKind kind;
        address adapter;
        uint256 amount;
        uint256 minOut;
    }

    // ---- State Variables ----

    /// @notice Minimum idle base units to maintain
    uint256 public minIdleBps = 50; // 0.5%

    uint256 public constant MAX_ADAPTERS = 16;

    /// @notice Reward executor for swapping reward tokens to USDC
    address public rewardExecutor;

    /// @notice Mapping from reward token to route ID for swapping
    mapping(address => bytes32) public rewardTokenRoutes;

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

    /// @notice Merkle root for active plan
    bytes32 public activePlanMerkleRoot;

    /// @notice Domain/configuration commitment for the active Merkle plan.
    bytes32 public activePlanDomain;
    bytes32 public activePlanConfigurationDigest;

    /// @notice Risk limits committed by the active plan header.
    uint256 public activePlanReserve;
    uint256 public activePlanMinFinalAssets;
    uint256 public activePlanMaxRecognizedLoss;
    uint256 public activePlanStartingRecognizedLoss;
    uint256 public activePlanTurnoverLimit;
    uint256 public activePlanTurnover;

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
    error InvalidPlan();
    error PlanAlreadyActive();
    error PlanNotActive();
    error PlanAlreadyUsed();
    error PlanExecutionExpired();
    error PlanAlreadyExecuted();
    error InvalidMerkleProof();
    error InvalidNonce();
    error InvalidActionIndex();
    error DepositPaused();
    error ZeroAddress();
    error ZeroAmount();
    error RewardExecutorNotSet();
    error InvalidRewardRoute();
    error SlippageExceeded();
    error TooManyAdapters();
    error InvalidConfigurationDigest();
    error PlanRiskLimitExceeded();
    error RewardNotClaimed();
    error InvalidSwapOutput();

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

    function getActivePlanMerkleRoot() external view returns (bytes32) {
        return activePlanMerkleRoot;
    }

    function getActivePlanAction(uint256 index)
        external
        view
        returns (uint256 planId, uint32 actionIndex, ActionKind kind, address adapter, uint256 amount, uint256 minOut)
    {
        Action memory action = _planActions[activePlanId][index];
        return (action.planId, action.index, action.kind, action.adapter, action.amount, action.minOut);
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

        // Realized rewards are already present in the idle asset balance and
        // realized losses are already absent from live strategy values. The
        // counters are cumulative telemetry, not additional NAV entries.
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
        uint256 maxSharesFromLiquidity = _convertToShares(synchronousLiquidity(), Math.Rounding.Floor);
        return Math.min(balanceOf(owner_), maxSharesFromLiquidity);
    }

    // ---- ERC4626 Deposit/Mint ----

    function deposit(uint256 assets_, address receiver) public override(ERC4626) returns (uint256 shares) {
        if (paused) revert DepositPaused();
        _syncAllStrategies();
        return super.deposit(assets_, receiver);
    }

    function mint(uint256 shares, address receiver) public override(ERC4626) returns (uint256 assets) {
        if (paused) revert DepositPaused();
        _syncAllStrategies();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets_, address receiver, address owner_)
        public
        override(ERC4626)
        returns (uint256 shares)
    {
        _syncAllStrategies();
        return super.withdraw(assets_, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override(ERC4626)
        returns (uint256 assets_)
    {
        _syncAllStrategies();
        return super.redeem(shares, receiver, owner_);
    }

    /// @notice Preview mint - override to allow when paused
    function previewMint(uint256 shares) public view override(ERC4626) returns (uint256 assets) {
        return _convertToAssets(shares, Math.Rounding.Ceil);
    }

    /// @dev Source strategy liquidity before OpenZeppelin burns shares and
    /// transfers assets. The adapter order is the bounded registry order.
    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        _ensureIdle(assets);
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    // ---- Admin Functions ----

    /// @notice Register a new adapter
    function registerAdapter(address adapter, uint16 capBps, uint16 maxLossBps, string calldata name)
        external
        onlyRole(ADMIN_ROLE)
    {
        if (adapter == address(0)) revert ZeroAddress();
        if (registeredAdapters[adapter]) revert AdapterAlreadyRegistered();
        if (_activeAdapters.length >= MAX_ADAPTERS) revert TooManyAdapters();
        if (capBps > 10_000 || maxLossBps > 10_000) revert AdapterConfigInvalid();

        IStrategyAdapter a = IStrategyAdapter(adapter);
        if (a.asset() != asset()) revert AdapterAssetMismatch();
        if (a.vault() != address(this)) revert AdapterVaultMismatch();

        adapters[adapter] =
            AdapterConfig({capBps: capBps, maxLossBps: maxLossBps, state: AdapterState.Active, lastSyncIdleBase: 0});

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
        if (bps > 10_000) revert AdapterConfigInvalid();
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

    /// @notice Set the reward executor address
    function setRewardExecutor(address executor) external onlyRole(ADMIN_ROLE) {
        if (executor == address(0)) revert ZeroAddress();
        rewardExecutor = executor;
        emit RewardExecutorSet(executor);
    }

    /// @notice Set the route for a reward token
    function setRewardTokenRoute(address token, bytes32 routeId) external onlyRole(ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        if (routeId == bytes32(0)) revert InvalidRewardRoute();
        rewardTokenRoutes[token] = routeId;
        emit RewardTokenRouteSet(token, routeId);
    }

    /// @notice Harvest rewards from an adapter, swap to USDC, and add to recognized rewards
    /// @param adapter The strategy adapter to harvest from
    /// @param routeId The route ID for swapping (used for all reward tokens)
    /// @param minOut Minimum USDC amount to receive per token
    /// @return totalUsdcReceived Total USDC added to recognized rewards
    function harvest(address adapter, bytes32 routeId, uint256 minOut)
        external
        onlyRole(ALLOCATOR_ROLE)
        returns (uint256 totalUsdcReceived)
    {
        if (rewardExecutor == address(0)) revert RewardExecutorNotSet();
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (adapters[adapter].state != AdapterState.Active) revert AdapterNotActive();

        totalUsdcReceived = _harvestCore(adapter, routeId, minOut);

        emit Harvested(adapter, totalUsdcReceived);

        return totalUsdcReceived;
    }

    /// @notice Internal harvest logic - claims rewards, swaps to USDC, adds to recognized rewards
    function _harvestCore(address adapter, bytes32 routeId, uint256 minOut)
        internal
        returns (uint256 totalUsdcReceived)
    {
        IStrategyAdapter a = IStrategyAdapter(adapter);
        address[] memory tokens = a.rewardTokens();

        // Get USDC address
        address usdcAddr = asset();

        // Approve reward executor to pull reward tokens
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 claimable = a.claimableReward(token);

            if (claimable > 0) {
                // Never account or swap a reported amount that is not actually
                // present in the vault.
                if (IERC20(token).balanceOf(address(this)) < claimable) revert RewardNotClaimed();

                // For tokens that go through swap
                if (token != usdcAddr) {
                    // Check if we have a route for this token
                    bytes32 tokenRouteId = rewardTokenRoutes[token];
                    if (tokenRouteId == bytes32(0)) {
                        tokenRouteId = routeId; // Fall back to provided routeId
                    }

                    IERC20(token).forceApprove(rewardExecutor, claimable);

                    // Swap via executor - pass minOut per token (slippage check is done by executor)
                    uint256 rewardBefore = IERC20(token).balanceOf(address(this));
                    uint256 usdcBefore = IERC20(usdcAddr).balanceOf(address(this));
                    uint256 usdcOut = IRewardExecutor(rewardExecutor).swap(tokenRouteId, claimable, minOut);
                    IERC20(token).forceApprove(rewardExecutor, 0);
                    if (rewardBefore - IERC20(token).balanceOf(address(this)) != claimable) {
                        revert InvalidSwapOutput();
                    }
                    uint256 actualUsdcOut = IERC20(usdcAddr).balanceOf(address(this)) - usdcBefore;
                    if (actualUsdcOut != usdcOut) revert InvalidSwapOutput();

                    // Verify slippage protection - executor enforces minOut per swap
                    if (usdcOut < minOut) revert SlippageExceeded();

                    totalUsdcReceived += usdcOut;
                } else {
                    // Token is already USDC, add directly
                    totalUsdcReceived += claimable;
                }
            }
        }

        // Add the received USDC to recognized rewards
        recognizedRewards += totalUsdcReceived;

        _syncStrategyAssets(adapter);
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
    function executePlan(bytes32 planId, bytes32 decisionHash, uint64 expiresAt, Action[] calldata actions)
        external
        onlyRole(ALLOCATOR_ROLE)
    {
        // The legacy unhashed plan path cannot bind chain, vault, asset, or
        // configuration. It is intentionally disabled for production safety.
        planId;
        decisionHash;
        expiresAt;
        actions;
        revert InvalidPlan();
    }

    /// @notice Execute the next action in the active plan
    function executeNextAction() external onlyRole(ALLOCATOR_ROLE) {
        revert InvalidPlan();
    }

    /// @notice Submit a plan with Merkle root for verified execution
    /// @param header Plan header containing plan metadata
    /// @param merkleRoot The Merkle root for action verification
    function submitPlan(VaultTypes.PlanHeader calldata header, bytes32 merkleRoot) external onlyRole(ALLOCATOR_ROLE) {
        bytes32 planId = bytes32(header.planId);
        if (usedPlanIds[planId]) revert PlanAlreadyUsed();
        if (activePlanId != bytes32(0)) revert PlanAlreadyActive();
        if (header.expiresAt < block.timestamp) revert PlanExecutionExpired();
        if (
            planId == bytes32(0) || header.actionCount == 0 || merkleRoot == bytes32(0)
                || header.decisionHash == bytes32(0) || header.snapshotHash == bytes32(0)
                || header.createdAt > block.timestamp || header.expiresAt <= header.createdAt
                || header.snapshotBlockNumber > block.number
        ) revert InvalidPlan();

        bytes32 configurationDigest_ = currentConfigurationDigest();
        if (header.configurationDigest != configurationDigest_) revert InvalidConfigurationDigest();

        activePlanId = planId;
        activePlanDecisionHash = header.decisionHash;
        activePlanExpiresAt = header.expiresAt;
        activePlanActionCount = header.actionCount;
        activePlanMerkleRoot = merkleRoot;
        activePlanDomain = planDomain(header);
        activePlanConfigurationDigest = configurationDigest_;
        activePlanNextActionIndex = 0;
        activePlanReserve = header.reserve;
        activePlanMinFinalAssets = header.minFinalAssets;
        activePlanMaxRecognizedLoss = header.maxRecognizedLoss;
        activePlanStartingRecognizedLoss = recognizedLosses;
        activePlanTurnoverLimit = header.turnoverLimit;
        activePlanTurnover = 0;

        emit PlanSubmitted(planId, merkleRoot);
    }

    /// @notice Execute the next action with Merkle proof verification
    /// @param merkleProof The Merkle proof for the action
    /// @param action The action to execute
    function executeNextActionWithProof(bytes32[] calldata merkleProof, Action calldata action)
        external
        onlyRole(ALLOCATOR_ROLE)
    {
        if (activePlanId == bytes32(0)) revert PlanNotActive();
        if (block.timestamp > activePlanExpiresAt) revert PlanExecutionExpired();
        if (currentConfigurationDigest() != activePlanConfigurationDigest) revert InvalidConfigurationDigest();

        uint256 nextIndex = activePlanNextActionIndex;
        if (nextIndex >= activePlanActionCount) revert InvalidActionIndex();

        // Enforce sequential action execution to prevent out-of-order execution
        if (action.index != nextIndex) revert InvalidActionIndex();
        if (action.planId != uint256(activePlanId)) revert InvalidPlan();

        // Build the action leaf and verify Merkle proof
        bytes32 actionLeaf = hashPlanAction(activePlanDomain, action);
        if (!MerkleTree.verifyProof(actionLeaf, merkleProof, activePlanMerkleRoot)) {
            revert InvalidMerkleProof();
        }

        _executeAction(action);
        activePlanTurnover += action.amount;
        _enforceActivePlanRiskLimits(false);

        activePlanNextActionIndex = uint64(nextIndex + 1);

        if (activePlanNextActionIndex >= activePlanActionCount) {
            _enforceActivePlanRiskLimits(true);
            usedPlanIds[activePlanId] = true;
            bytes32 completedPlanId = activePlanId;
            _clearActivePlan();
            emit PlanCompleted(completedPlanId);
        } else {
            emit PlanActionExecuted(activePlanId, nextIndex, keccak256(abi.encode(action.kind)), action.amount);
        }
    }

    /// @notice Cancel the active plan
    /// @dev Marks plan as used to prevent replay after cancellation
    function cancelPlan() external onlyRole(ALLOCATOR_ROLE) {
        if (activePlanId == bytes32(0)) revert PlanNotActive();

        bytes32 planId = activePlanId;
        usedPlanIds[planId] = true; // Prevent plan replay after cancellation
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
        delete activePlanMerkleRoot;
        delete activePlanDomain;
        delete activePlanConfigurationDigest;
        delete activePlanReserve;
        delete activePlanMinFinalAssets;
        delete activePlanMaxRecognizedLoss;
        delete activePlanStartingRecognizedLoss;
        delete activePlanTurnoverLimit;
        delete activePlanTurnover;
    }

    /// @notice Digest of the vault and registered strategy configuration.
    function currentConfigurationDigest() public view returns (bytes32 digest) {
        digest = keccak256(abi.encode(block.chainid, address(this), asset(), minIdleBps, rewardExecutor));
        uint256 count = _activeAdapters.length;
        for (uint256 i = 0; i < count; i++) {
            address adapter = _activeAdapters[i];
            AdapterConfig memory config = adapters[adapter];
            digest = keccak256(
                abi.encode(
                    digest,
                    adapter,
                    config.capBps,
                    config.maxLossBps,
                    config.state,
                    IStrategyAdapter(adapter).configurationDigest()
                )
            );
        }
    }

    /// @notice Domain hash binding a plan header to this chain, vault and asset.
    function planDomain(VaultTypes.PlanHeader calldata header) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), asset(), keccak256(abi.encode(header))));
    }

    /// @notice Canonical Merkle leaf for a domain-bound plan action.
    function hashPlanAction(bytes32 domain, Action memory action) public pure returns (bytes32) {
        return keccak256(
            abi.encode(domain, action.planId, action.index, action.kind, action.adapter, action.amount, action.minOut)
        );
    }

    function _enforceActivePlanRiskLimits(bool finalCheck) internal view {
        if (IERC20(asset()).balanceOf(address(this)) < activePlanReserve) revert PlanRiskLimitExceeded();
        if (recognizedLosses - activePlanStartingRecognizedLoss > activePlanMaxRecognizedLoss) {
            revert PlanRiskLimitExceeded();
        }
        if (activePlanTurnoverLimit != 0 && activePlanTurnover > activePlanTurnoverLimit) {
            revert PlanRiskLimitExceeded();
        }
        if (finalCheck && totalAssets() < activePlanMinFinalAssets) revert PlanRiskLimitExceeded();
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
        uint256 credited = IStrategyAdapter(adapter).deposit(amount);
        if (credited < minOut) revert AdapterLossExceeded();

        strategyAssets[adapter] += credited;
    }

    /// @notice Divest funds from an adapter
    function _divest(address adapter, uint256 amount, uint256 minOut) internal {
        if (adapters[adapter].state == AdapterState.Removed) revert AdapterNotFound();
        if (
            adapters[adapter].state != AdapterState.Active && adapters[adapter].state != AdapterState.Disabled
                && adapters[adapter].state != AdapterState.Impaired
        ) {
            revert AdapterNotActive();
        }

        uint256 beforeBalance = IERC20(asset()).balanceOf(address(this));
        IStrategyAdapter(adapter).withdraw(amount);
        uint256 afterBalance = IERC20(asset()).balanceOf(address(this));
        uint256 received = afterBalance - beforeBalance;

        if (received < amount) {
            uint256 loss = amount - received;
            uint256 allowedLoss = Math.mulDiv(amount, adapters[adapter].maxLossBps, 10_000);
            if (loss > allowedLoss) revert AdapterLossExceeded();
            recognizedLosses += loss;
        }

        if (received < minOut) revert AdapterLossExceeded();
        _syncStrategyAssetsStrict(adapter);
    }

    /// @notice Execute a single action
    function _executeAction(Action memory action) internal {
        if (action.kind == ActionKind.Deploy) {
            _deploy(action.adapter, action.amount, action.minOut);
        } else if (action.kind == ActionKind.Divest) {
            _divest(action.adapter, action.amount, action.minOut);
        } else if (action.kind == ActionKind.Harvest) {
            // For Harvest action, use the action.amount as the routeId and minOut from action
            // Note: We skip the adapter validation since plan execution already validates
            _harvestCore(action.adapter, bytes32(action.amount), action.minOut);
        } else if (action.kind == ActionKind.EmergencyExit) {
            uint256 balance = strategyAssets[action.adapter];
            if (balance > 0) {
                _divest(action.adapter, balance, action.minOut);
            }
        }
    }

    /// @notice Sync strategy assets from adapter
    function _syncStrategyAssets(address adapter) internal {
        try IStrategyAdapter(adapter).sync() returns (uint256 assets_) {
            strategyAssets[adapter] = assets_;
        } catch {
            // Keep existing value on read failure
        }
    }

    function _syncStrategyAssetsStrict(address adapter) internal {
        try IStrategyAdapter(adapter).sync() returns (uint256 assets_) {
            strategyAssets[adapter] = assets_;
        } catch {
            revert AdapterConfigInvalid();
        }
    }

    function _syncAllStrategies() internal {
        uint256 count = _activeAdapters.length;
        for (uint256 i = 0; i < count; i++) {
            _syncStrategyAssetsStrict(_activeAdapters[i]);
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

    function _ensureIdle(uint256 assets) internal {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle >= assets) return;

        uint256 count = _activeAdapters.length;
        for (uint256 i = 0; i < count && idle < assets; i++) {
            address adapter = _activeAdapters[i];
            AdapterState state = adapters[adapter].state;
            if (state != AdapterState.Active && state != AdapterState.Disabled) continue;

            uint256 available;
            try IStrategyAdapter(adapter).maxWithdrawable() returns (uint256 value) {
                available = Math.min(value, strategyAssets[adapter]);
            } catch {
                continue;
            }
            uint256 needed = assets - idle;
            uint256 pull = Math.min(needed, available);
            if (pull == 0) continue;
            _divest(adapter, pull, pull);
            idle = IERC20(asset()).balanceOf(address(this));
        }

        if (idle < assets) revert InsufficientIdle();
    }

    /// @notice Get synchronous liquidity (idle + max withdrawable)
    function synchronousLiquidity() public view returns (uint256) {
        uint256 liquidity = IERC20(asset()).balanceOf(address(this));

        uint256 adapterCount = _activeAdapters.length;
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = _activeAdapters[i];
            if (adapters[adapter].state == AdapterState.Active || adapters[adapter].state == AdapterState.Disabled) {
                // slither-disable-next-line calls-loop
                try IStrategyAdapter(adapter).maxWithdrawable() returns (uint256 maxWd) {
                    uint256 assets = strategyAssets[adapter];
                    liquidity += maxWd < assets ? maxWd : assets;
                } catch {
                    // A failed liquidity read is not evidence of available liquidity.
                }
            }
        }

        return liquidity;
    }

    /// @notice Get list of active adapters
    function getActiveAdapters() external view returns (address[] memory) {
        return _activeAdapters;
    }

    /// @dev Six extra share decimals strengthen OpenZeppelin's additive virtual
    /// share protection for a six-decimal asset without changing asset units.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
