// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {RewardExecutor} from "../src/reward/RewardExecutor.sol";
import {RewardAccountant} from "../src/reward/RewardAccountant.sol";

/// @notice Deploys the Base vault and lending adapters with production identity checks.
/// @dev Reward routes are configured even when inactive - the route manifest encodes
/// the reason and evidence block for each inactive route.
contract DeployBaseSystem is Script {
    uint256 internal constant BASE_CHAIN_ID = 8453;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address internal constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address internal constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address internal constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address internal constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address internal constant MOONWELL_INTEREST_MODEL = 0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C;
    address internal constant SWAP_ROUTER_02 = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address internal constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address internal constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;
    uint256 internal constant RECOVERY_GRACE = 3600;

    // Chainlink feeds for reward accounting
    address internal constant USDC_USD_FEED = 0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56;
    address internal constant WETH_USD_FEED = 0x7105EC27F7f0ad0fec6FF5cAAc52d34B8cd6d10e;

    error WrongChain();
    error InvalidGovernance();
    error WrongAsset();
    error AdminAllocatorMustDiffer();

    function run()
        external
        returns (
            NavyVaultSRCLA vault,
            AaveV3Adapter aave,
            CompoundAdapter compound,
            MoonwellAdapter moonwell,
            RewardExecutor rewards,
            RewardAccountant accountant
        )
    {
        if (block.chainid != BASE_CHAIN_ID) revert WrongChain();
        if (IERC20Metadata(USDC).decimals() != 6) revert WrongAsset();

        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address admin = vm.envAddress("BASE_ADMIN_ADDRESS");
        address allocator = vm.envAddress("BASE_ALLOCATOR_ADDRESS");
        if (admin == address(0) || allocator == address(0)) revert InvalidGovernance();
        if (admin == allocator) revert AdminAllocatorMustDiffer();

        vm.startBroadcast(deployerPk);
        vault = new NavyVaultSRCLA(IERC20(USDC));
        aave = new AaveV3Adapter(address(vault), USDC, AAVE_POOL, A_USDC);
        compound = new CompoundAdapter(address(vault), USDC, COMET);
        moonwell = new MoonwellAdapter(address(vault), USDC, M_USDC, MOONWELL_COMPTROLLER, MOONWELL_INTEREST_MODEL);
        rewards = new RewardExecutor({
            _vault: address(vault),
            _admin: admin,
            _canonicalUsdc: USDC,
            _factory: FACTORY,
            _swapRouter02: SWAP_ROUTER_02,
            _sequencerFeed: SEQUENCER_FEED,
            _recoveryGrace: RECOVERY_GRACE
        });
        accountant = new RewardAccountant(admin);

        vault.registerAdapter(address(aave), 4_000, 100, "Aave V3 Base USDC");
        vault.registerAdapter(address(compound), 4_000, 100, "Compound III Base USDC");
        vault.registerAdapter(address(moonwell), 2_000, 150, "Moonwell Base USDC");
        vault.setRewardExecutor(address(rewards));
        vault.setRewardAccountant(address(accountant));

        // Admin gets DEFAULT_ADMIN_ROLE and ADMIN_ROLE only
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        vault.grantRole(vault.ADMIN_ROLE(), admin);
        // Allocator gets ONLY ALLOCATOR_ROLE
        vault.grantRole(vault.ALLOCATOR_ROLE(), allocator);
        // Rewards contract needs ADMIN_ROLE to set routes
        vault.grantRole(vault.ADMIN_ROLE(), address(rewards));

        rewards.grantRole(rewards.DEFAULT_ADMIN_ROLE(), admin);
        rewards.grantRole(rewards.ADMIN_ROLE(), admin);

        // Configure reward routes (even if inactive)
        _configureRewardRoutes(rewards);

        if (deployer != admin) {
            vault.renounceRole(vault.ADMIN_ROLE(), deployer);
            vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), deployer);
            rewards.renounceRole(rewards.ADMIN_ROLE(), deployer);
            rewards.renounceRole(rewards.DEFAULT_ADMIN_ROLE(), deployer);
        }
        vm.stopBroadcast();

        console2.log("NavyVaultSRCLA", address(vault));
        console2.log("AaveV3Adapter", address(aave));
        console2.log("CompoundAdapter", address(compound));
        console2.log("MoonwellAdapter", address(moonwell));
        console2.log("RewardExecutor", address(rewards));
        console2.log("RewardAccountant", address(accountant));
        console2.log("Admin", admin);
        console2.log("Allocator", allocator);
    }

    function _configureRewardRoutes(RewardExecutor rewards_) internal {
        // Note: Routes are configured via RewardAccountant policies, not directly here.
        // The RewardAccountant manages reward token policies including:
        // - COMP (inactive - rewards ended)
        // - WELL (inactive - unfunded)
        // Routes can be activated via RewardExecutor.approveRoute when rewards are active.
    }
}
