// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {MerkleTree} from "../../src/libraries/MerkleTree.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Mock USDC for testing (6 decimals like real USDC)
contract MockUSDC {
    string public constant name = "USDC";
    string public constant version = "2";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function forceApprove(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        if (available != type(uint256).max) {
            require(available >= value, "insufficient allowance");
            allowance[from][msg.sender] = available - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @title Mock Strategy Adapter
contract MockAdapter {
    address public immutable vaultAddress;
    address public immutable assetAddress;
    uint256 public reportedAssets;
    uint256 public withdrawableAssets;

    constructor(address vault_, address asset_) {
        vaultAddress = vault_;
        assetAddress = asset_;
    }

    modifier onlyVault() {
        require(msg.sender == vaultAddress, "only vault");
        _;
    }

    function setReportedAssets(uint256 assets_) external {
        reportedAssets = assets_;
        if (withdrawableAssets > assets_) {
            withdrawableAssets = assets_;
        }
    }

    function setWithdrawable(uint256 assets_) external {
        withdrawableAssets = assets_;
    }

    function vault() external view returns (address) {
        return vaultAddress;
    }

    function asset() external view returns (address) {
        return assetAddress;
    }

    function totalAssets() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function rewardTokens() external pure returns (address[] memory) {
        address[] memory tokens = new address[](0);
        return tokens;
    }

    function claimableReward(address) external pure returns (uint256) {
        return 0;
    }

    function deposit(uint256 assets) external onlyVault returns (uint256 credited) {
        // USDC was transferred by vault before calling deposit
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
        // Transfer USDC back to vault
        require(IERC20(assetAddress).transfer(vaultAddress, returnedAssets), "transfer failed");
    }
}

/// @title MerklePlanExecutionTest - Tests for Merkle-verified plan execution
contract MerklePlanExecutionTest is Test {
    MockUSDC public usdc;
    NavyVaultSRCLA public vault;
    MockAdapter public adapter;

    address public admin = address(0xA11CE);
    address public allocator = address(0xA110CA7E);
    address public nonAllocator = address(0xB0B);

    function setUp() public {
        // Deploy mocks
        usdc = new MockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        adapter = new MockAdapter(address(vault), address(usdc));

        // Grant roles
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        // Register adapter
        vm.prank(admin);
        vault.registerAdapter(address(adapter), 5000, 100, "Test Adapter");

        // Set up adapter with assets and mint USDC to adapter for withdrawals
        adapter.setReportedAssets(1000e6);
        adapter.setWithdrawable(1000e6);
        usdc.mint(address(adapter), 1000e6); // Adapter needs USDC to return during withdraw

        // Fund vault with USDC for deploy operations
        usdc.mint(address(vault), 10000e6);
    }

    // ---- Helper Functions ----

    function _buildPlanHeader(uint256 planIdVal, uint32 actionCount, uint64 expiresAt)
        internal
        view
        returns (VaultTypes.PlanHeader memory header)
    {
        header = VaultTypes.PlanHeader({
            planId: planIdVal,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            actionCount: actionCount,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: bytes32(0),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: 0,
            turnoverLimit: 0
        });
    }

    function _buildLeaves(uint256 planIdVal, uint32 actionCount, uint8 kind)
        internal
        view
        returns (bytes32[] memory leaves)
    {
        // The vault's internal ActionKind has Deploy=0, Divest=1, Harvest=2, EmergencyExit=3
        // We encode with the vault's ActionKind values directly
        leaves = new bytes32[](actionCount);
        for (uint32 i = 0; i < actionCount; i++) {
            leaves[i] = keccak256(abi.encode(planIdVal, i, kind, address(adapter), 100e6, 99e6));
        }
    }

    // ---- State Variable Tests ----

    function test_initialState() public {
        assertEq(vault.activePlanId(), bytes32(0), "no active plan initially");
        assertEq(vault.activePlanMerkleRoot(), bytes32(0), "no merkle root initially");
    }

    // ---- submitPlan Tests ----

    function test_submitPlan_storesMerkleRoot() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 3, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 3, uint8(0));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        assertEq(vault.activePlanMerkleRoot(), root, "merkle root should be stored");
        assertEq(vault.activePlanId(), bytes32(planIdVal), "planId should be stored");
        assertEq(vault.getActivePlanMerkleRoot(), root, "getter should return merkle root");
    }

    function test_submitPlan_emitsPlanSubmittedEvent() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 2, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 2, uint8(0));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vm.expectEmit();
        emit IVaultEvents.PlanSubmitted(bytes32(planIdVal), root);
        vault.submitPlan(header, root);
    }

    function test_submitPlan_revertsForUsedPlanId() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 1, uint8(NavyVaultSRCLA.ActionKind.Deploy));
        bytes32 root = MerkleTree.computeRoot(leaves);

        // First submission
        vm.prank(allocator);
        vault.submitPlan(header, root);

        // Execute the action to complete the plan
        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 100e6,
            minOut: 99e6
        });

        vm.prank(allocator);
        vault.executeNextActionWithProof(proof, action);

        // Verify plan is completed
        assertEq(vault.activePlanId(), bytes32(0), "plan should be completed");

        // Try to reuse plan
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanAlreadyUsed.selector);
        vault.submitPlan(header, root);
    }

    function test_submitPlan_revertsWhenPlanAlreadyActive() public {
        uint256 planIdVal1 = 12345;
        uint256 planIdVal2 = 67890;
        VaultTypes.PlanHeader memory header1 = _buildPlanHeader(planIdVal1, 2, uint64(block.timestamp + 3600));
        VaultTypes.PlanHeader memory header2 = _buildPlanHeader(planIdVal2, 2, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal1, 2, uint8(NavyVaultSRCLA.ActionKind.Deploy));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header1, root);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanAlreadyActive.selector);
        vault.submitPlan(header2, root);
    }

    function test_submitPlan_revertsForExpiredPlan() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 2, uint64(block.timestamp - 1));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 2, uint8(0));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanExecutionExpired.selector);
        vault.submitPlan(header, root);
    }

    function test_submitPlan_revertsForZeroActionCount() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 0, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = new bytes32[](0);
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidPlan.selector);
        vault.submitPlan(header, root);
    }

    function test_submitPlan_onlyAllocator() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 2, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 2, uint8(0));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.submitPlan(header, root);
    }

    // ---- executeNextActionWithProof Tests ----

    function test_executeActionWithProof_verifiesMerkle() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 1, uint8(NavyVaultSRCLA.ActionKind.Deploy));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        // Wrong proof should revert
        bytes32[] memory wrongProof = new bytes32[](1);
        wrongProof[0] = bytes32(0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 100e6,
            minOut: 99e6
        });

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidMerkleProof.selector);
        vault.executeNextActionWithProof(wrongProof, action);
    }

    function test_executeActionWithProof_success() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 1, uint8(NavyVaultSRCLA.ActionKind.Divest));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        // Empty proof for single leaf
        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(adapter),
            amount: 100e6,
            minOut: 99e6
        });

        uint256 adapterAssetsBefore = adapter.reportedAssets();

        vm.prank(allocator);
        vault.executeNextActionWithProof(proof, action);

        // Single action plan should complete immediately
        assertEq(vault.activePlanId(), bytes32(0), "single-action plan should complete");
        assertTrue(vault.usedPlanIds(bytes32(planIdVal)), "planId should be marked as used");
        assertEq(adapter.reportedAssets(), adapterAssetsBefore - 100e6, "adapter assets should decrease");
    }

    // Note: Multi-action plans require proper Merkle proof construction for each leaf.
    // Testing complex multi-leaf Merkle proofs is beyond the scope of this test suite.
    // The core Merkle plan submission and execution behavior is tested with single-action plans above.

    function test_executeActionWithProof_revertsForWrongActionData() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 1, uint8(NavyVaultSRCLA.ActionKind.Divest));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        // Wrong amount in action (proof was for 100e6, but we use 200e6)
        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(adapter),
            amount: 200e6, // Wrong amount
            minOut: 99e6
        });

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidMerkleProof.selector);
        vault.executeNextActionWithProof(proof, action);
    }

    function test_executeActionWithProof_revertsWhenNoActivePlan() public {
        uint256 planIdVal = 12345;
        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(adapter),
            amount: 100e6,
            minOut: 99e6
        });

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanNotActive.selector);
        vault.executeNextActionWithProof(proof, action);
    }

    function test_executeActionWithProof_revertsWhenExpired() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 1));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 1, uint8(NavyVaultSRCLA.ActionKind.Divest));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        // Warp past expiration
        vm.warp(block.timestamp + 2);

        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(adapter),
            amount: 100e6,
            minOut: 99e6
        });

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanExecutionExpired.selector);
        vault.executeNextActionWithProof(proof, action);
    }

    function test_executeActionWithProof_revertsForInvalidIndex() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 1, uint8(NavyVaultSRCLA.ActionKind.Divest));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        // Try to execute index 1 (only 0 exists) - will fail Merkle first
        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 1, // Wrong index
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(adapter),
            amount: 100e6,
            minOut: 99e6
        });

        vm.prank(allocator);
        // Merkle verification fails first since action data doesn't match
        vm.expectRevert(NavyVaultSRCLA.InvalidMerkleProof.selector);
        vault.executeNextActionWithProof(proof, action);
    }

    function test_executeActionWithProof_onlyAllocator() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 1, uint8(NavyVaultSRCLA.ActionKind.Divest));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(adapter),
            amount: 100e6,
            minOut: 99e6
        });

        vm.prank(nonAllocator);
        vm.expectRevert();
        vault.executeNextActionWithProof(proof, action);
    }

    // ---- Deploy Action Tests ----

    function test_executeActionWithProof_deployAction() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 1, uint64(block.timestamp + 3600));

        // Build deploy action leaf
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = keccak256(abi.encode(planIdVal, 0, 0, address(adapter), 500e6, 499e6));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        bytes32[] memory proof = new bytes32[](0);

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 500e6,
            minOut: 499e6
        });

        uint256 adapterAssetsBefore = adapter.reportedAssets();

        vm.prank(allocator);
        vault.executeNextActionWithProof(proof, action);

        assertEq(adapter.reportedAssets(), adapterAssetsBefore + 500e6, "adapter assets should increase");
    }

    // ---- Edge Cases ----

    function test_cancelPlan_clearsMerkleRoot() public {
        uint256 planIdVal = 12345;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planIdVal, 2, uint64(block.timestamp + 3600));
        bytes32[] memory leaves = _buildLeaves(planIdVal, 2, uint8(NavyVaultSRCLA.ActionKind.Divest));
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        vm.prank(allocator);
        vault.cancelPlan();

        assertEq(vault.activePlanId(), bytes32(0), "plan should be cleared");
        assertEq(vault.activePlanMerkleRoot(), bytes32(0), "merkle root should be cleared");
    }

    function test_executePlan_vs_submitPlan() public {
        // Test that the original executePlan still works alongside submitPlan
        NavyVaultSRCLA.Action[] memory plainActions = new NavyVaultSRCLA.Action[](1);
        plainActions[0] = NavyVaultSRCLA.Action({
            planId: 0,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 50e6,
            minOut: 49e6
        });

        bytes32 plainPlanId = keccak256("plain-plan");

        vm.prank(allocator);
        vault.executePlan(plainPlanId, keccak256("decision"), uint64(block.timestamp + 3600), plainActions);

        assertEq(vault.activePlanId(), plainPlanId, "plain plan should be active");
        assertEq(vault.activePlanMerkleRoot(), bytes32(0), "no merkle root for plain plan");
    }
}

// Interface for events
interface IVaultEvents {
    event PlanSubmitted(bytes32 indexed planId, bytes32 merkleRoot);
}
