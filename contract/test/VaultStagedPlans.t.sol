// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {IStrategyAdapter} from "../src/interfaces/IStrategyAdapter.sol";
import {VaultTypes} from "../src/libraries/VaultTypes.sol";

/// @title Tests for staged plan execution lifecycle
/// @notice Covers plan creation, replay prevention, expiry, and cancellation
contract VaultStagedPlansTest is Test {
    using SafeERC20 for IERC20;

    bytes32 internal constant CONFIG_DIGEST_SEED = keccak256("NAVY_VAULT_CONFIGURATION");

    MockUsdc internal usdc;
    NavyVault internal vault;
    MockAdapter internal adapter;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110CA7E);
    address internal alice = address(0xA71CE);

    event PlanRegistered(uint256 indexed planId, bytes32 headerHash, bytes32 actionsRoot, uint256 reserve);
    event PlanCancellation(uint256 indexed planId);

    function setUp() public {
        usdc = new MockUsdc();
        vault = new NavyVault(IERC20(address(usdc)), admin, allocator);
        adapter = new MockAdapter(address(vault), address(usdc), keccak256("adapter-config"));

        vm.startPrank(admin);
        vault.addAdapter(address(adapter));
        vm.stopPrank();

        // Fund vault with idle USDC for tests
        usdc.mint(address(vault), 100_000e6);
        // Seed adapter with position
        usdc.mint(address(adapter), 50_000e6);
        adapter.setReportedAssets(50_000e6);
        adapter.setMaxWithdrawable(50_000e6);
    }

    // =========================================================
    // test_executePlanCreatesActivePlan
    // =========================================================

    function test_executePlanCreatesActivePlan() public {
        // Register a plan with 1 divest action
        uint256 planId = 1;
        VaultTypes.Action memory action = VaultTypes.Action({
            planId: planId,
            index: 0,
            kind: VaultTypes.ActionKind.Divest,
            adapter: address(adapter),
            amount: 10_000e6,
            minOut: 9_000e6
        });

        bytes32 actionLeaf = _actionLeaf(action);
        bytes32[] memory proof = new bytes32[](0); // single leaf, empty proof

        VaultTypes.PlanHeader memory header = _buildHeader({
            planId: planId,
            actionCount: 1,
            reserve: 10_000e6,
            minFinalAssets: 90_000e6,
            turnoverLimit: 50_000e6,
            expiresAt: uint64(block.timestamp + 1 days)
        });

        // Verify activePlanReserve starts at 0
        assertEq(vault.activePlanReserve(), 0);

        // Register plan - this sets activePlanReserve
        vm.prank(allocator);
        vault.registerPlan(header, actionLeaf);

        // After registration, activePlanReserve should equal header.reserve
        assertEq(vault.activePlanReserve(), 10_000e6);

        // Execute the action
        vm.prank(allocator);
        vault.executeDivest(action, proof);

        // After full execution (single action), plan completes and clears reserve
        assertEq(vault.activePlanReserve(), 0);
    }

    // =========================================================
    // test_cannotReplayPlanId
    // =========================================================

    function test_cannotReplayPlanId() public {
        uint256 planId = 42;

        VaultTypes.PlanHeader memory header = _buildHeader({
            planId: planId,
            actionCount: 1,
            reserve: 5_000e6,
            minFinalAssets: 95_000e6,
            turnoverLimit: 50_000e6,
            expiresAt: uint64(block.timestamp + 1 days)
        });

        // First registration should succeed
        vm.prank(allocator);
        vault.registerPlan(header, bytes32(uint256(1)));

        // Attempt to register same planId again should revert with PlanAlreadyRegistered
        vm.prank(allocator);
        vm.expectRevert(NavyVault.PlanAlreadyRegistered.selector);
        vault.registerPlan(header, bytes32(uint256(2)));
    }

    // =========================================================
    // test_planExpiresAfterDeadline
    // =========================================================

    function test_planExpiresAfterDeadline() public {
        uint256 planId = 1;

        // Plan expires in 1 day
        VaultTypes.PlanHeader memory header = _buildHeader({
            planId: planId,
            actionCount: 1,
            reserve: 10_000e6,
            minFinalAssets: 90_000e6,
            turnoverLimit: 50_000e6,
            expiresAt: uint64(block.timestamp + 1 days)
        });

        bytes32 actionLeaf = _actionLeaf(
            VaultTypes.Action({
                planId: planId,
                index: 0,
                kind: VaultTypes.ActionKind.Divest,
                adapter: address(adapter),
                amount: 10_000e6,
                minOut: 9_000e6
            })
        );

        vm.prank(allocator);
        vault.registerPlan(header, actionLeaf);

        // Warp past expiry
        vm.warp(block.timestamp + 2 days);

        // Attempting to execute any action should revert with PlanExpired
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(allocator);
        vm.expectRevert(NavyVault.PlanExpired.selector);
        vault.executeDivest(
            VaultTypes.Action({
                planId: planId,
                index: 0,
                kind: VaultTypes.ActionKind.Divest,
                adapter: address(adapter),
                amount: 10_000e6,
                minOut: 9_000e6
            }),
            proof
        );
    }

    // =========================================================
    // test_cancelPlanClearsActivePlan
    // =========================================================

    function test_cancelPlanClearsActivePlan() public {
        uint256 planId = 99;

        VaultTypes.PlanHeader memory header = _buildHeader({
            planId: planId,
            actionCount: 2,
            reserve: 20_000e6,
            minFinalAssets: 80_000e6,
            turnoverLimit: 50_000e6,
            expiresAt: uint64(block.timestamp + 1 days)
        });

        vm.prank(allocator);
        vault.registerPlan(header, bytes32(uint256(1)));

        // Verify reserve is set
        assertEq(vault.activePlanReserve(), 20_000e6);

        // Cancel the plan
        vm.prank(allocator);
        vault.cancelPlan(planId);

        // Reserve should be cleared
        assertEq(vault.activePlanReserve(), 0);

        // Attempting to execute actions on cancelled plan should revert
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(allocator);
        vm.expectRevert(NavyVault.PlanCancelled.selector);
        vault.executeDivest(
            VaultTypes.Action({
                planId: planId,
                index: 0,
                kind: VaultTypes.ActionKind.Divest,
                adapter: address(adapter),
                amount: 10_000e6,
                minOut: 9_000e6
            }),
            proof
        );
    }

    // =========================================================
    // Helpers
    // =========================================================

    function _buildHeader(
        uint256 planId,
        uint32 actionCount,
        uint256 reserve,
        uint256 minFinalAssets,
        uint256 turnoverLimit,
        uint64 expiresAt
    ) internal view returns (VaultTypes.PlanHeader memory header) {
        header = VaultTypes.PlanHeader({
            planId: planId,
            policyVersion: vault.policyVersion(),
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
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
        digest = keccak256(abi.encode(digest, address(adapter), adapter.configurationDigest()));
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
}

// =============================================================
// Minimal mock USDC for tests
// =============================================================

contract MockUsdc is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// =============================================================
// Minimal mock adapter for tests (simple deposit/withdraw)
// =============================================================

contract MockAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

    address public immutable vaultAddress;
    address public immutable assetAddress;
    bytes32 public configuration;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;

    constructor(address vault_, address asset_, bytes32 configuration_) {
        vaultAddress = vault_;
        assetAddress = asset_;
        configuration = configuration_;
    }

    modifier onlyVault() {
        require(msg.sender == vaultAddress, "NotVault");
        _;
    }

    function setReportedAssets(uint256 assets_) external {
        reportedAssets = assets_;
        if (withdrawableAssets > assets_) {
            withdrawableAssets = assets_;
        }
    }

    function setMaxWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
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

    function rewardTokens() external view returns (address[] memory) {
        return new address[](0);
    }

    function claimableReward(address) external view returns (uint256) {
        return 0;
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        reportedAssets += assets;
        withdrawableAssets += assets;
        return assets;
    }

    function withdraw(uint256 assets) external onlyVault returns (uint256 returnedAssets) {
        returnedAssets = assets > withdrawableAssets ? withdrawableAssets : assets;
        withdrawableAssets -= returnedAssets;
        if (reportedAssets > returnedAssets) {
            reportedAssets -= returnedAssets;
        } else {
            reportedAssets = 0;
        }
        IERC20(assetAddress).safeTransfer(vaultAddress, returnedAssets);
    }
}
