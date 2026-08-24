// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";
import {MockERC20} from "../src/MockERC20.sol";

/// @notice Deployment with mock USDC for testing
contract DeployWithMock is Script {
    function run() external {
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        // Deploy mock USDC
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        console2.log("MOCK_USDC=%s", address(usdc));

        // Deploy vault with mock USDC
        NavyVaultSRCLA vault = new NavyVaultSRCLA(IERC20(address(usdc)));
        console2.log("VAULT_ADDRESS=%s", address(vault));

        // Grant roles to deployer
        vault.grantRole(vault.ADMIN_ROLE(), deployer);
        vault.grantRole(vault.ALLOCATOR_ROLE(), deployer);

        // Mint some USDC to deployer for testing
        usdc.mint(deployer, 100_000_000_000_000); // 100M USDC (6 decimals)

        vm.stopBroadcast();

        console2.log("DEPLOYER_ADDRESS=%s", deployer);
    }
}
