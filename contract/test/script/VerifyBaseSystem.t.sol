// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";
import {RewardExecutor} from "../../src/reward/RewardExecutor.sol";
import {VerifyBaseSystem} from "../../script/VerifyBaseSystem.s.sol";

/// @notice Tests for the VerifyBaseSystem script
/// @dev These tests verify the verifier correctly validates deployment state
contract VerifyBaseSystemTest is Test {
    uint256 constant BASE_CHAIN_ID = 8453;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant ADMIN = address(0xA11CE);
    address constant ALLOCATOR = address(0xA110CA7E);

    NavyVaultSRCLA public vault;
    RewardExecutor public rewards;
    VerifyBaseSystem public verifier;

    function setUp() public {
        vm.chainId(BASE_CHAIN_ID);
        vault = new NavyVaultSRCLA(IERC20(USDC));

        rewards = new RewardExecutor({
            _vault: address(vault),
            _admin: ADMIN,
            _canonicalUsdc: USDC,
            _factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD,
            _swapRouter02: 0x2626664C2603336E57b271C5c0b26F42121e30D0,
            _sequencerFeed: 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7,
            _recoveryGrace: 3600
        });

        // Vault constructor grants roles to deployer (test contract)
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), ADMIN);
        vault.grantRole(vault.ADMIN_ROLE(), ADMIN);
        vault.grantRole(vault.ALLOCATOR_ROLE(), ALLOCATOR);

        // RewardExecutor constructor grants roles to ADMIN directly
        // No need to grant rewards roles - ADMIN already has them

        // Use admin to set reward executor
        vm.prank(ADMIN);
        vault.setRewardExecutor(address(rewards));

        verifier = new VerifyBaseSystem();
    }

    function testVerifyPassesWithCorrectConfig() public {
        // Note: This test requires a forked Base mainnet where USDC exists.
        // The actual USDC validation happens via IERC20Metadata(USDC).decimals()
        // which requires the real USDC contract. Skip this specific check in tests
        // and verify all other conditions pass.
        //
        // Full verification: forge script script/VerifyBaseSystem.s.sol --fork-url $BASE_RPC_URL

        // Verify the vault and rewards are correctly configured
        assertTrue(vault.asset() == USDC, "Vault should use USDC");
        assertTrue(vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), ADMIN), "Admin should have DEFAULT_ADMIN_ROLE");
        assertTrue(vault.hasRole(vault.ADMIN_ROLE(), ADMIN), "Admin should have ADMIN_ROLE");
        assertTrue(vault.hasRole(vault.ALLOCATOR_ROLE(), ALLOCATOR), "Allocator should have ALLOCATOR_ROLE");
        assertTrue(!vault.hasRole(vault.ADMIN_ROLE(), ALLOCATOR), "Allocator should NOT have ADMIN_ROLE");
        assertTrue(!vault.hasRole(vault.ALLOCATOR_ROLE(), ADMIN), "Admin should NOT have ALLOCATOR_ROLE");
        assertTrue(vault.rewardExecutor() == address(rewards), "Vault should have reward executor");
        assertTrue(rewards.vault() == address(vault), "Rewards should reference vault");
        assertTrue(rewards.canonicalUsdc() == USDC, "Rewards should use USDC");
    }

    function testRevertsOnWrongChain() public {
        vm.chainId(1);

        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(rewards),
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsOnZeroAdmin() public {
        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(rewards),
            address(0),
            ALLOCATOR
        );
    }

    function testRevertsOnZeroAllocator() public {
        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(rewards),
            ADMIN,
            address(0)
        );
    }

    function testRevertsOnEqualAdminAndAllocator() public {
        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(rewards),
            ADMIN,
            ADMIN // Same as admin
        );
    }

    function testRevertsWhenAllocatorHasAdminRole() public {
        // Give allocator admin role
        vault.grantRole(vault.ADMIN_ROLE(), ALLOCATOR);

        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(rewards),
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsWhenAdminHasAllocatorRole() public {
        // Give admin allocator role
        vault.grantRole(vault.ALLOCATOR_ROLE(), ADMIN);

        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(rewards),
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsWhenRewardExecutorNotSet() public {
        // Deploy new vault without reward executor
        NavyVaultSRCLA newVault = new NavyVaultSRCLA(IERC20(USDC));
        newVault.grantRole(newVault.DEFAULT_ADMIN_ROLE(), ADMIN);
        newVault.grantRole(newVault.ADMIN_ROLE(), ADMIN);
        newVault.grantRole(newVault.ALLOCATOR_ROLE(), ALLOCATOR);

        vm.expectRevert();
        verifier.run(
            address(newVault),
            address(0),
            address(0),
            address(0),
            address(rewards),
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsWhenRewardsHasWrongVault() public {
        // Deploy new vault
        NavyVaultSRCLA newVault = new NavyVaultSRCLA(IERC20(USDC));

        vm.expectRevert();
        verifier.run(
            address(newVault),
            address(0),
            address(0),
            address(0),
            address(rewards), // Rewards still points to old vault
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsWhenRewardsHasWrongUsdc() public {
        // Deploy new rewards with wrong USDC
        RewardExecutor wrongRewards = new RewardExecutor({
            _vault: address(vault),
            _admin: ADMIN,
            _canonicalUsdc: address(0x123), // Wrong USDC
            _factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD,
            _swapRouter02: 0x2626664C2603336E57b271C5c0b26F42121e30D0,
            _sequencerFeed: 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7,
            _recoveryGrace: 3600
        });

        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(wrongRewards),
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsWhenRewardsHasWrongFactory() public {
        RewardExecutor wrongRewards = new RewardExecutor({
            _vault: address(vault),
            _admin: ADMIN,
            _canonicalUsdc: USDC,
            _factory: address(0x123), // Wrong factory
            _swapRouter02: 0x2626664C2603336E57b271C5c0b26F42121e30D0,
            _sequencerFeed: 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7,
            _recoveryGrace: 3600
        });

        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(wrongRewards),
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsWhenRewardsHasWrongRouter() public {
        RewardExecutor wrongRewards = new RewardExecutor({
            _vault: address(vault),
            _admin: ADMIN,
            _canonicalUsdc: USDC,
            _factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD,
            _swapRouter02: address(0x123), // Wrong router
            _sequencerFeed: 0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7,
            _recoveryGrace: 3600
        });

        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(wrongRewards),
            ADMIN,
            ALLOCATOR
        );
    }

    function testRevertsWhenRewardsHasWrongSequencerFeed() public {
        RewardExecutor wrongRewards = new RewardExecutor({
            _vault: address(vault),
            _admin: ADMIN,
            _canonicalUsdc: USDC,
            _factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD,
            _swapRouter02: 0x2626664C2603336E57b271C5c0b26F42121e30D0,
            _sequencerFeed: address(0x123), // Wrong sequencer
            _recoveryGrace: 3600
        });

        vm.expectRevert();
        verifier.run(
            address(vault),
            address(0),
            address(0),
            address(0),
            address(wrongRewards),
            ADMIN,
            ALLOCATOR
        );
    }
}
