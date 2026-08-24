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

/// @notice Deploys NavyVaultSRCLA + all adapters to Anvil local fork (Base mainnet fork)
/// @dev Uses Anvil default account[0] as deployer/admin/allocator
contract DeployVaultAnvil is Script {
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

    function run() external {
        // Anvil default account[0]
        uint256 deployerPk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        // 1. Deploy vault
        NavyVaultSRCLA vault = new NavyVaultSRCLA(IERC20(USDC));

        // 2. Deploy adapters
        AaveV3Adapter aave = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        CompoundAdapter compound = new CompoundAdapter(address(vault), USDC, COMET);
        MoonwellAdapter moonwell = new MoonwellAdapter(address(vault), USDC, M_USDC, MOONWELL_COMPTROLLER, MOONWELL_IRM);

        // 3. Deploy reward infra
        RewardAccountant accountant = new RewardAccountant(deployer);
        RewardExecutor rewardExecutor = new RewardExecutor({
            _vault: address(vault),
            _admin: deployer,
            _canonicalUsdc: USDC,
            _factory: FACTORY,
            _swapRouter02: SWAP_ROUTER,
            _sequencerFeed: SEQUENCER_FEED,
            _recoveryGrace: 3600
        });

        // 4. Configure vault
        vault.registerAdapter(address(aave), 4_000, 100, "Aave V3 Base USDC");
        vault.registerAdapter(address(compound), 4_000, 100, "Compound III Base USDC");
        vault.registerAdapter(address(moonwell), 2_000, 150, "Moonwell Base USDC");
        vault.setRewardExecutor(address(rewardExecutor));
        vault.setRewardAccountant(address(accountant));

        // 5. Grant roles (deployer = admin = allocator for dev)
        vault.grantRole(vault.ADMIN_ROLE(), deployer);
        vault.grantRole(vault.ALLOCATOR_ROLE(), deployer);
        rewardExecutor.grantRole(rewardExecutor.ADMIN_ROLE(), deployer);

        vm.stopBroadcast();

        // Output addresses as env-ready lines
        console2.log("VAULT_ADDRESS=%s", address(vault));
        console2.log("AAVE_STRATEGY_ADDRESS=%s", address(aave));
        console2.log("COMPOUND_STRATEGY_ADDRESS=%s", address(compound));
        console2.log("MOONWELL_STRATEGY_ADDRESS=%s", address(moonwell));
        console2.log("REWARD_EXECUTOR_ADDRESS=%s", address(rewardExecutor));
        console2.log("USDC_ADDRESS=%s", USDC);
        console2.log("DEPLOYER_ADDRESS=%s", deployer);
    }
}
