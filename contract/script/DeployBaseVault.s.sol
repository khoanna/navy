// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NavyVault} from "../src/NavyVault.sol";

/// @notice Deploys only the immutable Base ERC-4626 core.
/// @dev Strategy adapters and the reward executor are separate deployments and are admitted later by the admin.
contract DeployBaseVault is Script {
    uint256 public constant BASE_CHAIN_ID = 8453;
    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    error WrongChain();
    error WrongAsset();
    error InvalidAdmin();
    error InvalidAllocator();
    error RoleCollision();

    function run() external returns (NavyVault vault) {
        uint256 adminPk = vm.envUint("BASE_ADMIN_PRIVATE_KEY");
        address allocator = vm.envAddress("SRCLA_ALLOCATOR_ADDRESS");
        address usdc = vm.envAddress("BASE_USDC_ADDRESS");
        address admin = vm.addr(adminPk);

        vm.startBroadcast(adminPk);
        vault = deployCore(usdc, admin, allocator);
        vm.stopBroadcast();

        console2.log("NavyVault:", address(vault));
        console2.log("asset:", vault.asset());
        console2.log("admin:", vault.owner());
        console2.log("allocator:", vault.allocator());
    }

    function deployCore(address usdc, address admin, address allocator) public returns (NavyVault vault) {
        if (block.chainid != BASE_CHAIN_ID) revert WrongChain();
        if (usdc != BASE_USDC) revert WrongAsset();
        if (admin == address(0)) revert InvalidAdmin();
        if (allocator == address(0)) revert InvalidAllocator();
        if (admin == allocator) revert RoleCollision();

        vault = new NavyVault(IERC20(usdc), admin, allocator);
    }
}
