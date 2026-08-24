// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fund the vault with USDC for testing using direct transfers
contract FundVault is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant VAULT = 0xFd9550248998493916802127b847998e40d316D6;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    function run() external {
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        console2.log("Deployer:", deployer);
        console2.log("Vault:", VAULT);
        console2.log("Comet:", COMET);

        // Impersonate Comet using startPrank which works with broadcast
        vm.startPrank(COMET, deployer);

        // Check Comet balance
        uint256 cometBalance = IERC20(USDC).balanceOf(COMET);
        console2.log("Comet USDC balance:", cometBalance);

        // Transfer from Comet to deployer
        IERC20(USDC).transfer(deployer, 1000000 * 1e6); // 1M USDC

        vm.stopPrank();

        // Check deployer balance
        uint256 deployerBalance = IERC20(USDC).balanceOf(deployer);
        console2.log("Deployer USDC balance:", deployerBalance);

        // Approve vault to spend
        vm.prank(deployer);
        IERC20(USDC).approve(VAULT, 1000000 * 1e6);

        // Deposit into vault via deposit function
        vm.prank(deployer);
        (bool success,) = VAULT.call(abi.encodeWithSignature("deposit(uint256,address)", 1000000 * 1e6, deployer));
        require(success, "deposit failed");

        // Check vault balance
        uint256 vaultBalance = IERC20(USDC).balanceOf(VAULT);
        console2.log("Vault USDC balance:", vaultBalance);

        console2.log("VAULT_ADDRESS=%s", VAULT);
        console2.log("SUCCESS: Vault funded with 1M USDC!");
    }
}
