// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

/// @title BaseForkTest
/// @notice Base harness for Base mainnet fork tests
/// @dev Reads BASE_RPC_URL from env, creates fork at configurable block
///      Skips tests gracefully if RPC not available
abstract contract BaseForkTest is Test {
    /// @notice Base mainnet chain ID
    uint256 constant BASE_CHAIN_ID = 8453;

    /// @notice Base USDC address
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    /// @notice Whether fork was created successfully
    bool public forkCreated;

    /// @notice The fork ID
    uint256 public forkId;

    /// @notice Initialize the fork - call this at the start of setUp()
    function _initFork() internal {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            // No RPC available - tests will skip
            forkCreated = false;
            return;
        }

        // Allow overriding the block number for testing different states
        uint256 blockNumber = vm.envOr("BASE_FORK_BLOCK", uint256(0));

        if (blockNumber > 0) {
            forkId = vm.createFork(rpcUrl, blockNumber);
        } else {
            forkId = vm.createFork(rpcUrl);
        }

        vm.selectFork(forkId);
        forkCreated = true;
    }

    /// @notice Helper to skip if fork was not created
    modifier skipWithoutFork() {
        if (!forkCreated) {
            vm.skip(true);
        }
        _;
    }
}
