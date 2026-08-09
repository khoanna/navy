// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";

/// @notice Deploys NavyVaultSRCLA on Sepolia.
/// @dev Verifies USDC decimals before deployment. Admin is the deployer (msg.sender).
contract DeployNavyVaultSRCLA is Script {
    uint8 public constant USDC_DECIMALS = 6;

    error WrongUsdcDecimals();

    function run() external returns (NavyVaultSRCLA vault) {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("SEPOLIA_USDC_ADDRESS");
        address deployer = vm.addr(deployerPk);

        // Verify USDC decimals
        uint8 decimals = IERC20Metadata(usdc).decimals();
        if (decimals != USDC_DECIMALS) revert WrongUsdcDecimals();

        vm.startBroadcast(deployerPk);
        vault = new NavyVaultSRCLA(IERC20(usdc));
        vm.stopBroadcast();

        console2.log("NavyVaultSRCLA deployed at:", address(vault));
        console2.log("admin:", deployer);
        console2.log("USDC:", usdc);
    }
}
