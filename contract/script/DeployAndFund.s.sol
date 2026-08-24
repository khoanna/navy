// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {RewardExecutor} from "../src/reward/RewardExecutor.sol";
import {RewardAccountant} from "../src/reward/RewardAccountant.sol";

/// @notice Deploys tier vaults with USDC funding in one script
contract DeployAndFund is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant MOONWELL_IRM = 0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C;
    address constant SWAP_ROUTER = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;

    function run() external {
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        // Get USDC from Compound Comet - it holds USDC
        console2.log("Getting USDC from Comet...");
        address comet = COMET;
        uint256 cometBal = IERC20(USDC).balanceOf(comet);
        console2.log("Comet USDC balance: %s", cometBal);

        // Impersonate Comet and transfer USDC to deployer
        vm.startPrank(comet);
        uint256 availableBal = IERC20(USDC).balanceOf(comet);
        IERC20(USDC).transfer(deployer, availableBal); // Take all available
        vm.stopPrank();

        uint256 deployerBal = IERC20(USDC).balanceOf(deployer);
        console2.log("Deployer USDC balance: %s", deployerBal);

        vm.startBroadcast(deployerPk);

        // Deploy vaults and fund them
        // Comet has ~443K USDC, so we use 3 tiers: 10K, 100K, 300K
        console2.log("\n=== Deploying and funding vaults ===");

        // 10K vault
        VaultInfo memory vault10k = deployVault(deployer);
        IERC20(USDC).transfer(vault10k.vault, 10_000e6);
        console2.log("10K vault funded: %s", IERC20(USDC).balanceOf(vault10k.vault));

        // 100K vault
        VaultInfo memory vault100k = deployVault(deployer);
        IERC20(USDC).transfer(vault100k.vault, 100_000e6);
        console2.log("100K vault funded: %s", IERC20(USDC).balanceOf(vault100k.vault));

        // 300K vault (adjusted from 1M due to limited USDC)
        VaultInfo memory vault300k = deployVault(deployer);
        uint256 remainingBal = IERC20(USDC).balanceOf(deployer);
        IERC20(USDC).transfer(vault300k.vault, remainingBal);
        console2.log("300K vault funded: %s", IERC20(USDC).balanceOf(vault300k.vault));

        vm.stopBroadcast();

        // Print all addresses
        console2.log("\n=== DEPLOYMENT SUMMARY ===");
        console2.log("VAULT_10K=%s", vault10k.vault);
        console2.log("AAVE_10K=%s", vault10k.aave);
        console2.log("COMPOUND_10K=%s", vault10k.compound);
        console2.log("MOONWELL_10K=%s", vault10k.moonwell);
        console2.log("");
        console2.log("VAULT_100K=%s", vault100k.vault);
        console2.log("AAVE_100K=%s", vault100k.aave);
        console2.log("COMPOUND_100K=%s", vault100k.compound);
        console2.log("MOONWELL_100K=%s", vault100k.moonwell);
        console2.log("");
        console2.log("VAULT_300K=%s", vault300k.vault);
        console2.log("AAVE_300K=%s", vault300k.aave);
        console2.log("COMPOUND_300K=%s", vault300k.compound);
        console2.log("MOONWELL_300K=%s", vault300k.moonwell);
    }

    struct VaultInfo {
        address vault;
        address aave;
        address compound;
        address moonwell;
    }

    function deployVault(address deployer) internal returns (VaultInfo memory info) {
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

        _vault.registerAdapter(info.aave, 4000, 100, "Aave V3 Base USDC");
        _vault.registerAdapter(info.compound, 4000, 100, "Compound III Base USDC");
        _vault.registerAdapter(info.moonwell, 2000, 100, "Moonwell Base USDC");
        _vault.setRewardExecutor(address(rewardExecutor));
        _vault.setRewardAccountant(address(accountant));

        _vault.grantRole(_vault.ADMIN_ROLE(), deployer);
        _vault.grantRole(_vault.ALLOCATOR_ROLE(), deployer);
        rewardExecutor.grantRole(rewardExecutor.ADMIN_ROLE(), deployer);
    }
}
