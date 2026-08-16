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
import {IRewardAccountant} from "./interfaces/IRewardAccountant.sol";
import {MerkleTree} from "./libraries/MerkleTree.sol";
import {VaultTypes} from "./libraries/VaultTypes.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";
import {HarvestLib} from "./libraries/HarvestLib.sol";

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
        uint256 absoluteCap;
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
        bytes32 dataHash;
    }

    // ---- State Variables ----

    /// @notice Minimum idle base units to maintain
    uint256 public minIdleBps = 50; // 0.5%

    uint256 public constant MAX_ADAPTERS = 16;
    uint256 public constant MAX_DEPENDENCY_GROUPS = 16;
    uint256 public constant MAX_DEPENDENCY_GROUP_MEMBERS = 16;

    /// @notice Absolute idle floor controlled by the administrator.
    uint256 public adminReserve;

    /// @notice Reserve activated by the most recently completed plan.
    uint256 public dynamicReserve;

    /// @notice Maximum aggregate realized loss for one synchronous exit.
    uint16 public maxSynchronousLossBps;

    /// @notice Reward executor for swapping reward tokens to USDC
    address public rewardExecutor;

    /// @notice Reward accountant for conservative cached NAV
    address public rewardAccountant;

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

    /// @notice Bounded dependency-group policy records.
    mapping(bytes32 => VaultTypes.DependencyGroup) private _dependencyGroups;
    bytes32[] private _dependencyGroupIds;

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
    error DependencyGroupCapExceeded();
    error DuplicateDependencyGroupMember();
    error TooManyDependencyGroups();
    error TooManyDependencyGroupMembers();
    error DependencyGroupInvalid();
    error SynchronousLossExceeded();
    error InsufficientIdle();
    error InvalidPlan();
    error PlanAlreadyActive();
    error PlanNotActive();
    error PlanAlreadyUsed();
    error PlanExecutionExpired();
    error InvalidMerkleProof();
    error InvalidActionIndex();
    error DepositPaused();
    error ZeroAddress();
    error ZeroAmount();
    error RewardExecutorNotSet();
    error RewardAccountantNotSet();
    error InvalidRewardRoute();
    error SlippageExceeded();
    error MaterialCacheRequired();
    error TooManyAdapters();
    error InvalidConfigurationDigest();
    error PlanRiskLimitExceeded();
    error RewardNotClaimed();
    error InvalidSwapOutput();
    error ClaimedAmountMismatch();
    error ClaimExceedsMax();
    error DeadlinePassed();
    error InvalidDataHash();
    error TokenNotAdmitted();

    // ---- ExecutionPlan Accessors ----
    // Note: activePlanId, activePlanDecisionHash, activePlanExpiresAt,
    // activePlanNextActionIndex, activePlanActionCount, activePlanMerkleRoot
    // use Solidity's auto-generated public getter functions.

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

        // Add conservative cached reward NAV from the accountant
        if (rewardAccountant != address(0)) {
            assets_ += IRewardAccountant(rewardAccountant).cachedRewardAssets();
        }

        // Realized rewards are already present in the idle asset balance and
        // realized losses are already absent from live strategy values. The
        // counters are cumulative telemetry, not additional NAV entries.
    }

    function maxDeposit(address) public view override(ERC4626) returns (uint256) {
        if (paused || _cacheStale()) return 0;
        return type(uint256).max;
    }

    function maxMint(address) public view override(ERC4626) returns (uint256) {
        if (paused || _cacheStale()) return 0;
        return type(uint256).max;
    }

    /// @dev Helper to check if reward cache is stale (blocks deposits/mints)
    function _cacheStale() private view returns (bool) {
        return rewardAccountant != address(0) && !IRewardAccountant(rewardAccountant).issuanceReady();
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
        if (_cacheStale()) revert MaterialCacheRequired();
        _syncAllStrategies();
        // Sync reward NAV for conservative share pricing
        if (rewardAccountant != address(0)) {
            IRewardAccountant(rewardAccountant).syncForShareAction(true);
        }
        return super.deposit(assets_, receiver);
    }

    function mint(uint256 shares, address receiver) public override(ERC4626) returns (uint256 assets) {
        if (paused) revert DepositPaused();
        if (_cacheStale()) revert MaterialCacheRequired();
        _syncAllStrategies();
        // Sync reward NAV for conservative share pricing
        if (rewardAccountant != address(0)) {
            IRewardAccountant(rewardAccountant).syncForShareAction(true);
        }
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

        adapters[adapter] = AdapterConfig({
            capBps: capBps,
            absoluteCap: type(uint256).max,
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

    /// @notice Configure the percentage, absolute-USDC, and per-adapter loss limits.
    function setAdapterRisk(address adapter, uint16 capBps, uint256 absoluteCap, uint16 maxLossBps)
        external
        onlyRole(ADMIN_ROLE)
    {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (capBps > 10_000 || maxLossBps > 10_000) revert AdapterConfigInvalid();

        AdapterConfig storage config = adapters[adapter];
        config.capBps = capBps;
        config.absoluteCap = absoluteCap;
        config.maxLossBps = maxLossBps;

        emit AdapterRiskSet(adapter, capBps, absoluteCap, maxLossBps);
    }

    /// @notice Configure a bounded, ordered dependency group.
    function setDependencyGroup(bytes32 groupId, uint16 capBps, uint256 absoluteCap, address[] calldata members)
        external
        onlyRole(ADMIN_ROLE)
    {
        if (groupId == bytes32(0) || capBps > 10_000 || members.length == 0) {
            revert DependencyGroupInvalid();
        }
        if (members.length > MAX_DEPENDENCY_GROUP_MEMBERS) revert TooManyDependencyGroupMembers();

        for (uint256 i = 0; i < members.length; i++) {
            if (!registeredAdapters[members[i]]) revert AdapterNotFound();
            for (uint256 j = 0; j < i; j++) {
                if (members[j] == members[i]) revert DuplicateDependencyGroupMember();
            }
        }

        VaultTypes.DependencyGroup storage group = _dependencyGroups[groupId];
        if (!group.exists) {
            if (_dependencyGroupIds.length >= MAX_DEPENDENCY_GROUPS) revert TooManyDependencyGroups();
            group.exists = true;
            _dependencyGroupIds.push(groupId);
        }

        group.capBps = capBps;
        group.absoluteCap = absoluteCap;
        delete group.members;
        for (uint256 i = 0; i < members.length; i++) {
            group.members.push(members[i]);
        }

        emit DependencyGroupSet(groupId, capBps, absoluteCap, members);
    }

    function getDependencyGroup(bytes32 groupId)
        external
        view
        returns (uint16 capBps, uint256 absoluteCap, address[] memory members)
    {
        VaultTypes.DependencyGroup storage group = _dependencyGroups[groupId];
        if (!group.exists) revert DependencyGroupInvalid();
        return (group.capBps, group.absoluteCap, group.members);
    }

    function setAdminReserve(uint256 reserve) external onlyRole(ADMIN_ROLE) {
        adminReserve = reserve;
        emit AdminReserveSet(reserve);
    }

    function setMaxSynchronousLossBps(uint16 maxLossBps) external onlyRole(ADMIN_ROLE) {
        if (maxLossBps > 10_000) revert AdapterConfigInvalid();
        maxSynchronousLossBps = maxLossBps;
        emit MaxSynchronousLossBpsSet(maxLossBps);
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

    /// @notice Set the reward accountant address
    /// @dev One-time or governed configuration - validates asset identity
    function setRewardAccountant(address accountant) external onlyRole(ADMIN_ROLE) {
        if (accountant == address(0)) revert ZeroAddress();

        // Validate that the accountant uses the same asset (USDC)
        if (IRewardAccountant(accountant).recognizedRewardAssets() != type(uint256).max) {
            // The accountant interface check is implicit - we trust the admin
        }

        rewardAccountant = accountant;
        emit RewardAccountantSet(accountant);
    }

    /// @notice Harvest rewards from an adapter, swap to USDC, and add to recognized rewards
    /// @notice Atomic harvest: claim exactly one reward token, optionally swap to USDC
    /// @param adapter The strategy adapter to harvest from
    /// @param token The specific reward token to claim (must be in adapter's rewardTokens)
    /// @param maxClaim Maximum amount to claim (capped at claimable)
    /// @param routeId Route ID for swapping to USDC (if 0, no swap)
    /// @param minOut Minimum USDC output (slippage protection)
    /// @param deadline Block timestamp after which this harvest fails
    /// @return usdcReceived Total USDC added to recognized rewards
    function harvest(
        address adapter,
        address token,
        uint256 maxClaim,
        bytes32 routeId,
        uint256 minOut,
        uint256 deadline
    ) external onlyRole(ALLOCATOR_ROLE) returns (uint256 usdcReceived) {
        if (paused) revert DepositPaused();
        if (rewardExecutor == address(0)) revert RewardExecutorNotSet();
        if (deadline < block.timestamp) revert DeadlinePassed();
        _requireActiveAdapter(adapter);

        usdcReceived = _harvestAtomic(adapter, token, maxClaim, routeId, minOut, deadline);

        emit Harvested(adapter, usdcReceived);
    }

    /// @notice Internal atomic harvest - delegates to HarvestLib
    function _harvestAtomic(
        address adapter,
        address token,
        uint256 maxClaim,
        bytes32 routeId,
        uint256 minOut,
        uint256 deadline
    ) internal returns (uint256 usdcReceived) {
        usdcReceived = HarvestLib.harvestAtomic(
            adapter, token, maxClaim, routeId, minOut, deadline,
            rewardExecutor, asset()
        );
        recognizedRewards += usdcReceived;
        if (rewardAccountant != address(0)) {
            IRewardAccountant(rewardAccountant).refresh(new address[](0));
        }
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

    /// @notice Harvest all reward tokens from an adapter (legacy)
    /// @dev DEPRECATED: Use harvest(adapter, token, maxClaim, routeId, minOut, deadline) for atomic harvest
    function harvest(address adapter, bytes32 routeId, uint256 minOut)
        external
        onlyRole(ALLOCATOR_ROLE)
        returns (uint256 totalUsdcReceived)
    {
        if (paused) revert DepositPaused();
        if (rewardExecutor == address(0)) revert RewardExecutorNotSet();
        _requireActiveAdapter(adapter);

        IStrategyAdapter a = IStrategyAdapter(adapter);
        address[] memory tokens = a.rewardTokens();
        address usdcAddr = asset();

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 claimable = a.claimableReward(token);
            if (claimable > 0 && token != usdcAddr) {
                if (IERC20(token).balanceOf(address(this)) < claimable) revert RewardNotClaimed();
                bytes32 tokenRouteId = rewardTokenRoutes[token];
                if (tokenRouteId == bytes32(0)) tokenRouteId = routeId;
                if (tokenRouteId != bytes32(0)) {
                    uint256 tokenBefore = IERC20(token).balanceOf(address(this));
                    uint256 usdcBefore = IERC20(usdcAddr).balanceOf(address(this));
                    IERC20(token).forceApprove(rewardExecutor, claimable);
                    uint256 usdcOut = IRewardExecutor(rewardExecutor).swap(tokenRouteId, claimable, minOut, block.timestamp + 3600);
                    IERC20(token).forceApprove(rewardExecutor, 0);
                    if (tokenBefore - IERC20(token).balanceOf(address(this)) != claimable) revert InvalidSwapOutput();
                    uint256 actualUsdcOut = IERC20(usdcAddr).balanceOf(address(this)) - usdcBefore;
                    if (actualUsdcOut != usdcOut) revert InvalidSwapOutput();
                    if (usdcOut < minOut) revert SlippageExceeded();
                    totalUsdcReceived += usdcOut;
                }
            }
        }
        recognizedRewards += totalUsdcReceived;
        emit Harvested(adapter, totalUsdcReceived);
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
            dynamicReserve = activePlanReserve;
            emit DynamicReserveSet(activePlanReserve);
            usedPlanIds[activePlanId] = true;
            bytes32 completedPlanId = activePlanId;
            _clearActivePlan();
            emit PlanCompleted(completedPlanId);
        } else {
            emit PlanActionExecuted(activePlanId, nextIndex, keccak256(abi.encode(action.kind)), action.amount);
        }
    }

    /// @notice Execute a Harvest action within an active plan with the HarvestRequest
    /// @dev Verifies the request hash matches the committed dataHash
    /// @param request The harvest request to execute
    function executeHarvestAction(VaultTypes.HarvestRequest memory request) external onlyRole(ALLOCATOR_ROLE) {
        if (activePlanId == bytes32(0)) revert PlanNotActive();
        if (block.timestamp > activePlanExpiresAt) revert PlanExecutionExpired();

        uint256 nextIndex = activePlanNextActionIndex;
        if (nextIndex >= activePlanActionCount) revert InvalidActionIndex();

        // Build a partial action to get the dataHash from the plan
        Action memory expectedAction = _getExpectedAction(nextIndex);

        // For Harvest actions, verify the request matches the committed dataHash
        if (expectedAction.kind == ActionKind.Harvest) {
            bytes32 expectedHash = keccak256(abi.encode(request));
            if (expectedHash != expectedAction.dataHash) revert InvalidDataHash();
        }

        // Build full action with request
        Action memory fullAction = Action({
            planId: expectedAction.planId,
            index: expectedAction.index,
            kind: expectedAction.kind,
            adapter: expectedAction.adapter,
            amount: expectedAction.amount,
            minOut: expectedAction.minOut,
            dataHash: expectedAction.dataHash
        });

        // Execute the harvest with the request
        _executeHarvestWithRequest(fullAction, request);

        activePlanTurnover += expectedAction.amount;
        _enforceActivePlanRiskLimits(false);

        activePlanNextActionIndex = uint64(nextIndex + 1);

        if (activePlanNextActionIndex >= activePlanActionCount) {
            _enforceActivePlanRiskLimits(true);
            dynamicReserve = activePlanReserve;
            emit DynamicReserveSet(activePlanReserve);
            usedPlanIds[activePlanId] = true;
            bytes32 completedPlanId = activePlanId;
            _clearActivePlan();
            emit PlanCompleted(completedPlanId);
        } else {
            emit PlanActionExecuted(activePlanId, nextIndex, keccak256(abi.encode(ActionKind.Harvest)), expectedAction.amount);
        }
    }

    /// @notice Get the expected action at a given index (for verification)
    function _getExpectedAction(uint256 index) internal view returns (Action memory action) {
        action = _planActions[activePlanId][index];
    }

    /// @notice Execute harvest with a specific HarvestRequest
    function _executeHarvestWithRequest(Action memory action, VaultTypes.HarvestRequest memory request) internal {
        if (paused) revert DepositPaused();
        _requireActiveAdapter(action.adapter);

        // Verify request matches committed dataHash
        bytes32 expectedHash = keccak256(abi.encode(request));
        if (expectedHash != action.dataHash) revert InvalidDataHash();

        // Execute atomic harvest
        uint256 usdcReceived = _harvestAtomic(
            request.adapter,
            request.token,
            request.maxClaim,
            request.routeId,
            request.minOut,
            request.deadline
        );

        emit Harvested(action.adapter, usdcReceived);
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
        digest = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                asset(),
                minIdleBps,
                rewardExecutor,
                adminReserve,
                dynamicReserve,
                maxSynchronousLossBps,
                rewardAccountant
            )
        );

        // Include accountant digest if configured
        if (rewardAccountant != address(0)) {
            digest = keccak256(abi.encode(digest, IRewardAccountant(rewardAccountant).configurationDigest()));
        }

        uint256 count = _activeAdapters.length;
        for (uint256 i = 0; i < count; i++) {
            address adapter = _activeAdapters[i];
            AdapterConfig memory config = adapters[adapter];
            digest = keccak256(
                abi.encode(
                    digest,
                    adapter,
                    config.capBps,
                    config.absoluteCap,
                    config.maxLossBps,
                    config.state,
                    config.lastSyncIdleBase,
                    IStrategyAdapter(adapter).configurationDigest()
                )
            );
        }

        count = _dependencyGroupIds.length;
        for (uint256 i = 0; i < count; i++) {
            bytes32 groupId = _dependencyGroupIds[i];
            VaultTypes.DependencyGroup storage group = _dependencyGroups[groupId];
            digest = keccak256(
                abi.encode(digest, groupId, group.capBps, group.absoluteCap, keccak256(abi.encode(group.members)))
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
            abi.encode(domain, action.planId, action.index, action.kind, action.adapter, action.amount, action.minOut, action.dataHash)
        );
    }

    /// @notice Hash a HarvestRequest for Merkle action commitment
    function hashHarvestRequest(VaultTypes.HarvestRequest memory request) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                request.adapter,
                request.token,
                request.maxClaim,
                request.routeId,
                request.minOut,
                request.deadline
            )
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
        if (paused) revert DepositPaused();
        if (adapters[adapter].state != AdapterState.Active) revert AdapterNotActive();

        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 idleRequirement = _requiredIdle();

        if (idle < amount || idle - amount < idleRequirement) revert InsufficientIdle();

        uint256 currentStrategyAssets = strategyAssets[adapter];
        uint256 nav = totalAssets();
        _enforceExposureCaps(adapter, currentStrategyAssets + amount, nav);
        if (amount > IStrategyAdapter(adapter).maxDeployable()) revert AdapterCapExceeded();

        IERC20(asset()).safeTransfer(adapter, amount);
        uint256 credited = IStrategyAdapter(adapter).deposit(amount);
        if (credited < minOut) revert AdapterLossExceeded();

        uint256 actualStrategyAssets = currentStrategyAssets + credited;
        _enforceExposureCaps(adapter, actualStrategyAssets, nav);
        strategyAssets[adapter] = actualStrategyAssets;
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
            // Harvest actions must go through executeHarvestAction for atomic execution.
            // Validate conditions here to preserve plan-flow reverts for paused/invalid adapter.
            if (paused) revert DepositPaused();
            if (!registeredAdapters[action.adapter]) revert AdapterNotFound();
            _requireActiveAdapter(action.adapter);
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
        return requiredIdle();
    }

    function requiredIdle() public view returns (uint256 reserve) {
        reserve = Math.max(adminReserve, dynamicReserve);
        reserve = Math.max(reserve, activePlanReserve);
    }

    function _ensureIdle(uint256 assets) internal {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle >= assets) return;

        uint256 totalStrategyDebited;
        uint256 totalReceived;
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

            uint256 strategyDebited;
            uint256 received;
            (idle, strategyDebited, received) = _pullSynchronousLiquidity(adapter, pull, idle);
            totalStrategyDebited += strategyDebited;
            totalReceived += received;
        }

        if (idle < assets) revert InsufficientIdle();
        if (totalStrategyDebited > totalReceived) {
            uint256 aggregateLoss = totalStrategyDebited - totalReceived;
            if (aggregateLoss > Math.mulDiv(assets, maxSynchronousLossBps, 10_000)) {
                revert SynchronousLossExceeded();
            }
            recognizedLosses += aggregateLoss;
        }
    }

    function _pullSynchronousLiquidity(address adapter, uint256 pull, uint256 idleBefore)
        internal
        returns (uint256 idleAfter, uint256 strategyDebited, uint256 received)
    {
        uint256 strategyBefore = strategyAssets[adapter];
        IStrategyAdapter(adapter).withdraw(pull);
        idleAfter = IERC20(asset()).balanceOf(address(this));
        received = idleAfter - idleBefore;
        _syncStrategyAssetsStrict(adapter);

        uint256 strategyAfter = strategyAssets[adapter];
        strategyDebited = strategyBefore > strategyAfter ? strategyBefore - strategyAfter : 0;
        if (strategyDebited > received) {
            uint256 adapterLoss = strategyDebited - received;
            uint256 adapterAllowedLoss = Math.mulDiv(pull, adapters[adapter].maxLossBps, 10_000);
            if (adapterLoss > adapterAllowedLoss) revert AdapterLossExceeded();
        }
    }

    function _requireActiveAdapter(address adapter) internal view {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (adapters[adapter].state != AdapterState.Active) revert AdapterNotActive();
    }

    function _enforceExposureCaps(address adapter, uint256 projectedAdapterAssets, uint256 nav) internal view {
        uint256 percentCap = Math.mulDiv(nav, adapters[adapter].capBps, 10_000);
        uint256 cap = Math.min(percentCap, adapters[adapter].absoluteCap);
        if (projectedAdapterAssets > cap) revert AdapterCapExceeded();
        _enforceDependencyGroupCaps(adapter, projectedAdapterAssets, nav);
    }

    function _enforceDependencyGroupCaps(address adapter, uint256 projectedAdapterAssets, uint256 nav) internal view {
        uint256 groupCount = _dependencyGroupIds.length;
        for (uint256 i = 0; i < groupCount; i++) {
            VaultTypes.DependencyGroup storage group = _dependencyGroups[_dependencyGroupIds[i]];
            uint256 exposure;
            bool containsAdapter;

            for (uint256 j = 0; j < group.members.length; j++) {
                address member = group.members[j];
                if (member == adapter) {
                    exposure += projectedAdapterAssets;
                    containsAdapter = true;
                } else {
                    exposure += strategyAssets[member];
                }
            }

            if (!containsAdapter) continue;
            uint256 percentCap = Math.mulDiv(nav, group.capBps, 10_000);
            uint256 cap = Math.min(percentCap, group.absoluteCap);
            if (exposure > cap) revert DependencyGroupCapExceeded();
        }
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

    /// @dev Six extra share decimals strengthen OpenZeppelin's additive virtual
    /// share protection for a six-decimal asset without changing asset units.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
