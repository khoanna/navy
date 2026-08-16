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
        withdrawableAssets += assets;
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

    function test_adapterAbsoluteCapRejectsDeploymentBeforeFundsMove() public {
        _deposit(1_000e6);
        vault.setAdapterRisk(address(adapterA), 10_000, 400e6, 2_000);

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
        vault.setAdapterRisk(address(adapterA), 40_00, type(uint256).max, 2_000);

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
        vault.setAdapterRisk(address(adapterA), 10_000, 400e6, 2_000);
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
        vault.setAdapterRisk(address(adapterA), 9_000, 700e6, 1_500);
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
}
