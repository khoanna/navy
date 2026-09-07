// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {VaultTypes} from "../../src/libraries/VaultTypes.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @title PlanEncodingGoldenVectors
/// @notice Produces golden `planDomain`/`hashPlanAction` outputs by calling the
/// REAL, deployed `NavyVaultSRCLA` contract on fixed inputs, so
/// `srcla/test/unit/policy/plan.spec.ts` has an oracle for its ABI encoding
/// that is independent of the TypeScript encoder under test (Task 10,
/// Finding 2). Run with:
///
///   cd contract && forge test --match-contract PlanEncodingGoldenVectorsTest -vv
///
/// and copy the logged `bytes32` values (and the exact inputs printed
/// alongside them) into plan.spec.ts as literal constants.
contract PlanEncodingGoldenVectorsTest is Test {
    NavyVaultSRCLA public vault;
    MockUSDC public usdc;

    // Fixed inputs, chosen so a field-order or type transposition anywhere in
    // the header or action tuple would change the resulting hash: no two
    // fields of the same Solidity type share a value, including the three
    // adjacent uint64 fields (policyVersion, createdAt, expiresAt).
    uint256 internal constant GOLDEN_CHAIN_ID = 8453;
    address internal constant GOLDEN_ADAPTER_0 = address(0xAdA97e000000000000000000000000000000BEEf);
    address internal constant GOLDEN_ADAPTER_1 = address(0xaDa97E000000000000000000000000000001CaFe);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        vm.chainId(GOLDEN_CHAIN_ID);
    }

    function _goldenHeader() internal view returns (VaultTypes.PlanHeader memory) {
        return VaultTypes.PlanHeader({
            planId: 12345,
            policyVersion: 7,
            createdAt: 1_700_000_001,
            expiresAt: 1_700_003_601,
            actionCount: 2,
            snapshotBlockNumber: 999_999,
            snapshotHash: keccak256("golden-snapshot"),
            decisionHash: keccak256("golden-decision"),
            configurationDigest: keccak256("golden-config-digest"),
            reserve: 5_000_000,
            minFinalAssets: 900_000_000,
            maxRecognizedLoss: 25_000_000,
            turnoverLimit: 50_000_000
        });
    }

    /// @dev Logs everything srcla's plan.spec.ts needs to reproduce this
    /// vector byte-for-byte: the chain id, the deployed vault/asset
    /// addresses (deterministic for this test's deployer+nonce, but printed
    /// rather than assumed), every header field, both actions, and the two
    /// resulting hashes.
    function testGoldenVectors() public {
        VaultTypes.PlanHeader memory header = _goldenHeader();

        bytes32 domain = vault.planDomain(header);

        NavyVaultSRCLA.Action memory action0 = NavyVaultSRCLA.Action({
            planId: header.planId,
            index: 0,
            kind: NavyVaultSRCLA.ActionKind.Deploy,
            adapter: GOLDEN_ADAPTER_0,
            amount: 1_234_567,
            minOut: 1_200_000,
            dataHash: keccak256("golden-action-0-data")
        });
        NavyVaultSRCLA.Action memory action1 = NavyVaultSRCLA.Action({
            planId: header.planId,
            index: 1,
            kind: NavyVaultSRCLA.ActionKind.Divest,
            adapter: GOLDEN_ADAPTER_1,
            amount: 7_654_321,
            minOut: 7_600_000,
            dataHash: keccak256("golden-action-1-data")
        });

        bytes32 leaf0 = vault.hashPlanAction(domain, action0);
        bytes32 leaf1 = vault.hashPlanAction(domain, action1);

        console2.log("chainId", block.chainid);
        console2.log("vaultAddress", address(vault));
        console2.log("assetAddress", address(usdc));
        console2.log("---- header ----");
        console2.log("planId", header.planId);
        console2.log("policyVersion", header.policyVersion);
        console2.log("createdAt", header.createdAt);
        console2.log("expiresAt", header.expiresAt);
        console2.log("actionCount", header.actionCount);
        console2.log("snapshotBlockNumber", header.snapshotBlockNumber);
        console2.log("snapshotHash");
        console2.logBytes32(header.snapshotHash);
        console2.log("decisionHash");
        console2.logBytes32(header.decisionHash);
        console2.log("configurationDigest");
        console2.logBytes32(header.configurationDigest);
        console2.log("reserve", header.reserve);
        console2.log("minFinalAssets", header.minFinalAssets);
        console2.log("maxRecognizedLoss", header.maxRecognizedLoss);
        console2.log("turnoverLimit", header.turnoverLimit);
        console2.log("---- domain ----");
        console2.logBytes32(domain);
        console2.log("---- action0 ----");
        console2.log("adapter", action0.adapter);
        console2.log("amount", action0.amount);
        console2.log("minOut", action0.minOut);
        console2.logBytes32(action0.dataHash);
        console2.log("leaf0");
        console2.logBytes32(leaf0);
        console2.log("---- action1 ----");
        console2.log("adapter", action1.adapter);
        console2.log("amount", action1.amount);
        console2.log("minOut", action1.minOut);
        console2.logBytes32(action1.dataHash);
        console2.log("leaf1");
        console2.logBytes32(leaf1);

        // Sanity: the two leaves must differ (they encode different
        // index/kind/adapter/amount/minOut/dataHash) and neither is zero.
        assertTrue(domain != bytes32(0));
        assertTrue(leaf0 != bytes32(0));
        assertTrue(leaf1 != bytes32(0));
        assertTrue(leaf0 != leaf1);
    }
}
