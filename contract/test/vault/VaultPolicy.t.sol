// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";

contract PolicyUSDC {
    string public constant name = "USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "burn exceeds balance");
        balanceOf[from] -= amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "insufficient allowance");
        allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract PolicyAdapter {
    address public immutable vault;
    address public immutable asset;
    bytes32 public immutable configurationDigest;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    uint256 public shortfallOnNextWithdraw;
    uint256 public positionLossOnNextWithdraw;
    uint256 public positionDebitReductionOnNextWithdraw;
    uint256 public deployableAssets = type(uint256).max;
    uint256 public creditBonus;

    /// @dev Once a test has explicitly pinned withdrawableAssets (via
    /// setWithdrawable/setMaxWithdrawable), deposit() stops auto-crediting it
    /// so the pinned value is what the vault observes immediately after
    /// depositing — the scenario the liquidity-floor guard exists to check
    /// (a venue that takes a deposit without returning matching exit
    /// capacity). Tests that never pin it keep the old auto-credit behaviour.
    bool private _withdrawablePinned;

    constructor(address vault_, address asset_, bytes32 configurationDigest_) {
        vault = vault_;
        asset = asset_;
        configurationDigest = configurationDigest_;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "only vault");
        _;
    }

    function setWithdrawable(uint256 amount) external {
        withdrawableAssets = amount;
        _withdrawablePinned = true;
    }

    /// @dev Alias matching the paper-brief naming; same pinning semantics as setWithdrawable.
    function setMaxWithdrawable(uint256 amount) external {
        withdrawableAssets = amount;
        _withdrawablePinned = true;
    }

    function setShortfallOnNextWithdraw(uint256 amount) external {
        shortfallOnNextWithdraw = amount;
    }

    function setPositionLossOnNextWithdraw(uint256 amount) external {
        positionLossOnNextWithdraw = amount;
    }

    function setPositionDebitReductionOnNextWithdraw(uint256 amount) external {
        positionDebitReductionOnNextWithdraw = amount;
    }

    function setMaxDeployable(uint256 amount) external {
        deployableAssets = amount;
    }

    function setCreditBonus(uint256 amount) external {
        creditBonus = amount;
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        credited = assets + creditBonus;
        reportedAssets += credited;
        if (!_withdrawablePinned) {
            withdrawableAssets += assets;
        }
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
        uint256 requested = assets < withdrawableAssets ? assets : withdrawableAssets;
        uint256 shortfall = shortfallOnNextWithdraw < requested ? shortfallOnNextWithdraw : requested;
        uint256 positionLoss = positionLossOnNextWithdraw;
        uint256 debitReduction = positionDebitReductionOnNextWithdraw;
        shortfallOnNextWithdraw = 0;
        positionLossOnNextWithdraw = 0;
        positionDebitReductionOnNextWithdraw = 0;

        returnedAssets = requested - shortfall;
        uint256 debit = requested + positionLoss;
        if (debitReduction > debit) debitReduction = debit;
        debit -= debitReduction;
        if (debit > reportedAssets) debit = reportedAssets;
        uint256 realizedLoss = debit > returnedAssets ? debit - returnedAssets : 0;

        reportedAssets -= debit;
        withdrawableAssets -= requested;
        if (realizedLoss != 0) PolicyUSDC(asset).burn(address(this), realizedLoss);
        PolicyUSDC(asset).transfer(vault, returnedAssets);
    }

    function totalAssets() external view returns (uint256) {
        return reportedAssets;
    }

    function sync() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function maxDeployable() external view returns (uint256) {
        return deployableAssets;
    }

    function rewardTokens() external pure returns (address[] memory tokens) {
        tokens = new address[](0);
    }

    function claimableReward(address) external pure returns (uint256) {
        return 0;
    }
}

contract VaultPolicyTest is Test {
    PolicyUSDC internal usdc;
    NavyVaultSRCLA internal vault;
    PolicyAdapter internal adapterA;
    PolicyAdapter internal adapterB;

    address internal allocator = address(0xA110CA7E);
    address internal alice = address(0xA11CE);

    /// @dev Counter for helper-generated plan IDs, kept well clear of the
    /// hand-picked IDs (1-30) used by the tests above.
    uint256 private _nextHelperPlanId = 900;

    function setUp() public {
        usdc = new PolicyUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        adapterA = new PolicyAdapter(address(vault), address(usdc), keccak256("adapter-a"));
        adapterB = new PolicyAdapter(address(vault), address(usdc), keccak256("adapter-b"));

        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
        vault.registerAdapter(address(adapterA), 10_000, 2_000, "Adapter A");
        vault.registerAdapter(address(adapterB), 10_000, 2_000, "Adapter B");
        vault.setMinIdleBps(0);
    }

    function _deposit(uint256 amount) internal {
        usdc.mint(alice, amount);
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, alice);
        vm.stopPrank();
    }

    function _action(uint256 planId, NavyVaultSRCLA.ActionKind kind, address adapter, uint256 amount)
        internal
        pure
        returns (NavyVaultSRCLA.Action memory)
    {
        return NavyVaultSRCLA.Action({
            planId: planId,
            index: 0,
            kind: kind,
            adapter: adapter,
            amount: amount,
            minOut: 0,
            dataHash: bytes32(0)
        });
    }

    function _header(uint256 planId, uint256 reserve) internal view returns (VaultTypes.PlanHeader memory) {
        return VaultTypes.PlanHeader({
            planId: planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours),
            actionCount: 1,
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

    function _submitAndExecute(NavyVaultSRCLA.Action memory action, uint256 reserve) internal {
        VaultTypes.PlanHeader memory header = _header(action.planId, reserve);
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), action);
        vm.startPrank(allocator);
        vault.submitPlan(header, leaf);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        vm.stopPrank();
    }

    function _submit(NavyVaultSRCLA.Action memory action, uint256 reserve) internal {
        VaultTypes.PlanHeader memory header = _header(action.planId, reserve);
        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), action);
        vm.prank(allocator);
        vault.submitPlan(header, leaf);
    }

    /// @dev Funds the vault with exactly `amount` of idle assets, then submits
    /// and executes a one-action Deploy plan moving all of it into `adapter`.
    /// A single-leaf tree's root IS the leaf, so the proof is empty.
    function _executePlanWithSingleDeploy(address adapter, uint256 amount) internal {
        _deposit(amount);
        uint256 planId = ++_nextHelperPlanId;
        _submitAndExecute(_action(planId, NavyVaultSRCLA.ActionKind.Deploy, adapter, amount), 0);
    }

    function test_adapterAbsoluteCapRejectsDeploymentBeforeFundsMove() public {
        _deposit(1_000e6);
        vault.setAdapterRisk(address(adapterA), 10_000, 400e6, 2_000, 0);

        NavyVaultSRCLA.Action memory action = _action(1, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 401e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);

        assertEq(usdc.balanceOf(address(adapterA)), 0);
        assertEq(vault.strategyAssets(address(adapterA)), 0);
    }

    function test_adapterPercentageCapRejectsDeploymentBeforeFundsMove() public {
        _deposit(1_000e6);
        vault.setAdapterRisk(address(adapterA), 40_00, type(uint256).max, 2_000, 0);

        NavyVaultSRCLA.Action memory action = _action(18, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 401e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        assertEq(usdc.balanceOf(address(adapterA)), 0);
    }

    function test_externalHeadroomRejectsDeploymentBeforeFundsMove() public {
        _deposit(1_000e6);
        adapterA.setMaxDeployable(100e6);

        NavyVaultSRCLA.Action memory action = _action(19, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 101e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        assertEq(usdc.balanceOf(address(adapterA)), 0, "headroom must be checked before transfer");
        assertEq(usdc.balanceOf(address(vault)), 1_000e6);
    }

    function test_actualCreditedPositionCannotExceedAdapterCap() public {
        _deposit(1_000e6);
        vault.setAdapterRisk(address(adapterA), 10_000, 400e6, 2_000, 0);
        adapterA.setCreditBonus(1e6);

        NavyVaultSRCLA.Action memory action = _action(20, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 400e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        assertEq(usdc.balanceOf(address(adapterA)), 0, "post-deposit cap failure must roll back transfer");
        assertEq(vault.strategyAssets(address(adapterA)), 0);
    }

    function test_dependencyGroupBpsCapAggregatesMembers() public {
        _deposit(1_000e6);
        address[] memory members = new address[](2);
        members[0] = address(adapterA);
        members[1] = address(adapterB);
        vault.setDependencyGroup(keccak256("governance"), 50_00, type(uint256).max, members);

        _submitAndExecute(_action(2, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 300e6), 0);
        NavyVaultSRCLA.Action memory action = _action(3, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 201e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DependencyGroupCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    function test_dependencyGroupAbsoluteCapAggregatesMembers() public {
        _deposit(1_000e6);
        address[] memory members = new address[](2);
        members[0] = address(adapterA);
        members[1] = address(adapterB);
        vault.setDependencyGroup(keccak256("oracle"), 10_000, 500e6, members);

        _submitAndExecute(_action(4, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 300e6), 0);
        NavyVaultSRCLA.Action memory action = _action(5, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 201e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DependencyGroupCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    function test_actualCreditedPositionCannotExceedDependencyGroupCap() public {
        _deposit(1_000e6);
        address[] memory members = new address[](2);
        members[0] = address(adapterA);
        members[1] = address(adapterB);
        vault.setDependencyGroup(keccak256("credit-group"), 10_000, 500e6, members);
        _submitAndExecute(_action(21, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 300e6), 0);
        adapterB.setCreditBonus(1e6);

        NavyVaultSRCLA.Action memory action = _action(22, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 200e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DependencyGroupCapExceeded.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        assertEq(usdc.balanceOf(address(adapterB)), 0);
        assertEq(vault.strategyAssets(address(adapterB)), 0);
    }

    function test_dependencyGroupRejectsDuplicateAndUnregisteredMembers() public {
        address[] memory duplicate = new address[](2);
        duplicate[0] = address(adapterA);
        duplicate[1] = address(adapterA);
        vm.expectRevert(NavyVaultSRCLA.DuplicateDependencyGroupMember.selector);
        vault.setDependencyGroup(keccak256("duplicate"), 10_000, type(uint256).max, duplicate);

        address[] memory unregistered = new address[](1);
        unregistered[0] = address(0xBAD);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
        vault.setDependencyGroup(keccak256("unregistered"), 10_000, type(uint256).max, unregistered);
    }

    function test_dependencyGroupsAndMembersAreBounded() public {
        address[] memory tooManyMembers = new address[](17);
        for (uint256 i = 0; i < tooManyMembers.length; i++) {
            tooManyMembers[i] = address(uint160(0x1000 + i));
        }
        vm.expectRevert(NavyVaultSRCLA.TooManyDependencyGroupMembers.selector);
        vault.setDependencyGroup(keccak256("too-many-members"), 10_000, type(uint256).max, tooManyMembers);

        address[] memory oneMember = new address[](1);
        oneMember[0] = address(adapterA);
        for (uint256 i = 0; i < 16; i++) {
            vault.setDependencyGroup(bytes32(i + 1), 10_000, type(uint256).max, oneMember);
        }

        vm.expectRevert(NavyVaultSRCLA.TooManyDependencyGroups.selector);
        vault.setDependencyGroup(bytes32(uint256(17)), 10_000, type(uint256).max, oneMember);
    }

    function test_configurationDigestCommitsToRiskValuesAndOrderedGroupMembership() public {
        bytes32 initialDigest = vault.currentConfigurationDigest();
        vault.setAdapterRisk(address(adapterA), 9_000, 700e6, 1_500, 0);
        vault.setAdminReserve(25e6);
        vault.setMaxSynchronousLossBps(250);

        address[] memory members = new address[](2);
        members[0] = address(adapterA);
        members[1] = address(adapterB);
        vault.setDependencyGroup(keccak256("ordered"), 8_000, 600e6, members);
        bytes32 orderedDigest = vault.currentConfigurationDigest();

        members[0] = address(adapterB);
        members[1] = address(adapterA);
        vault.setDependencyGroup(keccak256("ordered"), 8_000, 600e6, members);

        assertTrue(initialDigest != orderedDigest, "risk policy must alter the configuration commitment");
        assertTrue(
            orderedDigest != vault.currentConfigurationDigest(),
            "dependency membership order must alter the configuration commitment"
        );
    }

    function test_completedPlanReservePersistsAndCannotUndercutAdminReserve() public {
        _deposit(1_000e6);
        vault.setAdminReserve(400e6);

        _submitAndExecute(_action(6, NavyVaultSRCLA.ActionKind.EmergencyExit, address(adapterA), 0), 100e6);

        assertEq(vault.dynamicReserve(), 100e6);
        assertEq(vault.requiredIdle(), 400e6);

        vault.setAdminReserve(50e6);
        assertEq(vault.dynamicReserve(), 100e6, "completed plan must persist its exact reserve");
        assertEq(vault.requiredIdle(), 100e6, "lower admin floor must reveal completed plan reserve");
    }

    function test_expiredPlanDoesNotEraseCompletedDynamicReserve() public {
        _deposit(1_000e6);
        _submitAndExecute(_action(7, NavyVaultSRCLA.ActionKind.EmergencyExit, address(adapterA), 0), 300e6);

        NavyVaultSRCLA.Action memory expiring =
            _action(8, NavyVaultSRCLA.ActionKind.EmergencyExit, address(adapterA), 0);
        _submit(expiring, 500e6);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanExecutionExpired.selector);
        vault.executeNextActionWithProof(new bytes32[](0), expiring);
        assertEq(vault.dynamicReserve(), 300e6);
    }

    function test_pausedVaultRejectsPlanDeployment() public {
        _deposit(1_000e6);
        NavyVaultSRCLA.Action memory action = _action(9, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6);
        _submit(action, 0);
        vault.pause();

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DepositPaused.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        assertEq(vault.strategyAssets(address(adapterA)), 0);
    }

    function test_pausedVaultPermitsEmergencyExitPlanAction() public {
        _deposit(100e6);
        _submitAndExecute(_action(14, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 50e6), 0);
        NavyVaultSRCLA.Action memory action = _action(15, NavyVaultSRCLA.ActionKind.EmergencyExit, address(adapterA), 0);
        _submit(action, 0);
        vault.pause();

        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), action);

        assertEq(vault.strategyAssets(address(adapterA)), 0);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
    }

    function test_pausedVaultPermitsDivestPlanAction() public {
        _deposit(100e6);
        _submitAndExecute(_action(23, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 50e6), 0);
        NavyVaultSRCLA.Action memory action = _action(24, NavyVaultSRCLA.ActionKind.Divest, address(adapterA), 25e6);
        _submit(action, 0);
        vault.pause();

        vm.prank(allocator);
        vault.executeNextActionWithProof(new bytes32[](0), action);

        assertEq(vault.strategyAssets(address(adapterA)), 25e6);
        assertEq(usdc.balanceOf(address(vault)), 75e6);
    }

    function test_pausedDirectAndPlanHarvestRevert() public {
        vault.pause();

        // New harvest signature with token parameter
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DepositPaused.selector);
        vault.harvest(address(adapterA), address(0), type(uint256).max, bytes32(0), 0, block.timestamp + 3600);

        NavyVaultSRCLA.Action memory action = _action(25, NavyVaultSRCLA.ActionKind.Harvest, address(adapterA), 0);
        _submit(action, 0);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.DepositPaused.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    function test_planHarvestEnforcesRegisteredAndActiveAdapterLifecycle() public {
        NavyVaultSRCLA.Action memory unregistered = _action(26, NavyVaultSRCLA.ActionKind.Harvest, address(0xBAD), 0);
        _submit(unregistered, 0);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotFound.selector);
        vault.executeNextActionWithProof(new bytes32[](0), unregistered);
        vm.prank(allocator);
        vault.cancelPlan();

        vault.setAdapterState(address(adapterA), uint8(NavyVaultSRCLA.AdapterState.Disabled));
        NavyVaultSRCLA.Action memory disabled = _action(27, NavyVaultSRCLA.ActionKind.Harvest, address(adapterA), 0);
        _submit(disabled, 0);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotActive.selector);
        vault.executeNextActionWithProof(new bytes32[](0), disabled);
        vm.prank(allocator);
        vault.cancelPlan();

        vault.setAdapterState(address(adapterA), uint8(NavyVaultSRCLA.AdapterState.Impaired));
        NavyVaultSRCLA.Action memory impaired = _action(28, NavyVaultSRCLA.ActionKind.Harvest, address(adapterA), 0);
        _submit(impaired, 0);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterNotActive.selector);
        vault.executeNextActionWithProof(new bytes32[](0), impaired);
    }

    function test_withdrawAggregatesLossAcrossAdaptersAndPaysExactAssets() public {
        _deposit(200e6);
        _submitAndExecute(_action(10, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6), 0);
        _submitAndExecute(_action(11, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 100e6), 0);
        adapterA.setWithdrawable(50e6);
        adapterB.setWithdrawable(100e6);
        adapterA.setShortfallOnNextWithdraw(5e6);
        adapterB.setPositionLossOnNextWithdraw(5e6);
        vault.setMaxSynchronousLossBps(1_000);

        vm.prank(alice);
        vault.withdraw(100e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 100e6, "ERC4626 withdrawal must pay exact requested assets");
        assertEq(vault.recognizedLosses(), 10e6, "loss must aggregate across both strategy pulls");
    }

    function test_withdrawRevertsAtomicallyWhenAggregateLossExceedsBound() public {
        _deposit(200e6);
        _submitAndExecute(_action(12, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6), 0);
        _submitAndExecute(_action(13, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 100e6), 0);
        adapterA.setWithdrawable(50e6);
        adapterB.setWithdrawable(100e6);
        adapterA.setShortfallOnNextWithdraw(5e6);
        adapterB.setPositionLossOnNextWithdraw(5e6);
        vault.setMaxSynchronousLossBps(999);

        uint256 sharesBefore = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(NavyVaultSRCLA.SynchronousLossExceeded.selector);
        vault.withdraw(100e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 0);
        assertEq(vault.balanceOf(alice), sharesBefore);
        assertEq(vault.strategyAssets(address(adapterA)), 100e6);
        assertEq(vault.strategyAssets(address(adapterB)), 100e6);
        assertEq(vault.recognizedLosses(), 0);
    }

    function test_synchronousAggregateAllowsOneAdapterSurplusToOffsetAnotherLoss() public {
        _deposit(200e6);
        _submitAndExecute(_action(29, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6), 0);
        _submitAndExecute(_action(30, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 100e6), 0);
        adapterA.setWithdrawable(50e6);
        adapterB.setWithdrawable(50e6);
        adapterA.setPositionDebitReductionOnNextWithdraw(5e6);
        adapterB.setPositionLossOnNextWithdraw(5e6);
        vault.setMaxSynchronousLossBps(0);

        vm.prank(alice);
        vault.withdraw(100e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(vault.recognizedLosses(), 0, "aggregate debit equals aggregate received");
    }

    function test_withdrawRevertsAtomicallyWhenExactLiquidityIsUnavailable() public {
        _deposit(200e6);
        _submitAndExecute(_action(16, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 100e6), 0);
        _submitAndExecute(_action(17, NavyVaultSRCLA.ActionKind.Deploy, address(adapterB), 100e6), 0);
        adapterA.setWithdrawable(50e6);
        adapterB.setWithdrawable(50e6);
        adapterA.setShortfallOnNextWithdraw(5e6);
        vault.setMaxSynchronousLossBps(1_000);

        uint256 sharesBefore = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(NavyVaultSRCLA.InsufficientIdle.selector);
        vault.withdraw(100e6, alice, alice);

        assertEq(usdc.balanceOf(alice), 0);
        assertEq(vault.balanceOf(alice), sharesBefore);
        assertEq(vault.strategyAssets(address(adapterA)), 100e6);
        assertEq(vault.strategyAssets(address(adapterB)), 100e6);
    }

    /// @dev minIdleBps was dead configuration: settable, digest-covered, never read.
    function test_requiredIdleHonoursMinIdleBps() public {
        // The brief's test body never deposits, leaving totalAssets() == 0 and
        // making both the pre-fix and post-fix requiredIdle() equal (0) — the
        // vm.assume(assets > 0) guard would just skip the test rather than
        // ever observing the fix. Deposit first so the floor has something to bind on.
        _deposit(1_000_000e6);

        // adminReserve and dynamicReserve both zero, so only the bps floor can bind.
        vault.setAdminReserve(0);
        vault.setMinIdleBps(500); // 5%

        uint256 assets = vault.totalAssets();
        vm.assume(assets > 0);

        assertEq(
            vault.requiredIdle(),
            (assets * 500) / 10_000,
            "requiredIdle must honour the percentage floor"
        );
    }

    function test_requiredIdleTakesTheLargerOfFloorAndAdminReserve() public {
        // Same reasoning as above: deposit first so assets > 10_000 and the
        // comparison below is actually exercised instead of skipped.
        _deposit(1_000_000e6);

        uint256 assets = vault.totalAssets();
        vm.assume(assets > 10_000);

        vault.setMinIdleBps(100);                     // 1% of assets
        vault.setAdminReserve(assets);                // absolute, strictly larger
        assertEq(vault.requiredIdle(), assets, "admin reserve must win when larger");

        vault.setAdminReserve(0);
        vault.setMinIdleBps(10_000);                  // 100% of assets
        assertEq(vault.requiredIdle(), assets, "bps floor must win when larger");
    }

    /// @dev Paper §6.1 as amended by P5. The vault must refuse to deploy into a
    ///      venue that cannot demonstrate it could return the resulting position.
    ///      A venue quoting a high rate on almost no free cash is the case this
    ///      exists for.
    ///
    /// Unlike the other two tests below, this one cannot go through
    /// `_executePlanWithSingleDeploy` wholesale: `vm.expectRevert` only
    /// guards the literal next external call, and that helper's funding step
    /// (mint/approve/deposit) makes several successful calls before the
    /// execute call that is actually supposed to revert — the same reason
    /// every other revert test in this file submits the plan first and wraps
    /// only the final `executeNextActionWithProof` in `expectRevert`.
    function test_deployRevertsWhenLiquidityFloorBreached() public {
        // Require the adapter to be able to return 100% of the resulting position.
        vault.setAdapterRisk(address(adapterA), 10_000, type(uint256).max, 50, 10_000);

        // Adapter reports it can only withdraw a tenth of what we are about to deploy.
        adapterA.setMaxWithdrawable(100e6);

        _deposit(1_000e6);
        NavyVaultSRCLA.Action memory action =
            _action(++_nextHelperPlanId, NavyVaultSRCLA.ActionKind.Deploy, address(adapterA), 1_000e6);
        _submit(action, 0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.AdapterLiquidityFloorBreached.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);

        assertEq(vault.strategyAssets(address(adapterA)), 0, "reverted deploy must not credit the position");
    }

    function test_deploySucceedsWhenLiquidityFloorSatisfied() public {
        vault.setAdapterRisk(address(adapterA), 10_000, type(uint256).max, 50, 5_000); // 50%
        adapterA.setMaxWithdrawable(600e6); // > 50% of 1,000e6
        _executePlanWithSingleDeploy(address(adapterA), 1_000e6);
        assertEq(vault.strategyAssets(address(adapterA)), 1_000e6);
    }

    function test_liquidityFloorOfZeroDisablesTheCheck() public {
        vault.setAdapterRisk(address(adapterA), 10_000, type(uint256).max, 50, 0);
        adapterA.setMaxWithdrawable(0);
        _executePlanWithSingleDeploy(address(adapterA), 1_000e6);
        assertEq(vault.strategyAssets(address(adapterA)), 1_000e6);
    }

    /// @dev Paper §5.1 — an impaired adapter must not keep contributing its full
    ///      nominal value to NAV just because it has not been divested.
    function test_accountingCapBoundsAnAdaptersContributionToNav() public {
        _executePlanWithSingleDeploy(address(adapterA), 1_000e6);
        uint256 before = vault.totalAssets();

        vault.setAdapterAccountingCap(address(adapterA), 400e6);

        assertEq(vault.totalAssets(), before - 600e6, "capped adapter must contribute only its cap");
    }

    function test_accountingCapDoesNotInflateNavWhenAboveActualValue() public {
        _executePlanWithSingleDeploy(address(adapterA), 1_000e6);
        uint256 before = vault.totalAssets();
        vault.setAdapterAccountingCap(address(adapterA), 5_000e6);
        assertEq(vault.totalAssets(), before, "a cap above actual value must not raise NAV");
    }

    function test_recognizeLossReducesNavAndIsMonotonic() public {
        // The brief's version of this test only checked the recognizedLosses
        // counter, which is pure telemetry elsewhere in this contract (a
        // divest shortfall already shows up via the adapter's own reduced
        // reported balance). That would have passed even if recognizeLoss did
        // nothing to totalAssets(), so it's strengthened here to actually
        // check NAV, matching what the test's name claims.
        _executePlanWithSingleDeploy(address(adapterA), 1_000e6);
        uint256 lossesBefore = vault.recognizedLosses();
        uint256 navBefore = vault.totalAssets();

        vault.recognizeLoss(address(adapterA), 250e6);

        assertEq(vault.recognizedLosses(), lossesBefore + 250e6, "loss counter must accumulate");
        assertEq(vault.totalAssets(), navBefore - 250e6, "recognized loss must actually leave NAV");

        // Monotonic: a second recognition strictly compounds, never unwinds.
        vault.recognizeLoss(address(adapterA), 100e6);
        assertEq(vault.recognizedLosses(), lossesBefore + 350e6, "losses must accumulate, never unwind");
        assertEq(vault.totalAssets(), navBefore - 350e6);
    }

    /// @dev Paper §5.1's recognized loss must be durable: it must not be an
    ///      artifact that the very next unrelated vault action silently
    ///      erases. deposit()/mint()/withdraw()/redeem() all call
    ///      _syncAllStrategies(), which overwrites strategyAssets[adapter]
    ///      from the adapter's own sync() value — a write-down to
    ///      strategyAssets alone would be reversed right here.
    function test_recognizeLossSurvivesSyncTriggeredByNextDeposit() public {
        _executePlanWithSingleDeploy(address(adapterA), 1_000e6);
        vault.recognizeLoss(address(adapterA), 250e6);
        uint256 navAfterLoss = vault.totalAssets();

        _deposit(1e6);

        assertEq(
            vault.totalAssets(),
            navAfterLoss + 1e6,
            "recognized loss must survive a sync triggered by the next deposit"
        );
    }

    /// @dev The global recognizedLosses counter gates plan execution via
    ///      activePlanMaxRecognizedLoss (see _enforceActivePlanRiskLimits), so
    ///      it must reflect actual NAV impact rather than whatever raw amount
    ///      an admin passes in. Requesting a loss larger than the adapter's
    ///      entire contribution must only accrue that contribution, floor the
    ///      adapter's NAV contribution at zero (never wrap negative), and
    ///      must not let a second, smaller call recognise anything further
    ///      once the position is fully written off.
    function test_recognizeLossClampsTheGlobalCounterToActualNavImpact() public {
        _executePlanWithSingleDeploy(address(adapterA), 1_000e6);
        uint256 navBefore = vault.totalAssets();
        uint256 lossesBefore = vault.recognizedLosses();

        vault.recognizeLoss(address(adapterA), 5_000e6); // far more than the 1,000e6 position

        assertEq(
            vault.recognizedLosses(),
            lossesBefore + 1_000e6,
            "global counter must accrue only the amount actually recognised, not the raw request"
        );
        assertEq(vault.totalAssets(), navBefore - 1_000e6, "adapter's NAV contribution must floor at zero");

        // Already fully written off: a further recognition against the same
        // adapter must be a no-op for both figures.
        vault.recognizeLoss(address(adapterA), 100e6);
        assertEq(vault.recognizedLosses(), lossesBefore + 1_000e6, "fully impaired adapter has nothing left to lose");
        assertEq(vault.totalAssets(), navBefore - 1_000e6);
    }

    function test_recognizeLossIsAdminOnly() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        vault.recognizeLoss(address(adapterA), 1);
    }
}
