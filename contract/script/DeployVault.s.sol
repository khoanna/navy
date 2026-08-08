// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Deploys the immutable Base vault core with admin + allocator configured at construction.
contract DeployVault is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("NAVY_USDC_ADDRESS");
        address ownerAddr = vm.envAddress("NAVY_OWNER_ADDRESS");
        address allocatorAddr = vm.envAddress("NAVY_KEEPER_ADDRESS");

        vm.startBroadcast(deployerPk);
        NavyVault vault = new NavyVault(IERC20(usdc), ownerAddr, allocatorAddr);
        vm.stopBroadcast();

        console2.log("NavyVault:", address(vault));
    }
}
