// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";

/// @title ConfigureAnvil
/// @notice Tops up a deployed vault with USDC on an Anvil fork of Base and
///         prints its NAV.
/// @dev Reads VAULT_ADDRESS from the environment. Every Anvil deploy is a fresh
///      fork, so the address changes each time and must never be hardcoded --
///      this script previously pinned one, which silently pointed at whatever
///      happened to live there.
contract ConfigureAnvil is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    function run() external {
        address vault = vm.envAddress("VAULT_ADDRESS");

        uint256 vaultBal = IERC20(USDC).balanceOf(vault);
        console2.log("Vault USDC balance (before):", vaultBal);

        if (vaultBal < 100_000_000) {
            vm.startPrank(COMET);
            IERC20(USDC).transfer(vault, 1_000_000_000_000);
            vm.stopPrank();
            console2.log("Vault USDC balance (after fund):", IERC20(USDC).balanceOf(vault));
        }

        console2.log("Vault total assets:", NavyVaultSRCLA(vault).totalAssets());
    }
}
