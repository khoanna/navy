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

/// @title MerkleProofValidationTest - Tests for executeAction Merkle proof validation
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

    /// @dev Helper to submit a plan with a Deploy action
    function _submitPlanWithDeployAction() internal returns (bytes32 root) {
        uint256 planIdVal = PLAN_ID;

        VaultTypes.PlanHeader memory header = VaultTypes.PlanHeader({
            planId: planIdVal,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 30 days),
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("snapshot"),
            decisionHash: keccak256("decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: type(uint256).max,
            turnoverLimit: 0
        });

        // Build leaf with the same format as executeAction expects
        bytes32 leaf = keccak256(abi.encodePacked(
            uint32(0),                    // actionIndex
            uint8(NavyVaultSRCLA.ActionKind.Deploy),  // kind
            address(adapter),             // adapter
            uint256(1000e6),              // amount
            uint256(0),                   // minOut
            bytes32(0)                    // dataHash
        ));

        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = leaf;
        root = MerkleTree.computeRoot(leaves);

        vm.prank(allocator);
        vault.submitPlan(header, root);
    }

    function testExecuteAction_ValidProof() public {
        // Empty proof for single leaf
        bytes32[] memory proof = new bytes32[](0);

        uint256 adapterAssetsBefore = adapter.reportedAssets();

        vm.prank(allocator);
        vault.executeAction(
            PLAN_ID,
            0,
            NavyVaultSRCLA.ActionKind.Deploy,
            address(adapter),
            1000e6,
            0,
            bytes32(0),
            proof
        );

        assertEq(vault.activePlanNextActionIndex(), 1, "next action index should be 1");
        assertEq(adapter.reportedAssets(), adapterAssetsBefore + 1000e6, "adapter assets should increase");
    }

    function testExecuteAction_InvalidProof() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256(abi.encodePacked("wrong-leaf"));

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidMerkleProof.selector);
        vault.executeAction(
            PLAN_ID,
            0,
            NavyVaultSRCLA.ActionKind.Deploy,
            address(adapter),
            1000e6,
            0,
            bytes32(0),
            proof
        );
    }

    function testExecuteAction_WrongActionIndex() public {
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.InvalidActionIndex.selector);
        vault.executeAction(
            PLAN_ID,
            1,  // Wrong index - plan only has index 0
            NavyVaultSRCLA.ActionKind.Deploy,
            address(adapter),
            1000e6,
            0,
            bytes32(0),
            proof
        );
    }

    function testExecuteAction_DoubleExecution() public {
        bytes32[] memory proof = new bytes32[](0);

        vm.startPrank(allocator);
        vault.executeAction(
            PLAN_ID,
            0,
            NavyVaultSRCLA.ActionKind.Deploy,
            address(adapter),
            1000e6,
            0,
            bytes32(0),
            proof
        );

        // Try to execute same action again - should fail with InvalidActionIndex
        vm.expectRevert(NavyVaultSRCLA.InvalidActionIndex.selector);
        vault.executeAction(
            PLAN_ID,
            0,
            NavyVaultSRCLA.ActionKind.Deploy,
            address(adapter),
            1000e6,
            0,
            bytes32(0),
            proof
        );
        vm.stopPrank();
    }

    function testExecuteAction_ExpiredPlan() public {
        // Advance past plan expiry (plan expires at block.timestamp + 30 days)
        vm.warp(block.timestamp + 31 days);

        bytes32[] memory proof = new bytes32[](0);

        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanExpired.selector);
        vault.executeAction(
            PLAN_ID,
            0,
            NavyVaultSRCLA.ActionKind.Deploy,
            address(adapter),
            1000e6,
            0,
            bytes32(0),
            proof
        );
    }
}
