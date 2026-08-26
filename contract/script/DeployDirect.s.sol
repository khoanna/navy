// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {NavyVaultSimple} from "../src/NavyVaultSimple.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployDirect is Script {
    function run() external {
        uint256 pk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(pk);
        console2.log("Deployer:", deployer);
        
        vm.startBroadcast(pk);
        NavyVaultSimple vault = new NavyVaultSimple(IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913));
        console2.log("Vault deployed at:", address(vault));
        vm.stopBroadcast();
    }
}
