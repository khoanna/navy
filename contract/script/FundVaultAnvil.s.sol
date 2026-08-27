// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Funds the vault with USDC from Compound Comet on Anvil fork
contract FundVaultAnvil is Script {
    function run() external {
        address vault = 0x80127D99143f6ae4b89aAc0698A7341aaCd93fb3;
        address usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        address comet = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

        console2.log("Comet USDC balance before:", IERC20(usdc).balanceOf(comet));

        // Impersonate Comet and transfer
        vm.startPrank(comet);
        uint256 amount = 500_000_000_000; // 500K USDC
        IERC20(usdc).transfer(vault, amount);
        vm.stopPrank();

        console2.log("Vault USDC balance:", IERC20(usdc).balanceOf(vault));
        console2.log("Done!");
    }
}
