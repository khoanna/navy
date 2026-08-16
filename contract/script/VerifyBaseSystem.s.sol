// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {NavyVaultSRCLA} from "../src/NavyVaultSRCLA.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {MoonwellAdapter} from "../src/adapters/MoonwellAdapter.sol";
import {RewardExecutor} from "../src/reward/RewardExecutor.sol";

/// @notice Verifies Base deployment conformance without mutating state.
/// @dev This script reads state and reverts on any mismatch - safe to run against mainnet.
///      Usage: forge script script/VerifyBaseSystem.s.sol --fork-url $BASE_RPC_URL
///             --sig "run(address,address,address,address,address,address)" \
///             <vault> <aave> <compound> <moonwell> <rewards> <admin>
contract VerifyBaseSystem is Script {
    // === Constants ===

    uint256 constant BASE_CHAIN_ID = 8453;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant A_USDC = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB;
    address constant COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address constant M_USDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant SWAP_ROUTER_02 = 0x2626664C2603336E57b271C5c0b26F42121e30D0;
    address constant FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant SEQUENCER_FEED = 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7;

    // === Errors ===

    error WrongChain(uint256 expected, uint256 actual);
    error WrongAsset();
    error ZeroAddress();
    error Mismatch(string field);

    function run(
        address vault,
        address aave,
        address compound,
        address moonwell,
        address rewards,
        address admin,
        address allocator
    ) external {
        // Verify chain
        if (block.chainid != BASE_CHAIN_ID) {
            revert WrongChain(BASE_CHAIN_ID, block.chainid);
        }

        // Verify USDC
        if (IERC20Metadata(USDC).decimals() != 6) revert WrongAsset();

        // Verify addresses are non-zero
        if (vault == address(0)) revert ZeroAddress();
        if (admin == address(0)) revert ZeroAddress();
        if (allocator == address(0)) revert ZeroAddress();
        if (admin == allocator) revert Mismatch("Admin and allocator must differ");

        // Verify vault
        _verifyVault(vault, admin, allocator);

        // Verify rewards
        _verifyRewards(rewards, vault, admin);

        console2.log("Verification complete - all checks passed");
    }

    function _verifyVault(address vault, address admin, address allocator) internal view {
        NavyVaultSRCLA v = NavyVaultSRCLA(vault);

        // Verify asset
        if (v.asset() != USDC) revert Mismatch("Vault asset");

        // Verify admin has roles
        if (!v.hasRole(v.DEFAULT_ADMIN_ROLE(), admin)) revert Mismatch("Admin missing DEFAULT_ADMIN_ROLE");
        if (!v.hasRole(v.ADMIN_ROLE(), admin)) revert Mismatch("Admin missing ADMIN_ROLE");

        // Verify allocator has role
        if (!v.hasRole(v.ALLOCATOR_ROLE(), allocator)) revert Mismatch("Allocator missing ALLOCATOR_ROLE");

        // Verify allocator does NOT have admin role
        if (v.hasRole(v.ADMIN_ROLE(), allocator)) revert Mismatch("Allocator has ADMIN_ROLE");
        if (v.hasRole(v.DEFAULT_ADMIN_ROLE(), allocator)) revert Mismatch("Allocator has DEFAULT_ADMIN_ROLE");

        // Verify admin does NOT have allocator role
        if (v.hasRole(v.ALLOCATOR_ROLE(), admin)) revert Mismatch("Admin has ALLOCATOR_ROLE");

        // Verify reward executor is set
        if (v.rewardExecutor() == address(0)) revert Mismatch("Reward executor not set");

        console2.log("Vault verified");
    }

    function _verifyRewards(address rewards, address vault, address admin) internal view {
        RewardExecutor r = RewardExecutor(rewards);

        // Verify immutable configuration
        if (r.vault() != vault) revert Mismatch("Rewards vault");
        if (r.canonicalUsdc() != USDC) revert Mismatch("Rewards USDC");
        if (r.factory() != FACTORY) revert Mismatch("Rewards factory");
        if (r.swapRouter02() != SWAP_ROUTER_02) revert Mismatch("Rewards router");
        if (r.sequencerFeed() != SEQUENCER_FEED) revert Mismatch("Rewards sequencer feed");

        // Verify admin roles
        if (!r.hasRole(r.DEFAULT_ADMIN_ROLE(), admin)) revert Mismatch("Rewards admin missing DEFAULT_ADMIN_ROLE");
        if (!r.hasRole(r.ADMIN_ROLE(), admin)) revert Mismatch("Rewards admin missing ADMIN_ROLE");

        console2.log("Rewards verified");
    }
}
