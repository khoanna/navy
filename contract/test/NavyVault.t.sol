// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NavyVaultTest is Test {
    NavyVault vault;
    MockUSDC usdc;
    MockYieldAdapter adapterA;
    MockYieldAdapter adapterB;

    address owner = address(0x0111);
    address relayer = address(0x0333);
    address allocator = address(0x0A11);
    address alice = address(0xA11CE);

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        vault = new NavyVault(IERC20(address(usdc)), owner);
        vm.startPrank(owner);
        vault.setRelayer(relayer, true);
        vault.setAllocator(allocator, true);
        adapterA = new MockYieldAdapter(address(vault), address(usdc), 3e16); // 3% APR
        adapterB = new MockYieldAdapter(address(vault), address(usdc), 5e16); // 5% APR
        vault.addAdapter(address(adapterA), 5000, 10000); // target 50%, cap 100%
        vault.addAdapter(address(adapterB), 5000, 10000);
        vault.setParams(1000, 50); // minIdleBps 10%, maxLossBps 0.5%
        vm.stopPrank();
    }

    function test_constructor_metadata() public view {
        assertEq(vault.name(), "Navy Vault USDC");
        assertEq(vault.symbol(), "navUSDC");
        assertEq(vault.owner(), owner);
        assertEq(vault.asset(), address(usdc));
    }

    function test_addAdapter_registersAndTracks() public view {
        assertEq(vault.adapterCount(), 2);
        (bool exists, uint16 targetBps, uint16 capBps) = vault.adapterInfo(address(adapterA));
        assertTrue(exists);
        assertEq(targetBps, 5000);
        assertEq(capBps, 10000);
    }

    function test_addAdapter_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(NavyVault.NotOwner.selector);
        vault.addAdapter(address(0xdead), 5000, 10000);
    }

    function test_removeAdapter_requiresEmpty() public {
        vm.prank(owner);
        vault.removeAdapter(address(adapterA));
        assertEq(vault.adapterCount(), 1);
    }
}
