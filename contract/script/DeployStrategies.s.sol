// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";
import {AaveV3Strategy} from "../src/strategies/AaveV3Strategy.sol";
import {CompoundV3Strategy} from "../src/strategies/CompoundV3Strategy.sol";
import {MoonwellStrategy} from "../src/strategies/MoonwellStrategy.sol";

/// @notice Deploys the Aave V3 / Compound V3 / Moonwell strategy adapters and registers
///         them with an already-deployed NavyVaultSRCLA (see DeployNavyVaultSRCLA.s.sol).
/// @dev Base protocol addresses are hardcoded (see contract/config/base-strategies.json).
///      Run on Base mainnet against the vault deployed there; the USDC env var should be
///      the vault's asset. Registerer is the deployer, who must hold the vault ADMIN_ROLE.
contract DeployStrategies is Script {
    /// @notice Aave V3 Pool (Base mainnet)
    address public constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    /// @notice aUSDC aToken (Base mainnet)
    address public constant AAVE_AUSDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    /// @notice Compound III (Comet) USDC market (Base mainnet)
    address public constant COMPOUND_COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    /// @notice Moonwell mUSDC market (Base mainnet)
    address public constant MOONWELL_MUSDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address vault = vm.envAddress("NAVY_VAULT_SRCLA_ADDRESS");
        address usdc = vm.envAddress("SEPOLIA_USDC_ADDRESS");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        AaveV3Strategy aaveStrategy = new AaveV3Strategy(vault, usdc, AAVE_POOL, AAVE_AUSDC, address(0)); // no incentives controller
        console2.log("AaveV3Strategy deployed:", address(aaveStrategy));

        CompoundV3Strategy compoundStrategy = new CompoundV3Strategy(vault, usdc, COMPOUND_COMET);
        console2.log("CompoundV3Strategy deployed:", address(compoundStrategy));

        MoonwellStrategy moonwellStrategy = new MoonwellStrategy(vault, usdc, MOONWELL_MUSDC);
        console2.log("MoonwellStrategy deployed:", address(moonwellStrategy));

        // Register with vault (40% cap, 0.5% max loss)
        NavyVaultSRCLA(vault).registerAdapter(address(aaveStrategy), 4000, 50, "Aave V3 Strategy");
        NavyVaultSRCLA(vault).registerAdapter(address(compoundStrategy), 4000, 50, "Compound V3 Strategy");
        NavyVaultSRCLA(vault).registerAdapter(address(moonwellStrategy), 4000, 50, "Moonwell Strategy");

        console2.log("All strategies registered with vault");

        vm.stopBroadcast();

        console2.log("vault:", vault);
        console2.log("registerer:", deployer);
        console2.log("USDC:", usdc);
    }
}
