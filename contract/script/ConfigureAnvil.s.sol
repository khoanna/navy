// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSimple} from "../src/NavyVaultSimple.sol";

contract ConfigureAnvil is Script {
    function run() external {
        address vault = 0x80127D99143f6ae4b89aAc0698A7341aaCd93fb3;
        address usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        address comet = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

        uint256 vaultBal = IERC20(usdc).balanceOf(vault);
        console2.log("Vault USDC balance (before):", vaultBal);

        if (vaultBal < 100_000_000) {
            vm.startPrank(comet);
            IERC20(usdc).transfer(vault, 1_000_000_000_000);
            vm.stopPrank();
            console2.log("Vault USDC balance (after fund):", IERC20(usdc).balanceOf(vault));
        }

        console2.log("Vault total assets:", NavyVaultSimple(vault).totalAssets());
    }
}
