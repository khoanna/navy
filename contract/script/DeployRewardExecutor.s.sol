// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {RewardExecutor} from "../src/RewardExecutor.sol";

contract DeployRewardExecutor is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address vault = vm.envAddress("NAVY_VAULT_SRCLA_ADDRESS");
        address usdc = vm.envAddress("SEPOLIA_USDC_ADDRESS");

        // Uniswap V3 addresses (same on Base mainnet)
        address router = 0x2626664c2603336E57B271c5C0b26F421741e481;

        vm.startBroadcast(deployerPrivateKey);

        RewardExecutor executor = new RewardExecutor(
            vault,
            msg.sender, // admin
            router,
            usdc
        );

        console2.log("RewardExecutor deployed to:", address(executor));
        console2.log("Admin role granted to:", msg.sender);
        console2.log("Vault:", vault);

        vm.stopBroadcast();
    }
}
