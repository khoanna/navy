// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {NavyVault} from "../src/NavyVault.sol";
import {DeployBaseVault} from "../script/DeployBaseVault.s.sol";

contract DeployBaseVaultTest is Test {
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    address internal admin = address(0xA11CE);
    address internal allocator = address(0xA110CA7E);

    DeployBaseVault internal deployer;

    function setUp() public {
        deployer = new DeployBaseVault();
    }

    function test_deployRejectsWrongChain() public {
        vm.chainId(11155111);

        vm.expectRevert(DeployBaseVault.WrongChain.selector);
        deployer.deployCore(BASE_USDC, admin, allocator);
    }

    function test_deployRejectsWrongAsset() public {
        vm.chainId(8453);

        vm.expectRevert(DeployBaseVault.WrongAsset.selector);
        deployer.deployCore(address(0xBADC0DE), admin, allocator);
    }

    function test_deployRejectsZeroAdmin() public {
        vm.chainId(8453);

        vm.expectRevert(DeployBaseVault.InvalidAdmin.selector);
        deployer.deployCore(BASE_USDC, address(0), allocator);
    }

    function test_deployRejectsZeroAllocator() public {
        vm.chainId(8453);

        vm.expectRevert(DeployBaseVault.InvalidAllocator.selector);
        deployer.deployCore(BASE_USDC, admin, address(0));
    }

    function test_deployRejectsSameAdminAndAllocator() public {
        vm.chainId(8453);

        vm.expectRevert(DeployBaseVault.RoleCollision.selector);
        deployer.deployCore(BASE_USDC, admin, admin);
    }

    function test_deploysCanonicalBaseCoreWithDistinctRolesAndNoRelayerSurface() public {
        vm.chainId(8453);

        NavyVault vault = deployer.deployCore(BASE_USDC, admin, allocator);

        assertEq(vault.asset(), BASE_USDC);
        assertEq(vault.owner(), admin);
        assertEq(vault.allocator(), allocator);
        assertEq(vault.pendingOwner(), address(0));
        assertEq(address(vault.rewardAccountant()), address(0));
        assertEq(vault.adapterCount(), 0);
        assertEq(vault.adminIdleFloor(), 0);
        assertFalse(vault.paused());

        (bool relayerGetterExists,) = address(vault).staticcall(abi.encodeWithSignature("relayers(address)", allocator));
        assertFalse(relayerGetterExists);

        (bool relayerSetterExists,) =
            address(vault).call(abi.encodeWithSignature("setRelayer(address,bool)", allocator, true));
        assertFalse(relayerSetterExists);
    }
}
