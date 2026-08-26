// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Script, console2} from "forge-std/Script.sol";
import {NavyVaultSimple} from "../src/NavyVaultSimple.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployFull is Script {
    function run() external {
        uint256 pk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        address COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
        address AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
        address A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
        address M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
        address MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
        address MOONWELL_IRM = 0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C;
        
        vm.startBroadcast(pk);
        
        NavyVaultSimple vault = new NavyVaultSimple(IERC20(USDC));
        console2.log("VAULT=%s", address(vault));
        
        CompoundAdapter compound = new CompoundAdapter(address(vault), USDC, COMET);
        console2.log("COMPOUND=%s", address(compound));
        
        AaveV3Adapter aave = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        console2.log("AAVE=%s", address(aave));
        
        MoonwellAdapter moonwell = new MoonwellAdapter(address(vault), USDC, M_USDC, MOONWELL_COMPTROLLER, MOONWELL_IRM);
        console2.log("MOONWELL=%s", address(moonwell));
        
        // Register adapters
        vault.registerAdapter(address(compound), 4_000, 100);
        vault.registerAdapter(address(aave), 4_000, 100);
        vault.registerAdapter(address(moonwell), 2_000, 150);
        
        // Grant roles
        vault.grantRole(vault.ADMIN_ROLE(), vm.addr(pk));
        vault.grantRole(vault.ALLOCATOR_ROLE(), vm.addr(pk));
        
        vm.stopBroadcast();
    }
}
