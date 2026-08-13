// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "src/adapters/AaveV3Adapter.sol";
import {CompoundAdapter} from "src/adapters/CompoundAdapter.sol";
import {VaultTypes} from "src/libraries/VaultTypes.sol";

/// @notice Live Base coverage for the domain-bound Merkle plan path.
contract PlanExecutionForkTest is Test {
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address internal constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address internal constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    NavyVaultSRCLA internal vault;
    AaveV3Adapter internal aave;
    CompoundAdapter internal compound;
    address internal allocator;
    bool internal forkCreated;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        forkCreated = true;
        vm.createSelectFork(rpc);
        allocator = makeAddr("allocator");

        vault = new NavyVaultSRCLA(IERC20(USDC));
        aave = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        compound = new CompoundAdapter(address(vault), USDC, COMET);
        vault.registerAdapter(address(aave), 5_000, 100, "Aave");
        vault.registerAdapter(address(compound), 5_000, 100, "Compound");
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
    }

    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }

    function _plan(NavyVaultSRCLA.Action memory action, uint64 expiresAt)
        internal
        view
        returns (VaultTypes.PlanHeader memory header, bytes32 leaf)
    {
        header = VaultTypes.PlanHeader({
            planId: action.planId,
            policyVersion: 1,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            actionCount: 1,
            snapshotBlockNumber: block.number,
            snapshotHash: keccak256("base-fork-snapshot"),
            decisionHash: keccak256("base-fork-decision"),
            configurationDigest: vault.currentConfigurationDigest(),
            reserve: 0,
            minFinalAssets: 0,
            maxRecognizedLoss: 1e6,
            turnoverLimit: type(uint256).max
        });
        leaf = vault.hashPlanAction(vault.planDomain(header), action);
    }

    function _submitAndExecute(NavyVaultSRCLA.Action memory action) internal {
        (VaultTypes.PlanHeader memory header, bytes32 leaf) = _plan(action, uint64(block.timestamp + 1 hours));
        vm.startPrank(allocator);
        vault.submitPlan(header, leaf);
        vault.executeNextActionWithProof(new bytes32[](0), action);
        vm.stopPrank();
    }

    function test_deployAndDivestAcrossRealProtocols() external withFork {
        deal(USDC, address(vault), 200e6);
        NavyVaultSRCLA.Action memory deployAave = NavyVaultSRCLA.Action({
            planId: 1,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aave),
            amount: 90e6,
            minOut: 89e6
        });
        _submitAndExecute(deployAave);

        NavyVaultSRCLA.Action memory deployCompound = NavyVaultSRCLA.Action({
            planId: 2,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(compound),
            amount: 90e6,
            minOut: 89e6
        });
        _submitAndExecute(deployCompound);
        assertGt(aave.totalAssets(), 0);
        assertGt(compound.totalAssets(), 0);

        NavyVaultSRCLA.Action memory divestAave = NavyVaultSRCLA.Action({
            planId: 3,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: address(aave),
            amount: 45e6,
            minOut: 44e6
        });
        _submitAndExecute(divestAave);
        assertGe(IERC20(USDC).balanceOf(address(vault)), 65e6);
    }

    function test_planExpiresBeforeExecution() external withFork {
        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: 4,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aave),
            amount: 1e6,
            minOut: 1e6
        });
        (VaultTypes.PlanHeader memory header, bytes32 leaf) = _plan(action, uint64(block.timestamp + 1));
        vm.prank(allocator);
        vault.submitPlan(header, leaf);
        vm.warp(block.timestamp + 2);
        vm.prank(allocator);
        vm.expectRevert(NavyVaultSRCLA.PlanExecutionExpired.selector);
        vault.executeNextActionWithProof(new bytes32[](0), action);
    }

    function test_onlyAllocatorCanSubmitPlan() external withFork {
        NavyVaultSRCLA.Action memory action = NavyVaultSRCLA.Action({
            planId: 5,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: address(aave),
            amount: 1e6,
            minOut: 1e6
        });
        (VaultTypes.PlanHeader memory header, bytes32 leaf) = _plan(action, uint64(block.timestamp + 1 hours));
        vm.prank(makeAddr("not-allocator"));
        vm.expectRevert();
        vault.submitPlan(header, leaf);
    }
}
