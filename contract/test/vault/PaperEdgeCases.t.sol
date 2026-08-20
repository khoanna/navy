// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";
import {RewardAccountant} from "../../src/reward/RewardAccountant.sol";
import {IRewardAccountant} from "../../src/interfaces/IRewardAccountant.sol";
import {RewardExecutor} from "../../src/reward/RewardExecutor.sol";
import {MerkleTree} from "../../src/libraries/MerkleTree.sol";

// ============================================================================
// Mock ERC20 Token
// ============================================================================
contract EdgeCaseUSDC {
    string public name;
    string public symbol;
    uint8 public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "USDC: balance low");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max && from != msg.sender) {
            uint256 approved = allowance[from][msg.sender];
            require(approved >= amount, "USDC: allowance low");
            allowance[from][msg.sender] = approved - amount;
        }
        require(balanceOf[from] >= amount, "USDC: balance low");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// ============================================================================
// Mock Adapter Implementing IStrategyAdapter
// ============================================================================
contract EdgeCaseAdapter {
    address public immutable vault;
    address public immutable asset;
    bytes32 public immutable configurationDigest;

    uint256 public reportedAssets;
    uint256 public withdrawableAssets;
    uint256 public mockErrorCode;
    bool public isPaused;

    constructor(address vault_, address asset_) {
        vault = vault_;
        asset = asset_;
        configurationDigest = keccak256(abi.encodePacked("EdgeCaseAdapter", vault_, asset_));
    }

    function setReportedAssets(uint256 a) external {
        reportedAssets = a;
    }

    function setWithdrawableAssets(uint256 w) external {
        withdrawableAssets = w;
    }

    function setMockErrorCode(uint256 code) external {
        mockErrorCode = code;
    }

    function setPaused(bool p) external {
        isPaused = p;
    }

    function totalAssets() external view returns (uint256) {
        return reportedAssets;
    }

    function sync() external view returns (uint256) {
        return reportedAssets;
    }

    function maxWithdrawable() external view returns (uint256) {
        return withdrawableAssets < reportedAssets ? withdrawableAssets : reportedAssets;
    }

    function maxDeployable() external view returns (uint256) {
        return 1_000_000 * 1e6;
    }

    function getPositionValue() external view returns (uint256) {
        return reportedAssets;
    }

    function getSynchronousExitCapacity() external view returns (uint256) {
        return withdrawableAssets < reportedAssets ? withdrawableAssets : reportedAssets;
    }

    function deposit(uint256 amount) external returns (uint256) {
        require(msg.sender == vault, "Only vault");
        require(!isPaused, "Adapter paused");
        require(mockErrorCode == 0, "Moonwell error code non-zero");

        reportedAssets += amount;
        withdrawableAssets += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256 returned) {
        require(msg.sender == vault, "Only vault");
        uint256 executable = withdrawableAssets < reportedAssets ? withdrawableAssets : reportedAssets;
        require(amount <= executable, "Adapter illiquid");

        reportedAssets -= amount;
        withdrawableAssets -= amount;
        IERC20(asset).transfer(vault, amount);
        return amount;
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
}

// ============================================================================
// Mock Chainlink Aggregator Feed
// ============================================================================
contract MockChainlinkFeed {
    int256 public answer;
    uint8 public decimals = 8;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor(int256 initialAnswer) {
        answer = initialAnswer;
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 newAnswer, uint256 timestamp) external {
        answer = newAnswer;
        updatedAt = timestamp;
        roundId++;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }

    function latestAnswer() external view returns (int256) {
        return answer;
    }
}

// ============================================================================
// Paper Edge Cases Test Suite
// ============================================================================
contract PaperEdgeCasesTest is Test {
    EdgeCaseUSDC internal usdc;
    NavyVaultSRCLA internal vault;
    EdgeCaseAdapter internal adapterA;
    EdgeCaseAdapter internal adapterB;
    RewardAccountant internal accountant;
    MockChainlinkFeed internal rewardFeed;
    MockChainlinkFeed internal usdcFeed;

    address internal admin = address(0xAD1111);
    address internal allocator = address(0xA110CA70);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal attacker = address(0xBAD);

    function setUp() external {
        vm.warp(100_000); // Prevent uint256 underflow when subtracting feed age

        usdc = new EdgeCaseUSDC("USD Coin", "USDC", 6);
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));

        adapterA = new EdgeCaseAdapter(address(vault), address(usdc));
        adapterB = new EdgeCaseAdapter(address(vault), address(usdc));

        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);

        vm.startPrank(admin);
        vault.registerAdapter(address(adapterA), 10_000, 100, "Adapter A");
        vault.registerAdapter(address(adapterB), 10_000, 100, "Adapter B");
        vm.stopPrank();

        // Mint sufficient funds
        usdc.mint(alice, 10_000_000 * 1e6);
        usdc.mint(bob, 10_000_000 * 1e6);
        usdc.mint(attacker, 10_000_000 * 1e6);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(attacker);
        usdc.approve(address(vault), type(uint256).max);
    }

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
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: 0,
            turnoverLimit: 0
        });
    }

    // ========================================================================
    // 1. ERC-4626 Inflation & Donation Edge Case (§5.1)
    // ========================================================================
    function test_edgeCase_donationCannotManipulateVictimShareMinting() external {
        vm.prank(attacker);
        uint256 attackerShares = vault.deposit(1, attacker);
        assertTrue(attackerShares > 0, "Attacker receives initial shares");

        // Attacker donates 1,000,000 USDC directly to vault contract
        vm.prank(attacker);
        usdc.transfer(address(vault), 1_000_000 * 1e6);

        vm.prank(alice);
        uint256 aliceShares = vault.deposit(10_000 * 1e6, alice);

        assertTrue(aliceShares > 0, "Victim receives non-zero shares");
        
        vm.prank(alice);
        uint256 redeemedAssets = vault.redeem(aliceShares, alice, alice);
        assertTrue(redeemedAssets >= 9_990 * 1e6, "Alice NAV preserved");
    }

    // ========================================================================
    // 2. Illiquid Protocol Exit & Synchronous Capacity Cap ($Q_t^{\text{sync}}$) (§5.2, §12)
    // ========================================================================
    function test_edgeCase_illiquidAdapterCapsMaxWithdrawAndPreventsExcessiveExit() external {
        vm.prank(alice);
        vault.deposit(100_000 * 1e6, alice);

        uint256 planId = 1;
        VaultTypes.PlanHeader memory header = _buildPlanHeader(planId, 1, uint64(block.timestamp + 3600));

        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: planId,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapterA),
            amount: 80_000 * 1e6,
            minOut: 0,
            dataHash: bytes32(0)
        });

        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), action);
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = leaf;
        bytes32 root = MerkleTree.computeRoot(leaves);

        vm.startPrank(allocator);
        vault.submitPlan(header, root);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        vm.stopPrank();

        // Simulate Protocol Illiquidity: withdrawable cash drops to 30,000 USDC
        adapterA.setWithdrawableAssets(30_000 * 1e6);

        uint256 maxWithdraw = vault.maxWithdraw(alice);
        assertEq(maxWithdraw, 50_000 * 1e6, "maxWithdraw capped at Q_sync (50k)");

        vm.expectRevert();
        vm.prank(alice);
        vault.withdraw(60_000 * 1e6, alice, alice);

        vm.prank(alice);
        uint256 sharesBurned = vault.withdraw(40_000 * 1e6, alice, alice);
        assertTrue(sharesBurned > 0, "Withdrawal within Q_sync succeeds");
    }

    // ========================================================================
    // 3. Stale Chainlink Oracle Reward Valuation & Deposit Shutdown (§9.2, §12)
    // ========================================================================
    function test_edgeCase_staleChainlinkOracleClosesDepositsAndMints() external {
        accountant = new RewardAccountant(admin);
        rewardFeed = new MockChainlinkFeed(10 * 1e8);
        usdcFeed = new MockChainlinkFeed(1 * 1e8);

        EdgeCaseUSDC rewardToken = new EdgeCaseUSDC("Reward Token", "RWD", 6);
        rewardToken.mint(address(accountant), 1_000 * 1e6);

        address[] memory allowed = new address[](1);
        allowed[0] = address(adapterA);

        IRewardAccountant.TokenPolicy memory policy = IRewardAccountant.TokenPolicy({
            token: address(rewardToken),
            feed: address(rewardFeed),
            description: bytes("REWARD"),
            decimals: 6,
            maxAge: 3600,
            lowerBound: 1,
            upperBound: 1000 * 1e8,
            haircutBps: 9000,
            contributionCap: 100_000 * 1e6,
            materialityThreshold: 0,
            cacheLifetime: 3600,
            allowedAdapters: allowed,
            exists: true
        });

        vm.startPrank(admin);
        accountant.setTokenPolicy(address(rewardToken), policy);
        accountant.setUsdcUsdFeed(address(usdcFeed));
        vault.setRewardAccountant(address(accountant));
        vm.stopPrank();

        vm.prank(alice);
        vault.deposit(10_000 * 1e6, alice);

        // Initial refresh to populate material cache entry
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapterA);
        vm.prank(admin);
        accountant.refresh(adapters);

        // Fast forward past cache lifetime (3600s)
        vm.warp(block.timestamp + 7200);

        assertEq(vault.maxDeposit(bob), 0, "maxDeposit 0 when feed stale");

        vm.expectRevert();
        vm.prank(bob);
        vault.deposit(5_000 * 1e6, bob);

        vm.prank(alice);
        uint256 redeemed = vault.redeem(1_000 * 1e6, alice, alice);
        assertTrue(redeemed > 0, "Redemption still works when feed stale");
    }

    // ========================================================================
    // 4. Staged Plan Partial Execution & Deployment Failure Recovery (§9.5, §12)
    // ========================================================================
    function test_edgeCase_stagedPlanPartialExecutionPreservesIdleAssets() external {
        vm.prank(alice);
        vault.deposit(100_000 * 1e6, alice);

        // Initial deploy 50k to A
        VaultTypes.PlanHeader memory header0 = _buildPlanHeader(1, 1, uint64(block.timestamp + 3600));
        NavyVaultSRCLA.Action memory act0 = NavyVaultSRCLA.Action({
            planId: 1,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapterA),
            amount: 50_000 * 1e6,
            minOut: 0,
            dataHash: bytes32(0)
        });

        bytes32 leaf0 = vault.hashPlanAction(vault.planDomain(header0), act0);
        bytes32[] memory leaves0 = new bytes32[](1);
        leaves0[0] = leaf0;

        vm.startPrank(allocator);
        vault.submitPlan(header0, MerkleTree.computeRoot(leaves0));
        vault.executeNextActionWithProof(new bytes32[](0), act0);
        vm.stopPrank();

        // Staged rebalance plan: Action 0 = Divest A; Action 1 = Deploy B
        VaultTypes.PlanHeader memory header1 = _buildPlanHeader(2, 2, uint64(block.timestamp + 3600));
        NavyVaultSRCLA.Action memory act1_0 = NavyVaultSRCLA.Action({
            planId: 2,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(adapterA),
            amount: 50_000 * 1e6,
            minOut: 0,
            dataHash: bytes32(0)
        });
        NavyVaultSRCLA.Action memory act1_1 = NavyVaultSRCLA.Action({
            planId: 2,
            index: 1,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapterB),
            amount: 50_000 * 1e6,
            minOut: 0,
            dataHash: bytes32(0)
        });

        bytes32 l1_0 = vault.hashPlanAction(vault.planDomain(header1), act1_0);
        bytes32 l1_1 = vault.hashPlanAction(vault.planDomain(header1), act1_1);
        bytes32[] memory leaves1 = new bytes32[](2);
        leaves1[0] = l1_0;
        leaves1[1] = l1_1;

        vm.startPrank(allocator);
        vault.submitPlan(header1, MerkleTree.computeRoot(leaves1));

        bytes32[] memory proof0 = new bytes32[](1);
        proof0[0] = l1_1;
        vault.executeNextActionWithProof(proof0, act1_0);
        vm.stopPrank();

        // Pause Adapter B before Action 1
        adapterB.setPaused(true);

        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = l1_0;

        vm.expectRevert("Adapter paused");
        vm.prank(allocator);
        vault.executeNextActionWithProof(proof1, act1_1);

        // Assets conserved as idle USDC in vault
        assertEq(usdc.balanceOf(address(vault)), 100_000 * 1e6, "Assets conserved as idle USDC");
        assertEq(vault.totalAssets(), 100_000 * 1e6, "Total assets conserved");
    }

    // ========================================================================
    // 5. Shared Dependency Group Cap Violation (§6.1, §8.2)
    // ========================================================================
    function test_edgeCase_dependencyGroupCapRejectsOverconcentration() external {
        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = keccak256("ProtocolFamilyX");

        address[] memory members = new address[](2);
        members[0] = address(adapterA);
        members[1] = address(adapterB);

        vm.startPrank(admin);
        vault.setDependencyGroup(groupIds[0], 6_000, 1_000_000 * 1e6, members);
        vm.stopPrank();

        vm.prank(alice);
        vault.deposit(100_000 * 1e6, alice);

        VaultTypes.PlanHeader memory header = _buildPlanHeader(1, 2, uint64(block.timestamp + 3600));
        NavyVaultSRCLA.Action memory act0 = NavyVaultSRCLA.Action({
            planId: 1,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapterA),
            amount: 40_000 * 1e6,
            minOut: 0,
            dataHash: bytes32(0)
        });
        NavyVaultSRCLA.Action memory act1 = NavyVaultSRCLA.Action({
            planId: 1,
            index: 1,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapterB),
            amount: 30_000 * 1e6,
            minOut: 0,
            dataHash: bytes32(0)
        });

        bytes32 l0 = vault.hashPlanAction(vault.planDomain(header), act0);
        bytes32 l1 = vault.hashPlanAction(vault.planDomain(header), act1);
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = l0;
        leaves[1] = l1;

        vm.startPrank(allocator);
        vault.submitPlan(header, MerkleTree.computeRoot(leaves));

        bytes32[] memory p0 = new bytes32[](1);
        p0[0] = l1;
        vault.executeNextActionWithProof(p0, act0);

        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l0;
        vm.expectRevert();
        vault.executeNextActionWithProof(p1, act1);
        vm.stopPrank();
    }

    // ========================================================================
    // 6. Moonwell Non-Zero Return Code Edge Case (§6.5, §12)
    // ========================================================================
    function test_edgeCase_moonwellNonZeroErrorCodeTriggersRevert() external {
        vm.prank(alice);
        vault.deposit(100_000 * 1e6, alice);

        adapterA.setMockErrorCode(13);

        VaultTypes.PlanHeader memory header = _buildPlanHeader(1, 1, uint64(block.timestamp + 3600));
        NavyVaultSRCLA.Action memory act = NavyVaultSRCLA.Action({
            planId: 1,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(adapterA),
            amount: 10_000 * 1e6,
            minOut: 0,
            dataHash: bytes32(0)
        });

        bytes32 leaf = vault.hashPlanAction(vault.planDomain(header), act);
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = leaf;

        vm.startPrank(allocator);
        vault.submitPlan(header, MerkleTree.computeRoot(leaves));

        vm.expectRevert("Moonwell error code non-zero");
        vault.executeNextActionWithProof(new bytes32[](0), act);
        vm.stopPrank();
    }
}
