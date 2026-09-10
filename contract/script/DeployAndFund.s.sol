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
import {VaultGuardrails} from "./VaultGuardrails.sol";

/// @notice Deploys tier vaults with USDC funding in one script
contract DeployAndFund is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant MOONWELL_IRM = 0xcD6b4B047e55A513b8efc2B61F58B9f7Fa6096FC;
    address constant SWAP_ROUTER = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;

    function run() external {
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        // The deployer must already hold USDC on the fork. Funding it here via
        // vm.prank would only affect the simulation pass - the broadcast pass
        // replays against the live chain, where the prank never happened, and
        // every transfer below reverts with "transfer amount exceeds balance".
        // Fund it out of band instead (anvil_impersonateAccount + transfer).
        uint256 deployerBal = IERC20(USDC).balanceOf(deployer);
        console2.log("Deployer USDC balance: %s", deployerBal);
        require(deployerBal >= 11_110_000e6, "deployer USDC not funded for all four tiers; see script header");

        vm.startBroadcast(deployerPk);

        // ONE VAULT PER REGISTERED TIER (§11.1: 10k, 100k, 1M, 10M).
        // §11.1's fork replay submits each (policy, tier)'s plan to a vault,
        // and the vault verifies capBps, minIdleBps, the reserve and the loss
        // bound AGAINST ITS OWN NAV. Replaying every tier against one vault
        // therefore checks the wrong guardrails: a plan sized for the 10M
        // tier submitted to a 390k vault is refused by the contract behaving
        // correctly, which reads as an allocation the chain rejected. It is
        // not -- it is a bench that does not match the experiment.
        console2.log("\n=== Deploying and funding one vault per registered tier ===");

        VaultInfo memory v10k = deployVault(deployer);
        IERC20(USDC).transfer(v10k.vault, 10_000e6);
        console2.log("10K vault funded:  %s", IERC20(USDC).balanceOf(v10k.vault));

        VaultInfo memory v100k = deployVault(deployer);
        IERC20(USDC).transfer(v100k.vault, 100_000e6);
        console2.log("100K vault funded: %s", IERC20(USDC).balanceOf(v100k.vault));

        VaultInfo memory v1m = deployVault(deployer);
        IERC20(USDC).transfer(v1m.vault, 1_000_000e6);
        console2.log("1M vault funded:   %s", IERC20(USDC).balanceOf(v1m.vault));

        VaultInfo memory v10m = deployVault(deployer);
        IERC20(USDC).transfer(v10m.vault, 10_000_000e6);
        console2.log("10M vault funded:  %s", IERC20(USDC).balanceOf(v10m.vault));

        vm.stopBroadcast();

        // Print all addresses
        console2.log("\n=== DEPLOYMENT SUMMARY ===");
        console2.log("SRCLA_FORK_REPLAY_VAULTS=10000=%s,100000=%s", v10k.vault, v100k.vault);
        console2.log("  ...,1000000=%s,10000000=%s", v1m.vault, v10m.vault);
        console2.log("");
        console2.log("VAULT_10K=%s", v10k.vault);
        console2.log("AAVE_10K=%s", v10k.aave);
        console2.log("COMPOUND_10K=%s", v10k.compound);
        console2.log("MOONWELL_10K=%s", v10k.moonwell);
        console2.log("");
        console2.log("VAULT_100K=%s", v100k.vault);
        console2.log("AAVE_100K=%s", v100k.aave);
        console2.log("COMPOUND_100K=%s", v100k.compound);
        console2.log("MOONWELL_100K=%s", v100k.moonwell);
        console2.log("");
        console2.log("VAULT_1M=%s", v1m.vault);
        console2.log("AAVE_1M=%s", v1m.aave);
        console2.log("COMPOUND_1M=%s", v1m.compound);
        console2.log("MOONWELL_1M=%s", v1m.moonwell);
        console2.log("");
        console2.log("VAULT_10M=%s", v10m.vault);
        console2.log("AAVE_10M=%s", v10m.aave);
        console2.log("COMPOUND_10M=%s", v10m.compound);
        console2.log("MOONWELL_10M=%s", v10m.moonwell);
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

        RewardAccountant accountant = new RewardAccountant(deployer, info.vault);
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
        accountant.setVault(address(_vault));

        // Paper 5.2 / 6.1 / 8.1 on-chain guardrails. Without this the vault
        // ships with the liquidity floor and the synchronous-loss allowance
        // both at zero - the first makes P5 inert, the second makes any
        // rounding loss revert a redemption.
        address[] memory ordered = new address[](3);
        ordered[0] = info.aave;
        ordered[1] = info.compound;
        ordered[2] = info.moonwell;
        VaultGuardrails.applyTo(_vault, ordered);

        _vault.grantRole(_vault.ADMIN_ROLE(), deployer);
        _vault.grantRole(_vault.ALLOCATOR_ROLE(), deployer);
        rewardExecutor.grantRole(rewardExecutor.ADMIN_ROLE(), deployer);
    }
}
