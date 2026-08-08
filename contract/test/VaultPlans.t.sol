// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {IStrategyAdapter} from "../src/interfaces/IStrategyAdapter.sol";
import {VaultTypes} from "../src/libraries/VaultTypes.sol";

interface IStagedNavyVault {
    error InvalidPlanPolicy();
    error InvalidPlanConfiguration();
    error InvalidPlanExpiry();
    error InvalidPlanActionCount();
    error InvalidPlanProof();
    error InvalidPlanActionOrder();
    error PlanAlreadyRegistered();
    error PlanCancelled();
    error PlanExpired();
    error TurnoverLimitExceeded();
    error FinalAssetsTooLow();
    error LossLimitExceeded();
    error PauseRequired();

    function registerPlan(VaultTypes.PlanHeader calldata header, bytes32 actionsRoot) external;
    function executeDivest(VaultTypes.Action calldata action, bytes32[] calldata proof) external;
    function executeDeploy(VaultTypes.Action calldata action, bytes32[] calldata proof) external;
    function cancelPlan(uint256 planId) external;
    function emergencyDivest(address adapter, uint256 amount, uint256 minOut) external;
    function nextActionIndex(uint256 planId) external view returns (uint32);
    function activePlanReserve() external view returns (uint256);
}

contract PlanBaseUsdc is ERC20 {
    constructor() ERC20("Base USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PlanStrategyAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    uint16 public withdrawLossBps;
    uint256 public withdrawLossBase;
    uint16 public depositCreditBps = 10_000;
    uint256 public depositRefund;
    bool public depositFailure;
    bool public misreportWithdrawal;
    address public withdrawalRecipient;

    error NotVault();
    error DepositFailed();

    constructor(address vault_, address asset_, bytes32 configuration_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        configuration = configuration_;
    }

    modifier onlyVault() {
        if (msg.sender != vaultAddress) revert NotVault();
        _;
    }

    function setConfigurationDigest(bytes32 configuration_) external {
        configuration = configuration_;
    }

    function seedPosition(uint256 amount) external {
        reportedAssets = amount;
        withdrawableAssets = amount;
    }

    function setDepositFailure(bool failed) external {
        depositFailure = failed;
    }

    function setWithdrawLoss(uint16 bps, uint256 baseLoss) external {
        withdrawLossBps = bps;
        withdrawLossBase = baseLoss;
    }

    function setMisreportWithdrawal(bool misreport) external {
        misreportWithdrawal = misreport;
    }

    function setWithdrawalRecipient(address recipient) external {
        withdrawalRecipient = recipient;
    }

    function setDepositCreditBps(uint16 bps) external {
        depositCreditBps = bps;
    }

    function setDepositRefund(uint256 refund) external {
        depositRefund = refund;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function configurationDigest() external view returns (bytes32) {
        return configuration;
    }

    function totalAssets() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        if (depositFailure) revert DepositFailed();
        credited = Math.mulDiv(assets, depositCreditBps, 10_000);
        reportedAssets += credited;
        withdrawableAssets += credited;
        if (depositRefund != 0) IERC20(assetAddress).safeTransfer(vaultAddress, depositRefund);
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
        uint256 availableAssets = Math.min(assets, withdrawableAssets);
        uint256 percentLoss = Math.mulDiv(availableAssets, withdrawLossBps, 10_000);
        uint256 totalLoss = percentLoss + withdrawLossBase;
        if (totalLoss > availableAssets) totalLoss = availableAssets;

        returnedAssets = availableAssets - totalLoss;
        withdrawableAssets -= availableAssets;
        if (reportedAssets > availableAssets) {
            reportedAssets -= availableAssets;
        } else {
            reportedAssets = 0;
        }

        IERC20(assetAddress)
            .safeTransfer(withdrawalRecipient == address(0) ? vaultAddress : withdrawalRecipient, returnedAssets);
        if (misreportWithdrawal) ++returnedAssets;
    }
}

contract VaultPlansTest is Test {
    bytes32 internal constant CONFIG_DIGEST_SEED = keccak256("NAVY_VAULT_CONFIGURATION");

    PlanBaseUsdc internal usdc;
    NavyVault internal vault;
    IStagedNavyVault internal stagedVault;
    PlanStrategyAdapter internal source;
    PlanStrategyAdapter internal destination;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110CA7E);
    address internal nextAllocator = address(0xBEEFBEEF);
    address internal alice = address(0xA71CE);

    event PlanRegistered(uint256 indexed planId, bytes32 headerHash, bytes32 actionsRoot, uint256 reserve);

    function setUp() public {
        usdc = new PlanBaseUsdc();
        vault = new NavyVault(IERC20(address(usdc)), admin, allocator);
        stagedVault = IStagedNavyVault(address(vault));
        source = new PlanStrategyAdapter(address(vault), address(usdc), keccak256("source"));
        destination = new PlanStrategyAdapter(address(vault), address(usdc), keccak256("destination"));

        vm.startPrank(admin);
        vault.addAdapter(address(source));
        vault.addAdapter(address(destination));
        vm.stopPrank();

        _depositAlice(100_000e6);
        _seedSourceExposure(40_000e6);
    }

    function test_registerPlan_rejectsZeroActionCount() public {
        VaultTypes.PlanHeader memory header = _baseHeader(1, 0, 20_000e6, 99_000e6, 80_000e6);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanActionCount.selector);
        stagedVault.registerPlan(header, bytes32(uint256(1)));
    }

    function test_registerPlan_rejectsZeroActionsRoot() public {
        VaultTypes.PlanHeader memory header = _baseHeader(1, 1, 20_000e6, 99_000e6, 80_000e6);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanProof.selector);
        stagedVault.registerPlan(header, bytes32(0));
    }

    function test_registerPlan_rejectsFutureCreationAndExpiredDeadline() public {
        VaultTypes.PlanHeader memory header = _baseHeader(1, 1, 20_000e6, 99_000e6, 80_000e6);
        header.createdAt = uint64(block.timestamp + 1);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanExpiry.selector);
        stagedVault.registerPlan(header, bytes32(uint256(1)));

        header.createdAt = uint64(block.timestamp);
        header.expiresAt = uint64(block.timestamp);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanExpiry.selector);
        stagedVault.registerPlan(header, bytes32(uint256(1)));
    }

    function test_registerPlan_rejectsDuplicatePlanId() public {
        VaultTypes.PlanHeader memory header = _baseHeader(1, 1, 20_000e6, 99_000e6, 80_000e6);

        vm.startPrank(allocator);
        stagedVault.registerPlan(header, bytes32(uint256(1)));
        vm.expectRevert(IStagedNavyVault.PlanAlreadyRegistered.selector);
        stagedVault.registerPlan(header, bytes32(uint256(2)));
        vm.stopPrank();
    }

    function test_registerPlan_emitsHeaderHashBindingEverySnapshotAndSafetyField() public {
        VaultTypes.PlanHeader memory header = _baseHeader(1, 1, 20_000e6, 99_000e6, 80_000e6);
        bytes32 actionsRoot = bytes32(uint256(1));

        vm.expectEmit(true, false, false, true, address(vault));
        emit PlanRegistered(header.planId, _planHeaderHash(header), actionsRoot, header.reserve);
        vm.prank(allocator);
        stagedVault.registerPlan(header, actionsRoot);
    }

    function test_newPlanReplacesExpiredPlanReserve() public {
        VaultTypes.PlanHeader memory oldHeader = _baseHeader(1, 1, 70_000e6, 99_000e6, 80_000e6);

        vm.prank(allocator);
        stagedVault.registerPlan(oldHeader, bytes32(uint256(1)));
        vm.warp(oldHeader.expiresAt);

        VaultTypes.PlanHeader memory newHeader = _baseHeader(2, 1, 20_000e6, 99_000e6, 80_000e6);
        vm.prank(allocator);
        stagedVault.registerPlan(newHeader, bytes32(uint256(2)));

        assertEq(stagedVault.activePlanReserve(), 20_000e6);
    }

    function test_registerPlan_rejectsWrongPolicyVersion() public {
        VaultTypes.PlanHeader memory header = _baseHeader(1, 1, 20_000e6, 99_000e6, 80_000e6);
        header.policyVersion = vault.policyVersion() + 1;

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanPolicy.selector);
        stagedVault.registerPlan(header, bytes32(uint256(1)));
    }

    function test_registerPlan_rejectsWrongConfigurationDigest() public {
        VaultTypes.PlanHeader memory header = _baseHeader(1, 1, 20_000e6, 99_000e6, 80_000e6);
        header.configurationDigest = keccak256("wrong-config");

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanConfiguration.selector);
        stagedVault.registerPlan(header, bytes32(uint256(1)));
    }

    function test_executeDivest_rejectsInvalidMerkleProof() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        divestProof[0] = keccak256("wrong-proof");

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanProof.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDeploy_rejectsSkippedActionIndex() public {
        (,, VaultTypes.Action memory deployAction,, bytes32[] memory deployProof) = _registerTwoStepPlan();

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanActionOrder.selector);
        stagedVault.executeDeploy(deployAction, deployProof);
    }

    function test_executeDivest_rejectsReplay() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        vm.startPrank(allocator);
        stagedVault.executeDivest(divestAction, divestProof);
        vm.expectRevert(IStagedNavyVault.InvalidPlanActionOrder.selector);
        stagedVault.executeDivest(divestAction, divestProof);
        vm.stopPrank();

        assertEq(stagedVault.nextActionIndex(planId), 1);
    }

    function test_executeDivest_rejectsExpiredPlanButKeepsReserve() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        vm.warp(block.timestamp + 2 days);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.PlanExpired.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
        assertEq(stagedVault.activePlanReserve(), 20_000e6);
    }

    function test_executeDivest_rejectsAtExactExpiry() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        vm.warp(block.timestamp + 1 days);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.PlanExpired.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDivest_rejectsTurnoverExhaustion() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) =
            _registerTwoStepPlanWithTurnover(30_000e6);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.TurnoverLimitExceeded.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDivest_rejectsAdminLossLimitAndDoesNotConsumeAction() public {
        source.setWithdrawLoss(100, 0);
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) =
            _registerPlanWithBounds(80_000e6, 80_000e6, 20_000e6);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.LossLimitExceeded.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDivest_rejectsMisreportedBalanceDeltaAndDoesNotConsumeAction() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();
        source.setMisreportWithdrawal(true);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.LossLimitExceeded.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDivest_rejectsRecognizedLossDrift() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        vm.prank(admin);
        vault.recordImpairment(address(source), 1);

        vm.prank(allocator);
        vm.expectRevert(NavyVault.RecognizedLossLimitExceeded.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDivest_rejectsPolicyDrift() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        vm.prank(admin);
        vault.setAdminIdleFloor(1);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanPolicy.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDivest_rejectsMinimumFinalAssetsBreach() public {
        source.setWithdrawLoss(2_500, 0);
        vm.prank(admin);
        vault.setAdapterLimits(address(source), 10_000, type(uint256).max, 2_500, type(uint256).max);

        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) =
            _registerTwoStepPlanWithMinimumFinalAssets(91_000e6);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.FinalAssetsTooLow.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_executeDivest_rejectsConfigurationDrift() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();
        source.setConfigurationDigest(keccak256("drifted"));

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.InvalidPlanConfiguration.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 0);
    }

    function test_failedDeploymentLeavesDivestedFundsIdle() public {
        (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        ) = _registerTwoStepPlan();

        vm.prank(allocator);
        stagedVault.executeDivest(divestAction, divestProof);

        destination.setDepositFailure(true);

        vm.prank(allocator);
        vm.expectRevert(PlanStrategyAdapter.DepositFailed.selector);
        stagedVault.executeDeploy(deployAction, deployProof);

        assertEq(usdc.balanceOf(address(vault)), divestAction.amount + 60_000e6);
        assertEq(stagedVault.nextActionIndex(planId), 1);
    }

    function test_executeDeploy_reusesCapValidatorAndPreservesActionOnFailure() public {
        vm.prank(admin);
        vault.setAdapterLimits(address(destination), 20_00, type(uint256).max, 0, type(uint256).max);

        (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        ) = _registerTwoStepPlan();

        vm.startPrank(allocator);
        stagedVault.executeDivest(divestAction, divestProof);
        vm.expectRevert(NavyVault.AdapterCapExceeded.selector);
        stagedVault.executeDeploy(deployAction, deployProof);
        vm.stopPrank();

        assertEq(stagedVault.nextActionIndex(planId), 1);
    }

    function test_executeDeploy_rejectsInexactVaultBalanceDeltaAndPreservesAction() public {
        (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        ) = _registerTwoStepPlan();

        vm.prank(allocator);
        stagedVault.executeDivest(divestAction, divestProof);
        destination.setDepositRefund(1);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.LossLimitExceeded.selector);
        stagedVault.executeDeploy(deployAction, deployProof);

        assertEq(stagedVault.nextActionIndex(planId), 1);
    }

    function test_executeDeploy_preservesPlanReserve() public {
        (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        ) = _registerPlanWithBounds(99_000e6, 80_000e6, 70_000e6);

        vm.startPrank(allocator);
        stagedVault.executeDivest(divestAction, divestProof);
        vm.expectRevert(NavyVault.InsufficientSynchronousLiquidity.selector);
        stagedVault.executeDeploy(deployAction, deployProof);
        vm.stopPrank();

        assertEq(stagedVault.nextActionIndex(planId), 1);
        assertEq(stagedVault.activePlanReserve(), 70_000e6);
    }

    function test_planRejectsDivestAfterDeploymentPhaseStarts() public {
        uint256 planId = 1;
        VaultTypes.Action memory deployAction = VaultTypes.Action({
            planId: planId,
            index: 0,
            kind: VaultTypes.ActionKind.Deploy,
            adapter: address(destination),
            amount: 10_000e6,
            minOut: 10_000e6
        });
        VaultTypes.Action memory divestAction = VaultTypes.Action({
            planId: planId,
            index: 1,
            kind: VaultTypes.ActionKind.Divest,
            adapter: address(source),
            amount: 10_000e6,
            minOut: 10_000e6
        });
        bytes32 deployLeaf = _actionLeaf(deployAction);
        bytes32 divestLeaf = _actionLeaf(divestAction);
        bytes32[] memory deployProof = new bytes32[](1);
        deployProof[0] = divestLeaf;
        bytes32[] memory divestProof = new bytes32[](1);
        divestProof[0] = deployLeaf;

        VaultTypes.PlanHeader memory header = _baseHeader(planId, 2, 0, 99_000e6, 20_000e6);
        vm.startPrank(allocator);
        stagedVault.registerPlan(header, _hashPair(deployLeaf, divestLeaf));
        stagedVault.executeDeploy(deployAction, deployProof);
        vm.expectRevert(IStagedNavyVault.InvalidPlanActionOrder.selector);
        stagedVault.executeDivest(divestAction, divestProof);
        vm.stopPrank();

        assertEq(stagedVault.nextActionIndex(planId), 1);
    }

    function test_successfulPlanCompletionConsumesActionsAndClearsReserve() public {
        (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        ) = _registerTwoStepPlan();

        vm.startPrank(allocator);
        stagedVault.executeDivest(divestAction, divestProof);
        stagedVault.executeDeploy(deployAction, deployProof);
        vm.stopPrank();

        assertEq(stagedVault.nextActionIndex(planId), 2);
        assertEq(stagedVault.activePlanReserve(), 0);
    }

    function test_cancelPlan_blocksFurtherExecutionAndClearsReserve() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        vm.prank(allocator);
        stagedVault.cancelPlan(planId);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.PlanCancelled.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.activePlanReserve(), 0);
    }

    function test_allocatorRotation_revokesOldAllocatorAndAllowsNewAllocator() public {
        (uint256 planId, VaultTypes.Action memory divestAction,, bytes32[] memory divestProof,) = _registerTwoStepPlan();

        vm.prank(admin);
        vault.setAllocator(nextAllocator);

        vm.prank(allocator);
        vm.expectRevert(NavyVault.NotAllocator.selector);
        stagedVault.executeDivest(divestAction, divestProof);

        vm.prank(nextAllocator);
        stagedVault.executeDivest(divestAction, divestProof);

        assertEq(stagedVault.nextActionIndex(planId), 1);
    }

    function test_emergencyDivest_onlyWhilePausedAndReturnsFundsToVault() public {
        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.PauseRequired.selector);
        stagedVault.emergencyDivest(address(source), 10_000e6, 9_500e6);

        vm.prank(admin);
        vault.setPaused(true);

        uint256 allocatorBalanceBefore = usdc.balanceOf(allocator);
        uint256 vaultBalanceBefore = usdc.balanceOf(address(vault));

        vm.prank(allocator);
        stagedVault.emergencyDivest(address(source), 10_000e6, 9_500e6);

        assertEq(usdc.balanceOf(allocator), allocatorBalanceBefore);
        assertEq(usdc.balanceOf(address(vault)), vaultBalanceBefore + 10_000e6);
    }

    function test_emergencyDivest_rejectsAdminLossLimit() public {
        source.setWithdrawLoss(100, 0);

        vm.prank(admin);
        vault.setPaused(true);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.LossLimitExceeded.selector);
        stagedVault.emergencyDivest(address(source), 10_000e6, 0);
    }

    function test_emergencyDivest_revertsIfAdapterRedirectsProceeds() public {
        source.setWithdrawalRecipient(allocator);

        vm.prank(admin);
        vault.setPaused(true);

        vm.prank(allocator);
        vm.expectRevert(IStagedNavyVault.LossLimitExceeded.selector);
        stagedVault.emergencyDivest(address(source), 10_000e6, 0);

        assertEq(usdc.balanceOf(allocator), 0);
    }

    function _registerTwoStepPlan()
        internal
        returns (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        )
    {
        return _registerTwoStepPlanWithTurnover(80_000e6);
    }

    function _registerTwoStepPlanWithMinimumFinalAssets(uint256 minFinalAssets)
        internal
        returns (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        )
    {
        return _registerPlan(minFinalAssets, 80_000e6);
    }

    function _registerTwoStepPlanWithTurnover(uint256 turnoverLimit)
        internal
        returns (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        )
    {
        return _registerPlan(99_000e6, turnoverLimit);
    }

    function _registerPlan(uint256 minFinalAssets, uint256 turnoverLimit)
        internal
        returns (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        )
    {
        return _registerPlanWithBounds(minFinalAssets, turnoverLimit, 20_000e6);
    }

    function _registerPlanWithBounds(uint256 minFinalAssets, uint256 turnoverLimit, uint256 reserve)
        internal
        returns (
            uint256 planId,
            VaultTypes.Action memory divestAction,
            VaultTypes.Action memory deployAction,
            bytes32[] memory divestProof,
            bytes32[] memory deployProof
        )
    {
        planId = 1;
        divestAction = VaultTypes.Action({
            planId: planId,
            index: 0,
            kind: VaultTypes.ActionKind.Divest,
            adapter: address(source),
            amount: 40_000e6,
            minOut: 30_000e6
        });
        deployAction = VaultTypes.Action({
            planId: planId,
            index: 1,
            kind: VaultTypes.ActionKind.Deploy,
            adapter: address(destination),
            amount: 40_000e6,
            minOut: 39_500e6
        });

        bytes32 divestLeaf = _actionLeaf(divestAction);
        bytes32 deployLeaf = _actionLeaf(deployAction);
        bytes32 root = _hashPair(divestLeaf, deployLeaf);

        divestProof = new bytes32[](1);
        divestProof[0] = deployLeaf;
        deployProof = new bytes32[](1);
        deployProof[0] = divestLeaf;

        VaultTypes.PlanHeader memory header = _baseHeader(planId, 2, reserve, minFinalAssets, turnoverLimit);

        vm.prank(allocator);
        stagedVault.registerPlan(header, root);
    }

    function _baseHeader(
        uint256 planId,
        uint32 actionCount,
        uint256 reserve,
        uint256 minFinalAssets,
        uint256 turnoverLimit
    ) internal view returns (VaultTypes.PlanHeader memory header) {
        header = VaultTypes.PlanHeader({
            planId: planId,
            policyVersion: vault.policyVersion(),
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 days),
            actionCount: actionCount,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: _configurationDigest(),
            reserve: reserve,
            minFinalAssets: minFinalAssets,
            maxRecognizedLoss: 0,
            turnoverLimit: turnoverLimit
        });
    }

    function _configurationDigest() internal view returns (bytes32 digest) {
        digest = CONFIG_DIGEST_SEED;
        digest = keccak256(abi.encode(digest, address(source), source.configuration()));
        digest = keccak256(abi.encode(digest, address(destination), destination.configuration()));
    }

    function _actionLeaf(VaultTypes.Action memory action) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                VaultTypes.ACTION_TYPEHASH,
                action.planId,
                action.index,
                action.kind,
                action.adapter,
                action.amount,
                action.minOut
            )
        );
    }

    function _planHeaderHash(VaultTypes.PlanHeader memory header) internal pure returns (bytes32) {
        bytes32 typehash = keccak256(
            "PlanHeader(uint256 planId,uint64 policyVersion,uint64 createdAt,uint64 expiresAt,uint32 actionCount,uint256 snapshotBlockNumber,bytes32 snapshotHash,bytes32 decisionHash,bytes32 configurationDigest,uint256 reserve,uint256 minFinalAssets,uint256 maxRecognizedLoss,uint256 turnoverLimit)"
        );
        return keccak256(
            abi.encode(
                typehash,
                header.planId,
                header.policyVersion,
                header.createdAt,
                header.expiresAt,
                header.actionCount,
                header.snapshotBlockNumber,
                header.snapshotHash,
                header.decisionHash,
                header.configurationDigest,
                header.reserve,
                header.minFinalAssets,
                header.maxRecognizedLoss,
                header.turnoverLimit
            )
        );
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _depositAlice(uint256 amount) internal {
        usdc.mint(alice, amount);

        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(amount, alice);
        vm.stopPrank();
    }

    function _seedSourceExposure(uint256 amount) internal {
        vm.prank(address(vault));
        usdc.transfer(address(source), amount);
        source.seedPosition(amount);
    }
}
