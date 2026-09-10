// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NavyPayments} from "../src/NavyPayments.sol";

/// @dev Deploys NavyPayments and allowlists the relayer. Env-driven.
contract Deploy is Script {
    uint256 internal constant BASE_CHAIN_ID = 8453;
    /// @dev Circle native USDC on Base (EIP-3009 + EIP-2612). An Anvil fork of Base inherits both.
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        require(block.chainid == BASE_CHAIN_ID, "Base only (chainId 8453)");
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("NAVY_USDC_ADDRESS");
        require(usdc == BASE_USDC, "wrong USDC: expected Circle Base USDC");
        address treasury = vm.envAddress("NAVY_TREASURY_ADDRESS");
        address ownerAddr = vm.envAddress("NAVY_OWNER_ADDRESS");
        address relayer = vm.envAddress("NAVY_RELAYER_ADDRESS");
        require(treasury != address(0) && ownerAddr != address(0) && relayer != address(0), "zero config");
        uint256 rawFeeBps = vm.envUint("NAVY_FEE_BPS");
        require(rawFeeBps <= 1000, "NAVY_FEE_BPS out of range");
        uint16 feeBps = uint16(rawFeeBps);

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
