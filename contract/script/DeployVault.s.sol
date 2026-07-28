// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Deploys NavyVault + CompoundAdapter, wires roles, and registers the adapter. Env-driven.
/// MorphoAdapter is deployed/registered separately once its market params are pinned (Task 9/10).
contract DeployVault is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("NAVY_USDC_ADDRESS");
        address ownerAddr = vm.envAddress("NAVY_OWNER_ADDRESS");
        address relayer = vm.envAddress("NAVY_RELAYER_ADDRESS");
        address keeper = vm.envAddress("NAVY_KEEPER_ADDRESS");
        address comet = vm.envAddress("NAVY_COMET_ADDRESS");

        vm.startBroadcast(deployerPk);
        NavyVault vault = new NavyVault(IERC20(usdc), ownerAddr);
        CompoundAdapter compound = new CompoundAdapter(address(vault), usdc, comet);
        if (vm.addr(deployerPk) == ownerAddr) {
            vault.setRelayer(relayer, true);
            vault.setAllocator(keeper, true);
            vault.addAdapter(address(compound), 10000, 10000);
            vault.setParams(1000, 50); // 10% idle buffer, 0.5% max loss
        }
        vm.stopBroadcast();

        console2.log("NavyVault:", address(vault));
        console2.log("CompoundAdapter:", address(compound));
    }
}
