// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev An adapter that can be told to short-change its `withdraw`, so the
///      loss bound on the emergency path is genuinely reachable. `withdraw`
///      pays out of its OWN balance - it never mints - so a test cannot be
///      passed by a mock that auto-credits the vault.
contract EEAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;

    uint256 public reported;
    /// @dev Basis points of the requested amount actually paid back.
    uint16 public payoutBps = 10_000;

    constructor(address vault_, address asset_) {
        vaultAddress = vault_;
        assetAddress = asset_;
    }

    function setPayoutBps(uint16 bps) external {
        payoutBps = bps;
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
        return reported;
    }

    function maxWithdrawable() external view returns (uint256) {
        return reported;
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
        return assets;
    }

    function withdraw(uint256 assets) external returns (uint256) {
        uint256 sent = (assets * payoutBps) / 10_000;
        if (sent > reported) sent = reported;
        reported -= assets > reported ? reported : assets;
        MockUSDC(assetAddress).transfer(vaultAddress, sent);
        return sent;
    }
}

abstract contract AllocatorEmergencyExitBase is Test {
    NavyVaultSRCLA internal vault;
    MockUSDC internal usdc;
    EEAdapter internal adapter;

    address internal user = address(0xB0B);
    address internal allocator = address(0xA110C);
    address internal stranger = address(0xBAD);

    uint256 internal constant DEPOSIT = 10_000e6;
    uint256 internal constant DEPLOYED = 4_000e6;

    uint256 internal _nextPlanId;

    /// @dev Role ids are cached in storage on purpose. `vault.ADMIN_ROLE()` is
    ///      an EXTERNAL call: written inline inside an
    ///      `abi.encodeWithSelector(...)` argument it executes BEFORE the call
    ///      under test and silently absorbs the `vm.prank`/`vm.expectRevert`
    ///      that were meant for it - the "helper makes its own external call"
    ///      trap. Read them once, here, where no cheatcode is armed.
    bytes32 internal ADMIN;
    bytes32 internal ALLOC;
    bytes32 internal DEFAULT_ADMIN;

    function setUp() public {
        usdc = new MockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        ADMIN = vault.ADMIN_ROLE();
        ALLOC = vault.ALLOCATOR_ROLE();
        DEFAULT_ADMIN = vault.DEFAULT_ADMIN_ROLE();
        vault.grantRole(ALLOC, allocator);

        adapter = new EEAdapter(address(vault), address(usdc));
        // 1% loss bound - the same admin-set figure the emergency path must
        // keep honouring after the role widening.
        vault.registerAdapter(address(adapter), 10_000, 100, "EE");
        vault.setMinIdleBps(0);

        usdc.mint(user, DEPOSIT);
        vm.startPrank(user);
        usdc.approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT, user);
        vm.stopPrank();

        _deployToAdapter(DEPLOYED);
    }

    function _action(uint32 index, NavyVaultSRCLA.ActionKind kind, uint256 amount)
        internal
        view
        returns (NavyVaultSRCLA.Action memory)
    {
        return NavyVaultSRCLA.Action({
            planId: _nextPlanId,
            index: index,
            kind: kind,
            adapter: address(adapter),
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });
    }

    function _submitOne(NavyVaultSRCLA.Action memory a) internal {
        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: a.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256(abi.encode("snapshot", a.planId)),
            decisionHash: keccak256(abi.encode("decision", a.planId)),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: type(uint256).max
        });
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), a);
        vm.prank(allocator);
        vault.submitPlan(header, leaf);
    }

    function _deployToAdapter(uint256 amount) internal {
        _nextPlanId++;
        NavyVaultSRCLA.Action memory a = _action(0, NavyVaultSRCLA.ActionKind.Deploy, amount);
        _submitOne(a);
        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), a);
    }
}

/// @title AllocatorEmergencyExitTest
/// @notice NEW-20's contract-side corollary. Paper 4's authority table grants
///         the ALLOCATOR "adapter-to-vault emergency exits" and paper 9.1
///         requires an ineligible market to invoke a bounded safety unwind,
///         but `emergencyExit` was `onlyRole(ADMIN_ROLE)` - so the party that
///         decides an unwind is needed could not perform one. srcla's
///         KeeperExecutor holds only the allocator key and calls exactly this
///         selector.
contract AllocatorEmergencyExitTest is AllocatorEmergencyExitBase {
    event EmergencyExit(address indexed adapter, uint256 amount);

    /// @notice The fix. An allocator key can unwind an adapter on its own.
    /// @dev Mutant check: restoring `onlyRole(ADMIN_ROLE)` makes this revert
    ///      with AccessControlUnauthorizedAccount and the test fails.
    function test_theAllocatorCanEmergencyExitAnAdapter() public {
        uint256 idleBefore = usdc.balanceOf(address(vault));
        assertEq(vault.strategyAssets(address(adapter)), DEPLOYED, "precondition: the adapter holds a position");

        vm.expectEmit(true, false, false, true, address(vault));
        emit EmergencyExit(address(adapter), DEPLOYED);

        vm.prank(allocator);
        vault.emergencyExit(address(adapter));

        assertEq(vault.strategyAssets(address(adapter)), 0, "the adapter is emptied");
        assertEq(usdc.balanceOf(address(vault)), idleBefore + DEPLOYED, "and the funds are back in the vault");
        assertEq(usdc.balanceOf(address(adapter)), 0, "nothing is left behind at the adapter");
    }

    /// @notice The admin lever is not removed by widening the role.
    function test_theAdminCanStillEmergencyExit() public {
        vm.prank(address(this)); // the deployer holds ADMIN_ROLE
        vault.emergencyExit(address(adapter));
        assertEq(vault.strategyAssets(address(adapter)), 0, "the admin path still works");
    }

    /// @notice The widening is to the ALLOCATOR role, not to everyone.
    /// @dev Mutant check: deleting the role check entirely (leaving a bare
    ///      `external`) makes this succeed and the expectRevert fails.
    function test_anAccountWithNeitherRoleStillCannotEmergencyExit() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, ALLOC
            )
        );
        vault.emergencyExit(address(adapter));
    }

    /// @notice Holding shares is not authority. A depositor cannot force an
    ///         unwind of the pool.
    function test_aShareholderCannotEmergencyExit() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, user, ALLOC
            )
        );
        vault.emergencyExit(address(adapter));
    }

    /// @notice Paper 4 forbids the allocator from "transfer[ring] assets to
    ///         itself". The exit's only destination is the vault, and this
    ///         pins that the caller's own balance is untouched.
    function test_theExitSendsNothingToTheAllocatorItself() public {
        assertEq(usdc.balanceOf(allocator), 0, "precondition");

        vm.prank(allocator);
        vault.emergencyExit(address(adapter));

        assertEq(usdc.balanceOf(allocator), 0, "the caller receives nothing");
        assertEq(vault.balanceOf(allocator), 0, "and is issued no shares");
        assertEq(vault.totalAssets(), DEPOSIT, "NAV is unchanged - the assets moved, they did not leave");
    }

    /// @notice The exit is BOUNDED (paper 9.1). The admin-set `maxLossBps`
    ///         still applies, so the widened role is not a lever for accepting
    ///         an arbitrary loss.
    /// @dev Mutant check: dropping the loss branch from `_divest`, or calling
    ///      `_divest(adapter, balance, 0)` with the bound skipped, makes this
    ///      call succeed and the expectRevert fails.
    function test_theExitStillHonoursTheAdaptersAdminSetLossBound() public {
        adapter.setPayoutBps(9_000); // 10% shortfall against a 1% bound

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterLossExceeded.selector);
        vault.emergencyExit(address(adapter));

        assertEq(vault.strategyAssets(address(adapter)), DEPLOYED, "the position is untouched by the failed exit");
    }

    /// @notice A shortfall INSIDE the bound is allowed through and recognized,
    ///         so the previous test is a bound and not a blanket block.
    function test_aShortfallInsideTheBoundIsAllowedAndRecognized() public {
        adapter.setPayoutBps(9_950); // 0.5% shortfall against a 1% bound
        uint256 expectedLoss = (DEPLOYED * 50) / 10_000;

        vm.prank(allocator);
        vault.emergencyExit(address(adapter));

        assertEq(vault.recognizedLosses(), expectedLoss, "the shortfall is recognized, not hidden");
        assertEq(vault.strategyAssets(address(adapter)), 0, "and the adapter is emptied");
    }

    /// @notice The incident cases. A paused vault is exactly when an unwind is
    ///         wanted, and an impaired adapter is exactly what triggers one.
    function test_theExitWorksWhilePausedAndOnAnImpairedAdapter() public {
        vault.setAdapterState(address(adapter), uint8(NavyVaultSRCLA.AdapterState.Impaired));
        vault.pause();

        vm.prank(allocator);
        vault.emergencyExit(address(adapter));

        assertEq(vault.strategyAssets(address(adapter)), 0, "an impaired adapter is unwindable while paused");
    }

    /// @notice An unregistered adapter is not a target.
    function test_theExitRejectsAnUnregisteredAdapter() public {
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
        vault.emergencyExit(address(0xDEAD));
    }
}

/// @notice The other half of paper 4's table: everything in the Forbidden
///         column must still be unreachable from an allocator key after the
///         widening. If any of these starts passing, the blast radius of the
///         change was larger than stated.
contract AllocatorForbiddenColumnTest is AllocatorEmergencyExitBase {
    /// @dev Arms the cheatcode with a PRE-BUILT bytes value. This helper makes
    ///      no external call of its own - see the note on `ADMIN` above.
    function _expectAdminOnly() internal {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, allocator, ADMIN)
        );
    }

    /// @notice "Add adapters" - forbidden.
    function test_theAllocatorStillCannotRegisterAnAdapter() public {
        _expectAdminOnly();
        vm.prank(allocator);
        vault.registerAdapter(address(0xFEED), 10_000, 100, "sneaky");
    }

    /// @notice "Lower limits" - the exposure/loss limits are admin's.
    function test_theAllocatorStillCannotChangeAdapterRisk() public {
        _expectAdminOnly();
        vm.prank(allocator);
        vault.setAdapterRisk(address(adapter), 10_000, type(uint256).max, 10_000, 0);
    }

    /// @notice "Lower limits" - the idle floor is admin's.
    function test_theAllocatorStillCannotLowerTheIdleFloor() public {
        _expectAdminOnly();
        vm.prank(allocator);
        vault.setMinIdleBps(0);
    }

    /// @notice "Lower limits" - the administrator's reserve is admin's.
    function test_theAllocatorStillCannotChangeTheAdminReserve() public {
        _expectAdminOnly();
        vm.prank(allocator);
        vault.setAdminReserve(0);
    }

    /// @notice Admission state (including impairment) is admin/guardian's.
    function test_theAllocatorStillCannotChangeAdapterState() public {
        _expectAdminOnly();
        vm.prank(allocator);
        vault.setAdapterState(address(adapter), uint8(NavyVaultSRCLA.AdapterState.Disabled));
    }

    /// @notice Pause is a guardian lever.
    function test_theAllocatorStillCannotPause() public {
        _expectAdminOnly();
        vm.prank(allocator);
        vault.pause();
    }

    /// @notice "Choose arbitrary calldata or recipients" - route admission and
    ///         the executor address are admin's.
    function test_theAllocatorStillCannotSetTheRewardExecutor() public {
        _expectAdminOnly();
        vm.prank(allocator);
        vault.setRewardExecutor(address(0xFEED));
    }

    /// @notice The role itself cannot be self-granted.
    function test_theAllocatorStillCannotGrantItselfAdmin() public {
        vm.prank(allocator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, allocator, DEFAULT_ADMIN
            )
        );
        vault.grantRole(ADMIN, allocator);
    }
}
