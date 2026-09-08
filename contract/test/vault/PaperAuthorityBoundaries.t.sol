// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";

/// @dev 6-decimal USDC.
contract ABUsdc {
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "allowance");
            allowance[from][msg.sender] -= amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @notice Adapter whose `sync()` can be made to REVERT and whose live
///         `totalAssets()` can be made to disagree with `sync()`. Both are
///         needed to exercise NEW-22: the defect was that removal trusted a
///         cached figure that a tolerant sync may have left stale-zero.
contract ABAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;

    uint256 public reported;
    uint256 public withdrawable;

    bool public syncReverts;
    /// @dev When set, `sync()` reports this instead of `reported`, so the
    ///      accounted and live figures can be made to disagree.
    bool public syncLies;
    uint256 public syncLieValue;

    constructor(address vault_, address asset_) {
        vaultAddress = vault_;
        assetAddress = asset_;
    }

    function setSyncReverts(bool v) external {
        syncReverts = v;
    }

    function setSyncLie(bool on, uint256 value) external {
        syncLies = on;
        syncLieValue = value;
    }

    function setReported(uint256 v) external {
        reported = v;
        withdrawable = v;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function totalAssets() external view returns (uint256) {
        return reported;
    }

    function sync() external view returns (uint256) {
        require(!syncReverts, "sync down");
        return syncLies ? syncLieValue : reported;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawable;
    }

    function maxDeployable() external pure returns (uint256) {
        return type(uint256).max;
    }

    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(vaultAddress, assetAddress));
    }

    function rewardTokens() external pure returns (address[] memory) {
        return new address[](0);
    }

    function claimableReward(address) external pure returns (uint256) {
        return 0;
    }

    function claimReward(address, uint256, address) external pure returns (uint256) {
        return 0;
    }

    function deposit(uint256 assets) external returns (uint256) {
        reported += assets;
        withdrawable += assets;
        return assets;
    }

    function withdraw(uint256 assets) external returns (uint256) {
        uint256 sent = assets > withdrawable ? withdrawable : assets;
        withdrawable -= sent;
        reported = reported > sent ? reported - sent : 0;
        ABUsdc(assetAddress).transfer(vaultAddress, sent);
        return sent;
    }
}

/// @title PaperAuthorityBoundariesTest
/// @notice NEW-22 (removal must check the live position), NEW-23 (cancel must
///         not lower an in-force reserve) and NEW-24 (divest precedes deploy
///         on chain, not only in the off-chain planner).
contract PaperAuthorityBoundariesTest is Test {
    NavyVaultSRCLA internal vault;
    ABUsdc internal usdc;
    ABAdapter internal adapterA;
    ABAdapter internal adapterB;

    address internal user = address(0xB0B);
    address internal allocator = address(0xA110C);

    uint256 internal _nextPlanId;

    function setUp() public {
        usdc = new ABUsdc();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        adapterA = new ABAdapter(address(vault), address(usdc));
        adapterB = new ABAdapter(address(vault), address(usdc));
        vault.registerAdapter(address(adapterA), 10_000, 2_000, "A");
        vault.registerAdapter(address(adapterB), 10_000, 2_000, "B");
        vault.setMinIdleBps(0);
    }

    // ---- plan helpers (deploys/divests are reachable only via a plan) ----

    function _deposit(uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, user);
        vm.stopPrank();
    }

    function _act(uint256 planId, uint32 index, NavyVaultSRCLA.ActionKind kind, address adapter, uint256 amount)
        internal
        pure
        returns (NavyVaultSRCLA.Action memory)
    {
        return NavyVaultSRCLA.Action({
            planId: planId,
            index: index,
            kind: kind,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });
    }

    function _header(uint256 planId, uint32 actionCount, uint256 reserve)
        internal
        view
        returns (VaultTypes.PlanHeader memory)
    {
        return VaultTypes.PlanHeader({
            planId: planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: actionCount,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256(abi.encode("snapshot", planId)),
            decisionHash: keccak256(abi.encode("decision", planId)),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: reserve,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
    }

    /// @dev Two-leaf Merkle tree over the two actions, so both proofs are the
    ///      sibling leaf. Matches MerkleTree.verifyProof's sorted-pair hashing.
    function _submitTwo(NavyVaultSRCLA.Action memory a0, NavyVaultSRCLA.Action memory a1, uint256 reserve)
        internal
        returns (bytes32 proof0, bytes32 proof1)
    {
        VaultTypes.PlanHeader memory header = _header(a0.planId, 2, reserve);
        bytes32 domain = vault.planDomain(header);
        bytes32 l0 = vault.hashPlanAction(domain, a0);
        bytes32 l1 = vault.hashPlanAction(domain, a1);
        bytes32 root = l0 < l1 ? keccak256(abi.encodePacked(l0, l1)) : keccak256(abi.encodePacked(l1, l0));
        vm.prank(allocator);
        vault.submitPlan(header, root);
        return (l1, l0);
    }

    function _submitOne(NavyVaultSRCLA.Action memory a, uint256 reserve) internal {
        VaultTypes.PlanHeader memory header = _header(a.planId, 1, reserve);
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), a);
        vm.prank(allocator);
        vault.submitPlan(header, leaf);
    }

    function _proofOf(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    // ==================================================================
    // NEW-22 - removal must check the live position, not a cached figure
    // ==================================================================

    /// @notice The defect: `registerAdapter`'s tolerant `_syncStrategyAssets`
    ///         swallows a failing read and leaves the cache at zero. If removal
    ///         trusts that cache, an adapter holding a live position can be
    ///         removed - and it then leaves `_activeAdapters`, so its value
    ///         disappears from `totalAssets()` entirely.
    /// @dev Mutant check: restoring `_requireAdapterEmpty` to the cached-only
    ///      `if (strategyAssets[adapter] != 0) revert` makes this removal
    ///      succeed and both assertions below fail.
    function test_removalIsRejectedWhenTheCacheIsStaleZeroButThePositionIsLive() public {
        ABAdapter fresh = new ABAdapter(address(vault), address(usdc));
        fresh.setSyncReverts(true); // registration's tolerant sync swallows this
        vault.registerAdapter(address(fresh), 10_000, 2_000, "stale");
        assertEq(vault.strategyAssets(address(fresh)), 0, "precondition: the cache is stale-zero");

        // The venue actually holds a position and can report it again.
        fresh.setSyncReverts(false);
        fresh.setReported(500e6);

        vm.expectRevert(NavyVaultSRCLA.AdapterNotEmpty.selector);
        vault.setAdapterState(address(fresh), uint8(NavyVaultSRCLA.AdapterState.Removed));

        // The revert rolls back the refresh, so the cache is still stale here.
        // What matters is the consequence: the adapter is still registered and
        // still in the active set, so the next sync brings its live position
        // back into NAV instead of it having silently vanished with the
        // adapter. Any deposit runs _syncAllStrategies.
        (,,, NavyVaultSRCLA.AdapterState state,,,) = vault.adapters(address(fresh));
        assertEq(uint8(state), uint8(NavyVaultSRCLA.AdapterState.Active), "the adapter must not have been removed");

        _deposit(1e6);
        assertEq(vault.strategyAssets(address(fresh)), 500e6, "the live position is recovered by the next sync");
        assertEq(vault.totalAssets(), 501e6, "and it is counted in NAV");
    }

    /// @notice An adapter that cannot be read at removal time is not evidence
    ///         of emptiness. The strict sync reverts rather than treating an
    ///         unreadable venue as empty.
    function test_removalIsRejectedWhenTheAdapterCannotBeRead() public {
        adapterA.setReported(0);
        adapterA.setSyncReverts(true);

        vm.expectRevert(NavyVaultSRCLA.AdapterConfigInvalid.selector);
        vault.setAdapterState(address(adapterA), uint8(NavyVaultSRCLA.AdapterState.Removed));
    }

    /// @notice Paper 5.1 says ACCOUNTED and LIVE. An adapter whose `sync()`
    ///         reports zero while its own `totalAssets()` still reports a
    ///         position must not be removable on the more convenient figure.
    function test_removalIsRejectedWhenSyncSaysEmptyButTheLiveReadDoesNot() public {
        adapterA.setReported(300e6); // live totalAssets()
        adapterA.setSyncLie(true, 0); // but sync() claims empty

        vm.expectRevert(NavyVaultSRCLA.AdapterNotEmpty.selector);
        vault.setAdapterState(address(adapterA), uint8(NavyVaultSRCLA.AdapterState.Removed));
    }

    /// @notice A genuinely empty adapter is still removable, so the guard is a
    ///         check and not a block.
    function test_aGenuinelyEmptyAdapterIsStillRemovable() public {
        adapterA.setReported(0);
        vault.setAdapterState(address(adapterA), uint8(NavyVaultSRCLA.AdapterState.Removed));
        (,,, NavyVaultSRCLA.AdapterState state,,,) = vault.adapters(address(adapterA));
        assertEq(uint8(state), uint8(NavyVaultSRCLA.AdapterState.Removed), "an empty adapter removes cleanly");
    }

    // ==================================================================
    // NEW-23 - cancelPlan must not lower an in-force reserve
    // ==================================================================

    /// @notice Paper 8.1: an activated dynamic reserve persists; expiry stops
    ///         actions but does not lower the reserve. Paper 4: the allocator
    ///         may not lower limits.
    /// @dev Mutant check: removing the ratchet from `cancelPlan` makes
    ///      `requiredIdle()` fall back to 0 and the final assertion fails.
    function test_cancellingALivePlanCannotLowerTheInForceReserve() public {
        _deposit(10_000e6);

        _submitOne(_act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 1_000e6), 4_000e6);
        assertEq(vault.requiredIdle(), 4_000e6, "the submitted plan's reserve is in force immediately");

        vm.prank(allocator);
        vault.cancelPlan();

        assertEq(vault.requiredIdle(), 4_000e6, "cancelling must not drop the in-force reserve");
        assertEq(vault.dynamicReserve(), 4_000e6, "the reserve is carried into dynamicReserve");
    }

    /// @notice The specific trap NEW-23 names: an EXPIRED plan blocks every
    ///         future plan (`PlanAlreadyActive`), and `cancelPlan` is the only
    ///         way to unblock - so before the ratchet, expiry necessarily
    ///         lowered the reserve.
    function test_clearingAnExpiredPlanDoesNotLowerTheReserve() public {
        _deposit(10_000e6);

        _submitOne(_act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 1_000e6), 3_000e6);
        vm.warp(block.timestamp + 2 hours); // the plan expires

        // A new plan cannot be submitted while the expired one is active.
        // Build the header BEFORE arming expectRevert: `_header` itself calls
        // vault.currentConfigurationDigest(), and both vm.prank and
        // vm.expectRevert bind to the literal next external call - they would
        // have landed on that read instead of on submitPlan.
        VaultTypes.PlanHeader memory next = _header(++_nextPlanId, 1, 0);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanAlreadyActive.selector);
        vault.submitPlan(next, keccak256("root"));

        vm.prank(allocator);
        vault.cancelPlan();

        assertEq(vault.requiredIdle(), 3_000e6, "expiry must not lower the reserve");
    }

    /// @notice The ratchet only ever raises. A cancelled plan whose reserve is
    ///         BELOW the standing dynamic reserve leaves the higher figure in
    ///         place rather than writing the lower one.
    function test_cancellingAPlanWithALowerReserveLeavesTheHigherOneStanding() public {
        _deposit(10_000e6);

        // Complete a plan carrying a 5,000 reserve to set dynamicReserve.
        NavyVaultSRCLA.Action memory a =
            _act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 1_000e6);
        _submitOne(a, 5_000e6);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), a);
        assertEq(vault.dynamicReserve(), 5_000e6, "precondition: a completed plan sets dynamicReserve");

        // Now submit and cancel a plan carrying a LOWER reserve.
        _submitOne(_act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6), 1_000e6);
        vm.prank(allocator);
        vault.cancelPlan();

        assertEq(vault.dynamicReserve(), 5_000e6, "the ratchet must not write a lower reserve");
        assertEq(vault.requiredIdle(), 5_000e6, "the standing reserve is unchanged");
    }

    /// @notice The residual, recorded deliberately: a COMPLETED plan still
    ///         writes its own reserve, including a lower one. That is correct -
    ///         8.1's required idle is candidate-dependent and must fall as
    ///         conditions ease - and it is what keeps the ratchet from being a
    ///         bricking vector. Pinned so the distinction is not lost.
    function test_aCompletedPlanStillSetsItsOwnReserveIncludingALowerOne() public {
        _deposit(10_000e6);

        _submitOne(_act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6), 6_000e6);
        vm.prank(allocator);
        vault.cancelPlan();
        assertEq(vault.dynamicReserve(), 6_000e6, "precondition: the cancel ratcheted the reserve up");

        NavyVaultSRCLA.Action memory a =
            _act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6);
        _submitOne(a, 500e6);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), a);

        assertEq(vault.dynamicReserve(), 500e6, "a completed plan writes its own, lower, reserve");
    }

    // ==================================================================
    // NEW-24 - divestment precedes deployment, on chain
    // ==================================================================

    /// @notice Paper 9.5. `buildPlan` orders `[...divests, ...deploys]` off
    ///         chain, but the vault enforced only a sequential index. A
    ///         deploy-then-divest plan used to execute.
    /// @dev Mutant check: deleting the `_enforceDivestBeforeDeploy` call from
    ///      `executeNextActionWithProof` makes the second action succeed and
    ///      the expectRevert fails.
    function test_aDivestAfterADeployInTheSamePlanIsRejected() public {
        _deposit(10_000e6);

        // Give adapterB a position to divest, through a correctly ordered plan.
        NavyVaultSRCLA.Action memory seed =
            _act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 2_000e6);
        _submitOne(seed, 0);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), seed);

        uint256 planId = ++_nextPlanId;
        NavyVaultSRCLA.Action memory deployFirst =
            _act(planId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 1_000e6);
        NavyVaultSRCLA.Action memory divestSecond =
            _act(planId, 1, NavyVaultSRCLA.ActionKind.Divest, address(adapterB), 500e6);
        (bytes32 proof0, bytes32 proof1) = _submitTwo(deployFirst, divestSecond, 0);

        vm.prank(allocator);
        vault.executeNextActionWithProof(_proofOf(proof0), deployFirst);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanActionOrderInvalid.selector);
        vault.executeNextActionWithProof(_proofOf(proof1), divestSecond);
    }

    /// @notice An EmergencyExit is a divest and is ordered the same way.
    function test_anEmergencyExitAfterADeployInTheSamePlanIsRejected() public {
        _deposit(10_000e6);

        NavyVaultSRCLA.Action memory seed =
            _act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 2_000e6);
        _submitOne(seed, 0);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), seed);

        uint256 planId = ++_nextPlanId;
        NavyVaultSRCLA.Action memory deployFirst =
            _act(planId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 1_000e6);
        NavyVaultSRCLA.Action memory exitSecond =
            _act(planId, 1, NavyVaultSRCLA.ActionKind.EmergencyExit, address(adapterB), 0);
        (bytes32 proof0, bytes32 proof1) = _submitTwo(deployFirst, exitSecond, 0);

        vm.prank(allocator);
        vault.executeNextActionWithProof(_proofOf(proof0), deployFirst);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanActionOrderInvalid.selector);
        vault.executeNextActionWithProof(_proofOf(proof1), exitSecond);
    }

    /// @notice The correctly ordered plan the off-chain planner actually builds
    ///         still runs end to end, so this is an ordering constraint and not
    ///         a block on multi-action plans.
    function test_aDivestThenDeployPlanExecutesNormally() public {
        _deposit(10_000e6);

        NavyVaultSRCLA.Action memory seed =
            _act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 2_000e6);
        _submitOne(seed, 0);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), seed);

        uint256 planId = ++_nextPlanId;
        NavyVaultSRCLA.Action memory divestFirst =
            _act(planId, 0, NavyVaultSRCLA.ActionKind.Divest, address(adapterB), 500e6);
        NavyVaultSRCLA.Action memory deploySecond =
            _act(planId, 1, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 1_000e6);
        (bytes32 proof0, bytes32 proof1) = _submitTwo(divestFirst, deploySecond, 0);

        vm.startPrank(allocator);
        vault.executeNextActionWithProof(_proofOf(proof0), divestFirst);
        vault.executeNextActionWithProof(_proofOf(proof1), deploySecond);
        vm.stopPrank();

        assertEq(vault.strategyAssets(address(adapterA)), 1_000e6, "the deploy ran");
        assertEq(vault.strategyAssets(address(adapterB)), 1_500e6, "the divest ran first");
        assertEq(vault.activePlanId(), bytes32(0), "the plan completed");
    }

    /// @notice The ordering flag is per-plan: a deploy in one plan must not
    ///         block a divest in the next.
    function test_theOrderingFlagIsClearedBetweenPlans() public {
        _deposit(10_000e6);

        NavyVaultSRCLA.Action memory deployOnly =
            _act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 2_000e6);
        _submitOne(deployOnly, 0);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), deployOnly);
        assertFalse(vault.activePlanDeployExecuted(), "the flag is cleared when the plan completes");

        NavyVaultSRCLA.Action memory divestOnly =
            _act(++_nextPlanId, 0, NavyVaultSRCLA.ActionKind.Divest, address(adapterB), 500e6);
        _submitOne(divestOnly, 0);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), divestOnly);

        assertEq(vault.strategyAssets(address(adapterB)), 1_500e6, "the next plan's divest runs");
    }
}
