// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {RewardExecutor} from "../src/reward/RewardExecutor.sol";
import {RewardAccountant} from "../src/reward/RewardAccountant.sol";

/// @notice Deploys 4 NavyVaultSRCLA vaults for evaluation (one per tier)
/// @dev Each vault represents a different TVL tier: 10K, 100K, 1M, 10M USDC
contract DeployTierVaults is Script, StdCheats {
    // Base Mainnet constants
    address constant USDC           = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL      = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC         = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant COMET          = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address constant M_USDC         = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant MOONWELL_IRM   = 0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C;
    address constant SWAP_ROUTER    = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address constant FACTORY        = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;

    // Tier configurations (USDC amounts in base units)
    uint256 constant TIER_10K = 10_000e6;
    uint256 constant TIER_100K = 100_000e6;
    uint256 constant TIER_1M = 1_000_000e6;
    uint256 constant TIER_10M = 10_000_000e6;

    function run() external {
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        // Deploy 10K vault
        console2.log("\n=== Deploying 10K USDC Tier Vault ===");
        VaultInfo memory vault10k = deployTierVault(deployer);
        deal(USDC, vault10k.vault, TIER_10K);

        // Deploy 100K vault
        console2.log("\n=== Deploying 100K USDC Tier Vault ===");
        VaultInfo memory vault100k = deployTierVault(deployer);
        deal(USDC, vault100k.vault, TIER_100K);

        // Deploy 1M vault
        console2.log("\n=== Deploying 1M USDC Tier Vault ===");
        VaultInfo memory vault1m = deployTierVault(deployer);
        deal(USDC, vault1m.vault, TIER_1M);

        // Deploy 10M vault
        console2.log("\n=== Deploying 10M USDC Tier Vault ===");
        VaultInfo memory vault10m = deployTierVault(deployer);
        deal(USDC, vault10m.vault, TIER_10M);

        vm.stopBroadcast();

        // Print summary
        console2.log("\n=== Deployment Summary ===");
        console2.log("");
        console2.log("--- 10K USDC Tier ---");
        console2.log("VAULT_10K=%s", vault10k.vault);
        console2.log("AAVE_10K=%s", vault10k.aave);
        console2.log("COMPOUND_10K=%s", vault10k.compound);
        console2.log("MOONWELL_10K=%s", vault10k.moonwell);
        console2.log("");
        console2.log("--- 100K USDC Tier ---");
        console2.log("VAULT_100K=%s", vault100k.vault);
        console2.log("AAVE_100K=%s", vault100k.aave);
        console2.log("COMPOUND_100K=%s", vault100k.compound);
        console2.log("MOONWELL_100K=%s", vault100k.moonwell);
        console2.log("");
        console2.log("--- 1M USDC Tier ---");
        console2.log("VAULT_1M=%s", vault1m.vault);
        console2.log("AAVE_1M=%s", vault1m.aave);
        console2.log("COMPOUND_1M=%s", vault1m.compound);
        console2.log("MOONWELL_1M=%s", vault1m.moonwell);
        console2.log("");
        console2.log("--- 10M USDC Tier ---");
        console2.log("VAULT_10M=%s", vault10m.vault);
        console2.log("AAVE_10M=%s", vault10m.aave);
        console2.log("COMPOUND_10M=%s", vault10m.compound);
        console2.log("MOONWELL_10M=%s", vault10m.moonwell);
    }

    struct VaultInfo {
        address vault;
        address aave;
        address compound;
        address moonwell;
    }

    function deployTierVault(address deployer) internal returns (VaultInfo memory info) {
        NavyVaultSRCLA _vault = new NavyVaultSRCLA(IERC20(USDC));
        info.vault = address(_vault);

        AaveV3Adapter _aave = new AaveV3Adapter(info.vault, USDC, AAVE_POOL, A_USDC);
        CompoundAdapter _compound = new CompoundAdapter(info.vault, USDC, COMET);
        MoonwellAdapter _moonwell = new MoonwellAdapter(info.vault, USDC, M_USDC, MOONWELL_COMPTROLLER, MOONWELL_IRM);

        info.aave = address(_aave);
        info.compound = address(_compound);
        info.moonwell = address(_moonwell);

        RewardAccountant accountant = new RewardAccountant(deployer);
        RewardExecutor rewardExecutor = new RewardExecutor({
            _vault: info.vault,
            _admin: deployer,
            _canonicalUsdc: USDC,
            _factory: FACTORY,
            _swapRouter02: SWAP_ROUTER,
            _sequencerFeed: SEQUENCER_FEED,
            _recoveryGrace: 3600
        });

        // Configure adapters with caps
        uint16 capBps = 4000; // 40%
        uint16 capBpsLow = 2000; // 20%
        uint16 maxLossBps = 100; // 1% max loss tolerance
        _vault.registerAdapter(info.aave, capBps, maxLossBps, "Aave V3 Base USDC");
        _vault.registerAdapter(info.compound, capBps, maxLossBps, "Compound III Base USDC");
        _vault.registerAdapter(info.moonwell, capBpsLow, maxLossBps, "Moonwell Base USDC");
        _vault.setRewardExecutor(address(rewardExecutor));
        _vault.setRewardAccountant(address(accountant));

        _vault.grantRole(_vault.ADMIN_ROLE(), deployer);
        _vault.grantRole(_vault.ALLOCATOR_ROLE(), deployer);
        rewardExecutor.grantRole(rewardExecutor.ADMIN_ROLE(), deployer);

        console2.log("Vault: %s", info.vault);
        console2.log("TotalAssets: %s", _vault.totalAssets());
    }
}
