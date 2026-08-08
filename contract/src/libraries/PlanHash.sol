// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultTypes} from "./VaultTypes.sol";

library PlanHash {
    bytes32 internal constant PLAN_HEADER_TYPEHASH = keccak256(
        "PlanHeader(uint256 planId,uint64 policyVersion,uint64 createdAt,uint64 expiresAt,uint32 actionCount,uint256 snapshotBlockNumber,bytes32 snapshotHash,bytes32 decisionHash,bytes32 configurationDigest,uint256 reserve,uint256 minFinalAssets,uint256 maxRecognizedLoss,uint256 turnoverLimit)"
    );

    function hashPlanHeader(VaultTypes.PlanHeader calldata header) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PLAN_HEADER_TYPEHASH,
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

    function hashAction(VaultTypes.Action calldata action) internal pure returns (bytes32) {
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
