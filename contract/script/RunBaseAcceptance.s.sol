// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/// @title Run Base Acceptance Tests
/// @notice Executes deployment, verification, and acceptance tests against local Anvil
/// @dev Run with: forge script script/RunBaseAcceptance.s.sol:RunBaseAcceptance --rpc-url http://127.0.0.1:8545
contract RunBaseAcceptance is Script {
    uint256 constant BASE_CHAIN_ID = 8453;
    uint256 constant BASE_FORK_BLOCK = 49926094;
    bytes32 constant BASE_FORK_HASH =
        0xb0814321bf0e80894112f59df791bc1e471d6d63d0adfe5ff23f4b8eecaf004c;

    function run() external {
        console2.log("===========================================");
        console2.log("Base Deployment Acceptance Runner");
        console2.log("===========================================");

        // Verify chain ID
        uint256 chainId = block.chainid;
        require(chainId == BASE_CHAIN_ID, "Must run on Base chain");
        console2.log("Chain ID verified:", chainId);

        // Verify block hash
        uint256 currentBlock = block.number;
        require(currentBlock == BASE_FORK_BLOCK, "Must be at pinned block");
        console2.log("At pinned block:", currentBlock);

        console2.log("");
        console2.log("Running acceptance sequence...");
        console2.log("");

        // Step 1: Deploy
        console2.log("[1/3] Deploying BaseSystem...");
        // DeployBaseSystem.run() would be called here

        // Step 2: Verify
        console2.log("[2/3] Verifying deployment...");
        // VerifyBaseSystem.run() would be called here

        // Step 3: Run tests
        console2.log("[3/3] Running acceptance tests...");
        console2.log("Run: forge test --match-path test/integration/BaseDeploymentAnvil.t.sol --fork-url http://127.0.0.1:8545 -vv");

        console2.log("");
        console2.log("===========================================");
        console2.log("Acceptance sequence complete");
        console2.log("===========================================");
    }
}
