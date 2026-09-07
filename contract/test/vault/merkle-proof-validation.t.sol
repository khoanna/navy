// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {MerkleTree} from "../../src/libraries/MerkleTree.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";

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

    function sync() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets;
    }

    function maxDeployable() external pure returns (uint256) {
        return type(uint256).max;
    }

    function rewardTokens() external pure returns (address[] memory) {
        address[] memory tokens = new address[](0);
        return tokens;
    }

    function claimableReward(address) external pure returns (uint256) {
        return 0;
    }

    function configurationDigest() external view returns (bytes32) {
        return keccak256(abi.encode(vaultAddress, assetAddress, block.chainid));
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
        require(IERC20(assetAddress).transfer(vaultAddress, returnedAssets), "transfer failed");
    }
}

/// @title MerkleProofValidationTest - Tests for executeNextActionWithProof Merkle proof validation
contract MerkleProofValidationTest is Test {
    using MerkleTree for bytes32[];

    MockUSDC public usdc;
    NavyVaultSRCLA public vault;
    MockAdapter public adapter;

    address public admin = address(0xA11CE);
    address public allocator = address(0xA110CA7E);
    uint256 public constant PLAN_ID = 1;
    bytes32 public merkleRoot;

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
        usdc.mint(address(adapter), 1000e6);

        // Fund vault with USDC for deploy operations
        usdc.mint(address(vault), 10000e6);

        // Set up plan with Merkle root
        merkleRoot = _submitPlanWithDeployAction();
    }

    function _buildHeader(uint256 planIdVal, uint32 actionCount, uint64 expiresAt)
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
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: 0
        });
    }

    function _deployAction() internal view returns (NavyVaultSRCLA.Action memory) {
        return NavyVaultSRCLA.Action({
            planId: PLAN_ID,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 1000e6,
            minOut: 0,
            dataHash: bytes32(0)
        });
    }

    /// @dev Helper to submit a single-Deploy-action plan. The leaf is built
    ///      via hashPlanAction(domain, action) — the domain-bound encoding
    ///      executeNextActionWithProof requires — not the old unbound packed
    ///      encoding the deleted executeAction used.
    function _submitPlanWithDeployAction() internal returns (bytes32 root) {
        VaultTypes.PlanHeader memory header = _buildHeader(PLAN_ID, 1, uint64(block.timestamp + 30 days));

        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = vault.hashPlanAction(vault.planDomain(header), _deployAction());
        root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);
    }

    function test_executeNextActionWithProof_validProof() public {
        // Empty proof for single leaf
        bytes32[] memory proof = new bytes32[](0);
        NavyVaultSRCLA.Action memory action = _deployAction();

        uint256 adapterAssetsBefore = adapter.reportedAssets();

        vm.prank(allocator);
        vault.executeNextActionWithProof(proof, action);

        // Unlike the deleted executeAction (which only ever incremented
        // activePlanNextActionIndex and never completed a plan),
        // executeNextActionWithProof completes and clears a plan on its
        // final action, so activePlanNextActionIndex resets to 0 rather
        // than advancing to 1.
        assertEq(vault.activePlanId(), bytes32(0), "single-action plan should complete and clear");
        assertTrue(vault.usedPlanIds(bytes32(PLAN_ID)), "planId should be marked used");
        assertEq(adapter.reportedAssets(), adapterAssetsBefore + 1000e6, "adapter assets should increase");
    }

    function test_executeNextActionWithProof_invalidProof() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256(abi.encodePacked("wrong-leaf"));
        NavyVaultSRCLA.Action memory action = _deployAction();

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidMerkleProof.selector);
        vault.executeNextActionWithProof(proof, action);
    }

    function test_executeNextActionWithProof_wrongActionIndex() public {
        bytes32[] memory proof = new bytes32[](0);
        NavyVaultSRCLA.Action memory action = _deployAction();
        action.index = 1; // Wrong index - plan only has index 0

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidActionIndex.selector);
        vault.executeNextActionWithProof(proof, action);
    }

    function test_executeNextActionWithProof_doubleExecutionReverts() public {
        // The setUp plan has a single action, and executeNextActionWithProof
        // completes+clears the plan on that action (unlike the deleted
        // executeAction, which never completed a plan). Cancel it and submit
        // a two-action plan instead, so the first action's index is stale on
        // replay while the plan is still active — preserving the original
        // "you can't re-execute the same index" intent.
        vm.prank(allocator);
        vault.cancelPlan();

        uint256 planIdVal = PLAN_ID + 1;
        VaultTypes.PlanHeader memory header = _buildHeader(planIdVal, 2, uint64(block.timestamp + 30 days));

        NavyVaultSRCLA.Action memory action0 = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 500e6,
            minOut: 0,
            dataHash: bytes32(0)
        });
        NavyVaultSRCLA.Action memory action1 = NavyVaultSRCLA.Action({
            planId: planIdVal,
            index: 1,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapter),
            amount: 500e6,
            minOut: 0,
            dataHash: bytes32(0)
        });

        bytes32 domain = vault.planDomain(header);
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = vault.hashPlanAction(domain, action0);
        leaves[1] = vault.hashPlanAction(domain, action1);
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);

        bytes32[] memory proof0 = new bytes32[](1);
        proof0[0] = leaves[1];

        vm.startPrank(allocator);
        vault.executeNextActionWithProof(proof0, action0);

        // Re-executing the already-consumed index 0: next expected index is
        // now 1, so action0.index (0) no longer matches.
        vm.expectRevert(NavyVaultSRCLA.InvalidActionIndex.selector);
        vault.executeNextActionWithProof(proof0, action0);
        vm.stopPrank();
    }

    function test_executeNextActionWithProof_expiredPlanReverts() public {
        // Advance past plan expiry (plan expires at block.timestamp + 30 days)
        vm.warp(block.timestamp + 31 days);

        bytes32[] memory proof = new bytes32[](0);
        NavyVaultSRCLA.Action memory action = _deployAction();

        vm.prank(allocator);
        // executeNextActionWithProof reverts PlanExecutionExpired, not the
        // deleted executeAction's PlanExpired.
        vm.expectRevert(NavyVaultSRCLA.PlanExecutionExpired.selector);
        vault.executeNextActionWithProof(proof, action);
    }
}
