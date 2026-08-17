// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/// @title Write Deployment Manifest
/// @notice Records deployment artifacts and metadata for verification and audit
/// @dev Run after successful deployment to generate manifest
contract WriteDeploymentManifest is Script {
    struct DeploymentManifest {
        uint256 chainId;
        uint256 blockNumber;
        bytes32 blockHash;
        uint256 timestamp;
        address vault;
        address rewardAccountant;
        address rewardExecutor;
        address usdc;
        address[] adapters;
        uint256 totalSupply;
        uint256 totalAssets;
    }

    function run(address vault, address rewardAccountant, address rewardExecutor, address usdc) external {
        console2.log("===========================================");
        console2.log("Writing Deployment Manifest");
        console2.log("===========================================");

        DeploymentManifest memory manifest = DeploymentManifest({
            chainId: block.chainid,
            blockNumber: block.number,
            blockHash: blockhash(block.number),
            timestamp: block.timestamp,
            vault: vault,
            rewardAccountant: rewardAccountant,
            rewardExecutor: rewardExecutor,
            usdc: usdc,
            adapters: new address[](0),
            totalSupply: 0,
            totalAssets: 0
        });

        console2.log("Chain ID:", manifest.chainId);
        console2.log("Block:", manifest.blockNumber);
        console2.log("Vault:", manifest.vault);
        console2.log("RewardAccountant:", manifest.rewardAccountant);
        console2.log("RewardExecutor:", manifest.rewardExecutor);
        console2.log("USDC:", manifest.usdc);

        // Emit manifest for capture
        console2.log("manifest_chainId:", manifest.chainId);
        console2.log("manifest_blockNumber:", manifest.blockNumber);
        console2.log("manifest_vault:", manifest.vault);
        console2.log("manifest_rewardAccountant:", manifest.rewardAccountant);
        console2.log("manifest_rewardExecutor:", manifest.rewardExecutor);
        console2.log("manifest_usdc:", manifest.usdc);

        console2.log("");
        console2.log("===========================================");
        console2.log("Manifest written to deployment logs");
        console2.log("===========================================");
    }
}
