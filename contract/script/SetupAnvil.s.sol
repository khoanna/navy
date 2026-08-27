// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSimple} from "../src/NavyVaultSimple.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";

/// @notice Deploys everything on Anvil + funds vault with USDC from Comet
/// Uses anvil_impersonateAccount via anvil RPC, not vm.prank
contract SetupAnvil is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant MOONWELL_IRM = 0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C;
    uint256 constant USDC_AMOUNT = 500_000_000_000; // 500K USDC

    function run() external {
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        // Step 1: Deploy vault
        vm.startBroadcast(deployerPk);
        NavyVaultSimple vault = new NavyVaultSimple(IERC20(USDC));
        CompoundAdapter compound = new CompoundAdapter(address(vault), USDC, COMET);
        AaveV3Adapter aave = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        MoonwellAdapter moonwell = new MoonwellAdapter(address(vault), USDC, M_USDC, MOONWELL_COMPTROLLER, MOONWELL_IRM);

        vault.registerAdapter(address(compound), 4_000, 100);
        vault.registerAdapter(address(aave), 4_000, 100);
        vault.registerAdapter(address(moonwell), 2_000, 150);
        vault.grantRole(vault.ADMIN_ROLE(), deployer);
        vault.grantRole(vault.ALLOCATOR_ROLE(), deployer);
        vm.stopBroadcast();

        // Step 2: Fund vault via Comet impersonation (done via anvil RPC calls externally)
        // We'll just log what needs to happen
        console2.log("=== DEPLOYMENT COMPLETE ===");
        console2.log("VAULT_ADDRESS=%s", address(vault));
        console2.log("COMPOUND_ADDRESS=%s", address(compound));
        console2.log("AAVE_ADDRESS=%s", address(aave));
        console2.log("MOONWELL_ADDRESS=%s", address(moonwell));
        console2.log("");
        console2.log("To fund vault, run the RPC commands:");
        console2.log("1. curl -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"anvil_impersonateAccount\",\"params\":[\"0xb125E6687d4313864e53df431d5425969c15Eb2F\"],\"id\":1}'");
        console2.log("2. curl -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"0xb125E6687d4313864e53df431d5425969c15Eb2F\",\"to\":\"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\",\"data\":\"0xa9059cbb000000000000000000000000VAULT00000000000000000000000000000000AMOUNT\",\"gas\":\"0x50000\"}],\"id\":1}'");
        console2.log("Replace VAULT with vault address, AMOUNT with 0x746a528800 for 500K USDC");
    }
}
