// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";

/// @notice Direct deployment script - bypasses size checks
contract DeployDirect is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        // Deploy vault
        NavyVaultSRCLA vault = new NavyVaultSRCLA(IERC20(USDC));

        // Grant roles to deployer
        vault.grantRole(vault.ADMIN_ROLE(), deployer);
        vault.grantRole(vault.ALLOCATOR_ROLE(), deployer);

        vm.stopBroadcast();

        console2.log("VAULT_ADDRESS=%s", address(vault));
        console2.log("DEPLOYER_ADDRESS=%s", deployer);
    }
}
