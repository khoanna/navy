// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fund tier vaults with USDC after deployment
contract FundTierVaults is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Tier vault addresses from DeployTierVaults
    address constant VAULT_10K = 0x12A54Ea3f4A5F55a3c834fb052A961Db5dFE5F18;
    address constant VAULT_100K = 0x84Ea3561f93FF84C7086f3510b242A29B6E4890a;
    address constant VAULT_1M = 0x60F60E8c9411A03A018f89222f2593eed54aDf82;
    address constant VAULT_10M = 0x92261C1938B153fB03f37F3DFBd372ba9c65Cc16;

    // Whale addresses with USDC on Base
    address constant WHALE1 = 0xc8628ca4f4580C5b93C8Dd47D41C23B22Ef74d1A;
    address constant WHALE2 = 0x0c421c1D79fBf9f6D24c08f2f1c2B47B3e8c63A0;

    uint256 constant TIER_10K = 10_000e6;
    uint256 constant TIER_100K = 100_000e6;
    uint256 constant TIER_1M = 1_000_000e6;
    uint256 constant TIER_10M = 10_000_000e6;

    function run() external {
        console2.log("Funding tier vaults with USDC...");
        console2.log("");

        // Get whale balances first
        uint256 whale1Bal = IERC20(USDC).balanceOf(WHALE1);
        uint256 whale2Bal = IERC20(USDC).balanceOf(WHALE2);
        console2.log("Whale1 USDC balance: %s", whale1Bal);
        console2.log("Whale2 USDC balance: %s", whale2Bal);
        console2.log("");

        // Fund 10K vault
        vm.startPrank(WHALE1);
        IERC20(USDC).transfer(VAULT_10K, TIER_10K);
        vm.stopPrank();
        console2.log("Funded 10K vault: %s", IERC20(USDC).balanceOf(VAULT_10K));

        // Fund 100K vault
        vm.startPrank(WHALE1);
        IERC20(USDC).transfer(VAULT_100K, TIER_100K);
        vm.stopPrank();
        console2.log("Funded 100K vault: %s", IERC20(USDC).balanceOf(VAULT_100K));

        // Fund 1M vault
        vm.startPrank(WHALE1);
        IERC20(USDC).transfer(VAULT_1M, TIER_1M);
        vm.stopPrank();
        console2.log("Funded 1M vault: %s", IERC20(USDC).balanceOf(VAULT_1M));

        // Fund 10M vault
        vm.startPrank(WHALE2);
        IERC20(USDC).transfer(VAULT_10M, TIER_10M);
        vm.stopPrank();
        console2.log("Funded 10M vault: %s", IERC20(USDC).balanceOf(VAULT_10M));

        console2.log("");
        console2.log("=== Final Balances ===");
        console2.log("VAULT_10K=%s", IERC20(USDC).balanceOf(VAULT_10K));
        console2.log("VAULT_100K=%s", IERC20(USDC).balanceOf(VAULT_100K));
        console2.log("VAULT_1M=%s", IERC20(USDC).balanceOf(VAULT_1M));
        console2.log("VAULT_10M=%s", IERC20(USDC).balanceOf(VAULT_10M));
    }
}
