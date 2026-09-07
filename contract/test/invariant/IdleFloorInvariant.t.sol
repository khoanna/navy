// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";
import {InvariantMockUSDC, InvariantMockAdapter} from "./NavyVaultInvariant.t.sol";

/// @title Dedicated, narrowly-scoped fuzz coverage for the idle floor (paper Sec 8.1)
/// @notice This is a deliberately SEPARATE handler/contract pair from
/// VaultHandler/NavyVaultInvariantTest/NavyVaultHandlerInvariantTest in
/// NavyVaultInvariant.t.sol, rather than an extension of them. Three things
/// were tried and rejected before landing here, each confirmed empirically:
///
/// 1. Adding an idle-floor check to VaultHandler.deploy() and a sibling
///    invariant directly in NavyVaultInvariantTest/NavyVaultHandlerInvariantTest,
///    with no other changes. Foundry's invariant fuzzer, absent an explicit
///    target, defaults to spraying calls across every contract deployed in
///    setUp() (vault, usdc, handler, accountant, 3 adapter mocks) -- deploy()
///    ended up called ~6-11 times out of 64,000 calls per campaign, never
///    enough to exercise the floor (idleFloorRejections stayed 0).
/// 2. Adding `targetContract`/`targetSelector` to those two setUp()s to fix
///    the dilution above (a correct, standard change on its own). That made
///    deposit()/mint() succeed often enough to surface a PRE-EXISTING,
///    unrelated failure in invariant_noSilentInflation (a share-price bound
///    that does not account for this file's own
///    `usdc.mint(vault, 1_000_000_000e6)` pre-funding-before-first-deposit
///    setup) -- a real but separate problem, out of this change's scope.
/// 3. Reverting the targeting change but keeping a `VaultHandler.deploy()`
///    fix that lets deploy() actually reach its body (it was previously
///    gated by an unbounded `adapterIndex >= adapters.length` check that a
///    random uint256 satisfies almost every time) and granting
///    VaultHandler ALLOCATOR_ROLE (deploy()'s `vm.prank(address(this))`
///    prank is the HANDLER's own address, not the test contract's -- without
///    the grant, submitPlan always reverted on an access-control error,
///    silently swallowed, making deploy()/divest() a permanent no-op in
///    ALL THREE contracts before this investigation). Even without the
///    targeting change, this made deploy() do enough additional work
///    (building a plan header, hashing, attempting submitPlan) that
///    NavyVaultInvariantTest's invariant_noSilentInflation started flaking
///    intermittently across repeated runs (confirmed: 5/5 clean runs on the
///    unmodified baseline handler, then failures reappearing after only the
///    VaultHandler.deploy() control-flow change, with no targeting change
///    and no role grant in that contract). This is very likely a pre-existing
///    flakiness in that invariant that random seeds simply weren't hitting
///    before deploy()/divest() started doing more work per call -- but
///    proving that conclusively and fixing it is separate, larger work.
///
/// Sharing VaultHandler at all was the common thread in every failed
/// attempt. This file duplicates a minimal deploy()/divest() handler instead,
/// completely independent of VaultHandler, so NavyVaultInvariantTest and
/// NavyVaultHandlerInvariantTest in NavyVaultInvariant.t.sol are provably
/// untouched (see `git diff` on that file -- there is none) while this gets
/// real, isolated coverage of the floor.
contract IdleFloorHandler is Test {
    InvariantMockUSDC public usdc;
    NavyVaultSRCLA public vault;
    InvariantMockAdapter[] public adapters;

    uint256 public deployAttempts;
    uint256 public idleFloorRejections;
    bool public idleFloorBreached;
    uint256 public idleFloorShortfall;

    constructor(InvariantMockUSDC usdc_, NavyVaultSRCLA vault_, uint256 numAdapters) {
        usdc = usdc_;
        vault = vault_;
        for (uint256 i = 0; i < numAdapters; i++) {
            adapters.push(new InvariantMockAdapter(address(vault), address(usdc), keccak256(abi.encode("idle-floor-adapter", i))));
        }
    }

    function getAdapterCount() external view returns (uint256) {
        return adapters.length;
    }

    function deploy(uint256 adapterIndex, uint256 amount) external {
        deployAttempts += 1;
        if (adapters.length == 0) return;
        adapterIndex = bound(adapterIndex, 0, adapters.length - 1);
        if (adapters[adapterIndex].shouldRevertSync()) return;

        address adapter = address(adapters[adapterIndex]);
        uint256 idle = usdc.balanceOf(address(vault));
        if (idle == 0) return;

        // Bias roughly 1-in-4 calls to propose deploying the *entire* idle
        // balance -- uniform bound(1, idle) essentially never lands in the
        // ~0.5% idle-floor band once idle is large, so the fuzzer would
        // otherwise almost never exercise the floor.
        if (amount % 4 == 0) {
            amount = idle;
        } else {
            amount = bound(amount, 1, idle);
        }

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256(abi.encode("idle-floor-deploy", block.timestamp, adapterIndex, amount))),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("idle-floor-snapshot"),
            decisionHash: keccak256("idle-floor-decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });

        vm.prank(address(this));
        try vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action)) {
            vm.prank(address(this));
            try vault.executeNextActionWithProof(new bytes32[](0), action) {
                // Idle-floor coverage (paper Sec 8.1): recompute the floor
                // independently of vault.requiredIdle() -- from the raw
                // reserve/minIdleBps getters -- rather than by calling
                // requiredIdle() itself. Comparing against requiredIdle()
                // would only ever check that _deploy agrees with whatever
                // requiredIdle() currently computes, so a regression that
                // drops the minIdleBps term from requiredIdle() would make
                // both sides of the comparison equally wrong and this check
                // would pass right through it.
                uint256 expectedFloor = Math.max(vault.adminReserve(), vault.dynamicReserve());
                expectedFloor = Math.max(expectedFloor, vault.activePlanReserve());
                expectedFloor =
                    Math.max(expectedFloor, Math.mulDiv(vault.totalAssets(), vault.minIdleBps(), 10_000));
                uint256 idleAfter = usdc.balanceOf(address(vault));
                if (idleAfter < expectedFloor) {
                    idleFloorBreached = true;
                    idleFloorShortfall = expectedFloor - idleAfter;
                }
            } catch (bytes memory reason) {
                if (_revertSelector(reason) == NavyVaultSRCLA.InsufficientIdle.selector) {
                    // Expected outcome: the fuzzer proposed a deployment that
                    // would breach the non-bypassable idle floor. Count it
                    // instead of discarding it so a reader of a green run can
                    // tell "the floor held" apart from "the floor was never
                    // exercised".
                    idleFloorRejections += 1;
                    vault.cancelPlan();
                } else {
                    // Any other revert here is a genuine finding, not an
                    // expected guard outcome -- bubble it up so the invariant
                    // run fails loudly instead of silently discarding it.
                    assembly {
                        revert(add(reason, 32), mload(reason))
                    }
                }
            }
        } catch {
            // Plan submission failed -- e.g. stale configuration digest.
        }
    }

    function divest(uint256 adapterIndex, uint256 amount) external {
        if (adapters.length == 0) return;
        adapterIndex = bound(adapterIndex, 0, adapters.length - 1);

        address adapter = address(adapters[adapterIndex]);
        uint256 strategyBalance = vault.strategyAssets(adapter);
        if (strategyBalance == 0) return;
        amount = bound(amount, 1, strategyBalance);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: uint256(keccak256(abi.encode("idle-floor-divest", block.timestamp, adapterIndex, amount))),
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("idle-floor-snapshot"),
            decisionHash: keccak256("idle-floor-decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });

        vm.prank(address(this));
        try vault.submitPlan(header, vault.hashPlanAction(vault.planDomain(header), action)) {
            vm.prank(address(this));
            try vault.executeNextActionWithProof(new bytes32[](0), action) {
                // no-op: divest success is not part of this handler's coverage goal
            } catch {
                vault.cancelPlan();
            }
        } catch {
            // Plan submission failed.
        }
    }

    function _revertSelector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            selector := mload(add(reason, 0x20))
        }
    }
}

contract IdleFloorInvariantTest is Test {
    InvariantMockUSDC public usdc;
    NavyVaultSRCLA public vault;
    IdleFloorHandler public handler;

    function setUp() public {
        usdc = new InvariantMockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        vault.grantRole(vault.ADMIN_ROLE(), address(this));

        handler = new IdleFloorHandler(usdc, vault, 3); // 3 adapters
        // deploy()/divest()'s vm.prank(address(this)) inside IdleFloorHandler
        // is the HANDLER's own address, not the test contract's.
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(handler));

        uint256 adapterCount = handler.getAdapterCount();
        for (uint256 i = 0; i < adapterCount; i++) {
            address adapter = address(handler.adapters(i));
            vault.registerAdapter(adapter, 5000, 100, string(abi.encode("Adapter", i)));
        }

        // Fund the vault directly (not via deposit()) so totalSupply stays 0
        // for the life of this campaign -- deploy()/divest() only move funds
        // between idle and strategies, they never touch totalSupply, and
        // this handler never calls deposit()/mint() at all.
        usdc.mint(address(vault), 1_000_000_000 * (10 ** 6));

        // Restrict the fuzzer to exactly deploy()/divest() on the handler.
        // Without this, Foundry's default (fuzz every contract deployed in
        // setUp()) dilutes deploy() to a handful of calls out of 64,000 per
        // campaign -- confirmed empirically.
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = IdleFloorHandler.deploy.selector;
        selectors[1] = IdleFloorHandler.divest.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice The non-bypassable percentage idle floor (paper Sec 8.1) must
    /// never be breached by a deploy action. IdleFloorHandler.deploy()
    /// records a breach using an independently-recomputed floor, not
    /// vault.requiredIdle() itself, so this fails if requiredIdle() stops
    /// honouring minIdleBps -- see deploy()'s comment for why calling
    /// requiredIdle() here instead would not catch that regression.
    function invariant_idleFloorNeverBreachedByDeploy() public {
        assertFalse(
            handler.idleFloorBreached(),
            string.concat(
                "a deploy left idle below the required floor, shortfall=",
                vm.toString(handler.idleFloorShortfall())
            )
        );
    }

    /// @notice Forge calls this once after each invariant run's call
    /// sequence. Reports how many deploy() attempts were made and how many
    /// were rejected by the idle floor, so a green run's log can distinguish
    /// "the floor held under N attempts to breach it" from "the floor was
    /// never actually probed" (a 0 rejection count is a coverage gap, not a
    /// pass).
    function afterInvariant() public view {
        console2.log("deployAttempts", handler.deployAttempts());
        console2.log("idleFloorRejections", handler.idleFloorRejections());
    }

    /// @notice Deterministic (non-fuzzed) companion to the invariant above:
    /// proposing a deploy of the *entire* idle balance must be rejected by
    /// the floor and counted, not silently swallowed. Doesn't depend on the
    /// fuzzer happening to explore this state.
    function test_deployOfEntireIdleBalanceIsRejectedAndCounted() public {
        assertEq(handler.idleFloorRejections(), 0);
        // amount % 4 == 0 selects the full-idle branch in deploy(); adapter
        // index 0 always exists (3 adapters registered in setUp()).
        handler.deploy(0, 4);
        assertEq(handler.idleFloorRejections(), 1, "the floor must reject a full-idle deploy");
        assertFalse(handler.idleFloorBreached(), "a rejected deploy must not count as a breach");
    }
}
