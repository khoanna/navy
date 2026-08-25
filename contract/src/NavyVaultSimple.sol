// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title NavyVaultSimple - Minimal ERC-4626 vault for SRCLA testing
/// @notice Simplified version without full Merkle/plan complexity
contract NavyVaultSimple is ERC20, ERC4626, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");

    enum AdapterState { Active, Disabled, Impaired, Removed }

    struct AdapterConfig {
        uint16 capBps;
        uint256 absoluteCap;
        uint16 maxLossBps;
        AdapterState state;
    }

    // State
    uint256 public minIdleBps = 50;
    uint256 public adminReserve;
    uint256 public dynamicReserve;
    address public rewardExecutor;
    address public rewardAccountant;
    bool public paused;
    uint256 public maxSynchronousLossBps = 100;

    mapping(address => AdapterConfig) public adapters;
    mapping(address => bool) public registeredAdapters;
    address[] private _activeAdapters;
    mapping(address => uint256) public strategyAssets;

    // Plan execution
    bytes32 public activePlanId;
    bytes32 public activePlanMerkleRoot;
    uint64 public activePlanExpiresAt;
    uint64 public activePlanNextActionIndex;
    uint64 public activePlanActionCount;

    mapping(bytes32 => bool) public usedPlanIds;

    // Errors
    error AdapterAlreadyRegistered();
    error AdapterNotFound();
    error AdapterNotActive();
    error AdapterCapExceeded();
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
    error TooManyAdapters();
    error SynchronousLossExceeded();

    // Events
    event AdapterRegistered(address indexed adapter, uint16 capBps, uint16 maxLossBps);
    event PlanSubmitted(bytes32 indexed planId, bytes32 merkleRoot);
    event ActionExecuted(uint256 indexed planId, uint32 indexed actionIndex);
    event PlanCompleted(bytes32 indexed planId);
    event FundsDeployed(address indexed adapter, uint256 amount);
    event FundsDivested(address indexed adapter, uint256 amount);

    constructor(IERC20 asset_) ERC20("Navy Vault Simple", "nvSimple") ERC4626(asset_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return 6; // USDC decimals
    }

    function totalAssets() public view override(ERC4626) returns (uint256) {
        uint256 assets = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < _activeAdapters.length; i++) {
            assets += strategyAssets[_activeAdapters[i]];
        }
        return assets;
    }

    function maxDeposit(address) public view override(ERC4626) returns (uint256) {
        return paused ? 0 : type(uint256).max;
    }

    function maxMint(address) public view override(ERC4626) returns (uint256) {
        return paused ? 0 : type(uint256).max;
    }

    function maxWithdraw(address owner_) public view override(ERC4626) returns (uint256) {
        return Math.min(convertToAssets(balanceOf(owner_)), synchronousLiquidity());
    }

    function synchronousLiquidity() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function deposit(uint256 assets_, address receiver) public override(ERC4626) returns (uint256 shares) {
        if (paused) revert DepositPaused();
        return super.deposit(assets_, receiver);
    }

    function mint(uint256 shares, address receiver) public override(ERC4626) returns (uint256 assets) {
        if (paused) revert DepositPaused();
        return super.mint(shares, receiver);
    }

    function _withdraw(address, address receiver, address, uint256 assets, uint256)
        internal override
    {
        IERC20(asset()).safeTransfer(receiver, assets);
    }

    // ---- Admin ----

    function registerAdapter(address adapter, uint16 capBps, uint16 maxLossBps) external onlyRole(ADMIN_ROLE) {
        if (adapter == address(0)) revert ZeroAddress();
        if (registeredAdapters[adapter]) revert AdapterAlreadyRegistered();
        if (_activeAdapters.length >= 16) revert TooManyAdapters();

        adapters[adapter] = AdapterConfig({
            capBps: capBps,
            absoluteCap: type(uint256).max,
            maxLossBps: maxLossBps,
            state: AdapterState.Active
        });

        _activeAdapters.push(adapter);
        registeredAdapters[adapter] = true;
        strategyAssets[adapter] = 0;

        emit AdapterRegistered(adapter, capBps, maxLossBps);
    }

    function setAdapterState(address adapter, uint8 state_) external onlyRole(ADMIN_ROLE) {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        adapters[adapter].state = AdapterState(state_);
    }

    function setMinIdleBps(uint256 bps) external onlyRole(ADMIN_ROLE) {
        minIdleBps = bps;
    }

    function setAdminReserve(uint256 reserve) external onlyRole(ADMIN_ROLE) {
        adminReserve = reserve;
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        paused = true;
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        paused = false;
    }

    function setRewardExecutor(address executor) external onlyRole(ADMIN_ROLE) {
        rewardExecutor = executor;
    }

    // ---- Plan Execution ----

    /// @notice Submit a plan with Merkle root
    function submitPlan(
        uint256 planId,
        bytes32 merkleRoot,
        uint64 expiresAt,
        uint64 actionCount
    ) external onlyRole(ALLOCATOR_ROLE) {
        if (usedPlanIds[bytes32(planId)]) revert PlanAlreadyUsed();
        if (activePlanId != bytes32(0)) revert PlanAlreadyActive();
        if (expiresAt < block.timestamp) revert PlanExecutionExpired();
        if (planId == 0 || actionCount == 0 || merkleRoot == bytes32(0)) revert InvalidPlan();

        activePlanId = bytes32(planId);
        activePlanMerkleRoot = merkleRoot;
        activePlanExpiresAt = expiresAt;
        activePlanActionCount = actionCount;
        activePlanNextActionIndex = 0;

        emit PlanSubmitted(bytes32(planId), merkleRoot);
    }

    /// @notice Execute an action with Merkle proof
    function executeAction(
        uint256 planId,
        uint32 actionIndex,
        uint8 kind, // 0=Deploy, 1=Divest
        address adapter,
        uint256 amount,
        uint256 minOut,
        bytes32 dataHash,
        bytes32[] calldata proof
    ) external onlyRole(ALLOCATOR_ROLE) {
        if (activePlanId != bytes32(planId)) revert PlanNotActive();
        if (block.timestamp > activePlanExpiresAt) revert PlanExecutionExpired();
        if (actionIndex != activePlanNextActionIndex) revert InvalidActionIndex();

        // Build Merkle leaf
        bytes32 leaf = keccak256(abi.encodePacked(
            actionIndex,
            kind,
            adapter,
            amount,
            minOut,
            dataHash
        ));

        // Verify proof
        if (!_verifyProof(leaf, proof, activePlanMerkleRoot)) revert InvalidMerkleProof();

        // Execute
        if (kind == 0) {
            _deploy(adapter, amount, minOut);
        } else if (kind == 1) {
            _divest(adapter, amount, minOut);
        }

        activePlanNextActionIndex++;

        emit ActionExecuted(planId, actionIndex);

        // Check if plan complete
        if (activePlanNextActionIndex >= activePlanActionCount) {
            usedPlanIds[activePlanId] = true;
            emit PlanCompleted(activePlanId);
            delete activePlanId;
            delete activePlanMerkleRoot;
            delete activePlanExpiresAt;
            delete activePlanNextActionIndex;
            delete activePlanActionCount;
        }
    }

    function _verifyProof(bytes32 leaf, bytes32[] memory proof, bytes32 root) internal pure returns (bool) {
        bytes32 current = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            if (current < proof[i]) {
                current = keccak256(abi.encodePacked(current, proof[i]));
            } else {
                current = keccak256(abi.encodePacked(proof[i], current));
            }
        }
        return current == root;
    }

    function _deploy(address adapter, uint256 amount, uint256) internal {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (adapters[adapter].state != AdapterState.Active) revert AdapterNotActive();

        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 idleRequirement = (totalAssets() * minIdleBps) / 10_000;
        if (idle < amount + idleRequirement) revert InsufficientIdle();

        IERC20(asset()).safeTransfer(adapter, amount);
        strategyAssets[adapter] += amount;

        emit FundsDeployed(adapter, amount);
    }

    function _divest(address adapter, uint256 amount, uint256) internal {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (strategyAssets[adapter] < amount) revert AdapterCapExceeded();

        IERC20(asset()).safeTransfer(adapter, amount);
        strategyAssets[adapter] -= amount;

        emit FundsDivested(adapter, amount);
    }

    // For testing: allow direct deposit to adapter
    function testDepositToAdapter(address adapter, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        IERC20(asset()).safeTransfer(adapter, amount);
        strategyAssets[adapter] += amount;
    }

    // For testing: allow direct withdrawal from adapter
    function testWithdrawFromAdapter(address adapter, uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (!registeredAdapters[adapter]) revert AdapterNotFound();
        if (strategyAssets[adapter] < amount) revert AdapterCapExceeded();
        IERC20(asset()).safeTransfer(adapter, amount);
        strategyAssets[adapter] -= amount;
    }
}
