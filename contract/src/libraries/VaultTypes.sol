// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library VaultTypes {
    enum AdapterStatus {
        None,
        Active,
        Disabled,
        Impaired,
        Removed
    }

    struct AdapterConfig {
        AdapterStatus status;
        uint16 capBps;
        uint256 absoluteCap;
        uint16 maxLossBps;
        uint256 accountingCap;
    }

    struct DependencyGroup {
        uint16 capBps;
        uint256 absoluteCap;
        address[] members;
        bool exists;
    }

    struct PlanHeader {
        uint256 planId;
        uint64 policyVersion;
        uint64 createdAt;
        uint64 expiresAt;
        uint32 actionCount;
        uint256 snapshotBlockNumber;
        bytes32 snapshotHash;
        bytes32 decisionHash;
        bytes32 configurationDigest;
        uint256 reserve;
        uint256 minFinalAssets;
        uint256 maxRecognizedLoss;
        uint256 turnoverLimit;
    }

    struct HarvestRequest {
        address adapter;
        address token;
        uint256 maxClaim;
        bytes32 routeId;
        uint256 minOut;
        uint256 deadline;
    }
}
