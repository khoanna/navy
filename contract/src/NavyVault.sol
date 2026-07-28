// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IYieldAdapter} from "./interfaces/IYieldAdapter.sol";
import {IEIP3009} from "./interfaces/IEIP3009.sol";

/// @title NavyVault — pooled ERC-4626 farming vault with allocator-driven rebalancing.
/// @dev Shares (navUSDC) are ERC20Permit so redemptions can be relayed gaslessly. Deposits are
/// gasless via EIP-3009 (see depositWithAuthorization). The ALLOCATOR keeper may only move funds
/// between allowlisted adapters under on-chain caps; it can never send funds to an EOA.
contract NavyVault is ERC4626, ERC20Permit, ReentrancyGuard {
    struct AdapterInfo {
        bool exists;
        uint16 targetBps; // desired share of totalAssets (advisory; keeper reads it)
        uint16 capBps; // hard max share of totalAssets this adapter may hold
    }

    address public owner;
    mapping(address => bool) public relayers;
    mapping(address => bool) public allocators;

    address[] public adapters;
    mapping(address => AdapterInfo) public adapterInfo;

    uint256 public constant MAX_ADAPTERS = 10;
    uint256 private constant LOSS_DUST = 10; // absolute base-unit tolerance for protocol floor rounding

    uint16 public minIdleBps; // fraction of totalAssets kept liquid in the vault
    uint16 public maxLossBps; // max acceptable shortfall when pulling from an adapter

    event RelayerSet(address indexed relayer, bool allowed);
    event AllocatorSet(address indexed allocator, bool allowed);
    event AdapterAdded(address indexed adapter, uint16 targetBps, uint16 capBps);
    event AdapterRemoved(address indexed adapter);
    event TargetsSet(address indexed adapter, uint16 targetBps, uint16 capBps);
    event ParamsSet(uint16 minIdleBps, uint16 maxLossBps);
    event Deployed(address indexed adapter, uint256 amount);
    event Divested(address indexed adapter, uint256 received);
    event Reallocated(address indexed from, address indexed to, uint256 amount);

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

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    modifier onlyAllocator() {
        if (!allocators[msg.sender]) revert NotAllocator();
        _;
    }

    constructor(IERC20 _usdc, address _owner)
        ERC20("Navy Vault USDC", "navUSDC")
        ERC4626(_usdc)
        ERC20Permit("Navy Vault USDC")
    {
        if (address(_usdc) == address(0) || _owner == address(0)) revert ZeroAddress();
        owner = _owner;
        maxLossBps = 50; // 0.5% default; owner can still setParams. minIdleBps stays 0.
    }

    // --- ERC-4626 overrides ---

    /// @dev Total assets = idle USDC held by the vault + the sum of every adapter's position.
    function totalAssets() public view override returns (uint256 total) {
        total = IERC20(asset()).balanceOf(address(this));
        uint256 n = adapters.length;
        for (uint256 i; i < n; ++i) {
            try IYieldAdapter(adapters[i]).totalAssets() returns (uint256 a) {
                total += a;
            } catch {
                // A reverting adapter contributes 0 instead of bricking vault-wide accounting.
                // Excise it with forceRemoveAdapter. Conservative: understates NAV, never over.
            }
        }
    }

    /// @dev Virtual-share offset hardens against the ERC-4626 inflation/donation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @dev Required because ERC20 (via ERC4626) and ERC20Permit both sit in the hierarchy.
    function decimals() public view override(ERC4626, ERC20) returns (uint8) {
        return ERC4626.decimals();
    }

    // --- admin ---

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function setAllocator(address allocator, bool allowed) external onlyOwner {
        allocators[allocator] = allowed;
        emit AllocatorSet(allocator, allowed);
    }

    function setParams(uint16 _minIdleBps, uint16 _maxLossBps) external onlyOwner {
        if (_minIdleBps > 10000 || _maxLossBps > 10000) revert BpsTooHigh();
        minIdleBps = _minIdleBps;
        maxLossBps = _maxLossBps;
        emit ParamsSet(_minIdleBps, _maxLossBps);
    }

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    function addAdapter(address adapter, uint16 targetBps, uint16 capBps) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (adapterInfo[adapter].exists) revert AdapterExists();
        if (targetBps > 10000 || capBps > 10000) revert BpsTooHigh();
        if (adapters.length >= MAX_ADAPTERS) revert TooManyAdapters();
        adapterInfo[adapter] = AdapterInfo({exists: true, targetBps: targetBps, capBps: capBps});
        adapters.push(adapter);
        emit AdapterAdded(adapter, targetBps, capBps);
    }

    function setTargets(address adapter, uint16 targetBps, uint16 capBps) external onlyOwner {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        if (targetBps > 10000 || capBps > 10000) revert BpsTooHigh();
        adapterInfo[adapter].targetBps = targetBps;
        adapterInfo[adapter].capBps = capBps;
        emit TargetsSet(adapter, targetBps, capBps);
    }

    function removeAdapter(address adapter) external onlyOwner {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        try IYieldAdapter(adapter).totalAssets() returns (uint256 a) {
            if (a != 0) revert AdapterNotEmpty();
        } catch {
            revert AdapterNotEmpty(); // reverting adapter: use forceRemoveAdapter
        }
        _removeAdapter(adapter);
    }

    /// @dev Owner escape hatch: remove an adapter unconditionally (e.g. its totalAssets reverts,
    /// or its funds are unrecoverable). Any value it still holds is written off from NAV.
    function forceRemoveAdapter(address adapter) external onlyOwner {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        _removeAdapter(adapter);
    }

    function _removeAdapter(address adapter) internal {
        delete adapterInfo[adapter];
        uint256 n = adapters.length;
        for (uint256 i; i < n; ++i) {
            if (adapters[i] == adapter) {
                adapters[i] = adapters[n - 1];
                adapters.pop();
                break;
            }
        }
        emit AdapterRemoved(adapter);
    }

    // --- gasless deposit ---

    /// @dev Gasless deposit. Relayer submits a user's signed EIP-3009 ReceiveWithAuthorization
    /// (to == this vault). USDC's own EIP-712 verification binds user+amount+expiry+nonce, and its
    /// per-nonce authorizationState prevents replay — so the vault needs no separate paid-guard.
    /// Shares are priced on pre-deposit state (previewDeposit before the pull), matching ERC-4626.
    function depositWithAuthorization(
        address user,
        uint256 assets,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRelayer nonReentrant returns (uint256 shares) {
        shares = previewDeposit(assets);
        IEIP3009(asset()).receiveWithAuthorization(user, address(this), assets, validAfter, validBefore, nonce, v, r, s);
        _mint(user, shares);
        emit Deposit(msg.sender, user, assets, shares);
    }

    // --- allocator rebalancing ---

    /// @dev Move idle USDC into an adapter, keeping the minIdle buffer and honoring the adapter cap.
    /// totalAssets is unchanged by this move (idle↓, adapter↑), so caps are measured against a
    /// constant denominator.
    function deployToAdapter(address adapter, uint256 amount) public onlyAllocator nonReentrant {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        uint256 total = totalAssets();
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 minIdle = (total * minIdleBps) / 10000;
        if (amount > idle || idle - amount < minIdle) revert IdleBufferBreached();
        uint256 projected = IYieldAdapter(adapter).totalAssets() + amount;
        if (projected > (total * adapterInfo[adapter].capBps) / 10000) revert CapExceeded();
        IERC20(asset()).transfer(adapter, amount);
        IYieldAdapter(adapter).deposit(amount);
        emit Deployed(adapter, amount);
    }

    /// @dev Pull USDC from an adapter back to the vault, bounding the realized shortfall by maxLossBps.
    function withdrawFromAdapter(address adapter, uint256 amount) public onlyAllocator nonReentrant {
        if (!adapterInfo[adapter].exists) revert UnknownAdapter();
        uint256 before = IERC20(asset()).balanceOf(address(this));
        IYieldAdapter(adapter).withdraw(amount, address(this));
        uint256 received = IERC20(asset()).balanceOf(address(this)) - before;
        if (amount > received && amount - received > _allowedLoss(amount)) revert LossTooHigh();
        emit Divested(adapter, received);
    }

    /// @dev Allowed shortfall on an adapter pull: the larger of a fixed dust tolerance (protocol
    /// floor rounding) and the configured bps of the amount.
    function _allowedLoss(uint256 amount) internal view returns (uint256) {
        uint256 bpsLoss = (amount * maxLossBps) / 10000;
        return bpsLoss > LOSS_DUST ? bpsLoss : LOSS_DUST;
    }

    /// @dev Convenience: divest from one adapter and deploy into another in a single call.
    function reallocate(address from, address to, uint256 amount) external onlyAllocator {
        withdrawFromAdapter(from, amount);
        deployToAdapter(to, amount);
        emit Reallocated(from, to, amount);
    }

    /// @dev Before fulfilling a redemption/withdrawal, top up idle from adapters if needed.
    function _withdraw(address caller, address receiver, address ownerAddr, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets) {
            _ensureIdle(assets - idle);
        }
        super._withdraw(caller, receiver, ownerAddr, assets, shares);
    }

    /// @dev Pull `needed` USDC from adapters in registration order until covered, bounding loss.
    function _ensureIdle(uint256 needed) internal {
        uint256 n = adapters.length;
        for (uint256 i; i < n && needed > 0; ++i) {
            address adapter = adapters[i];
            uint256 have;
            try IYieldAdapter(adapter).totalAssets() returns (uint256 a) {
                have = a;
            } catch {
                continue;
            }
            if (have == 0) continue;
            uint256 pull = have < needed ? have : needed;
            uint256 before = IERC20(asset()).balanceOf(address(this));
            try IYieldAdapter(adapter).withdraw(pull, address(this)) {
                // ok
            } catch {
                continue;
            }
            uint256 received = IERC20(asset()).balanceOf(address(this)) - before;
            if (pull > received && pull - received > _allowedLoss(pull)) revert LossTooHigh();
            needed = received >= needed ? 0 : needed - received;
        }
    }
}
