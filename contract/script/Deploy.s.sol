// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NavyPayments} from "../src/NavyPayments.sol";

/// @dev Deploys NavyPayments and allowlists the relayer. Env-driven.
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("NAVY_USDC_ADDRESS");
        address treasury = vm.envAddress("NAVY_TREASURY_ADDRESS");
        address ownerAddr = vm.envAddress("NAVY_OWNER_ADDRESS");
        address relayer = vm.envAddress("NAVY_RELAYER_ADDRESS");
        uint16 feeBps = uint16(vm.envUint("NAVY_FEE_BPS"));

        vm.startBroadcast(deployerPk);
        NavyPayments navy = new NavyPayments(usdc, treasury, feeBps, ownerAddr);
        // If the deployer is the owner, allowlist the relayer in the same run.
        if (vm.addr(deployerPk) == ownerAddr) {
            navy.setRelayer(relayer, true);
        }
        vm.stopBroadcast();

        console2.log("NavyPayments deployed at:", address(navy));
        console2.log("owner:", ownerAddr);
        console2.log("relayer allowlisted:", vm.addr(deployerPk) == ownerAddr);
    }
}
