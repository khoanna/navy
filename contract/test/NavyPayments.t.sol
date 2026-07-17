// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyPayments} from "../src/NavyPayments.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract NavyPaymentsTest is Test {
    NavyPayments navy;
    MockUSDC usdc;

    address owner = address(0x0111);
    address treasury = address(0x7EA5);
    address relayer = address(0x0333);
    bytes16 constant MID = bytes16(hex"11111111111111111111111111111111");
    address merchantPayout = address(0x0444);

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        navy = new NavyPayments(address(usdc), treasury, 100, owner);
    }

    function test_constructor_setsConfig() public view {
        assertEq(navy.owner(), owner);
        assertEq(navy.treasury(), treasury);
        assertEq(address(navy.usdc()), address(usdc));
        assertEq(navy.feeBps(), 100);
    }

    function test_constructor_revertsOnFeeTooHigh() public {
        vm.expectRevert(NavyPayments.FeeTooHigh.selector);
        new NavyPayments(address(usdc), treasury, 1001, owner);
    }

    function test_registerMerchant_onlyOwner() public {
        vm.expectRevert(NavyPayments.NotOwner.selector);
        navy.registerMerchant(MID, merchantPayout);
    }

    function test_registerMerchant_storesAndRejectsDuplicate() public {
        vm.prank(owner);
        navy.registerMerchant(MID, merchantPayout);
        (address payout, bool active, bool exists) = navy.merchants(MID);
        assertEq(payout, merchantPayout);
        assertTrue(active);
        assertTrue(exists);

        vm.prank(owner);
        vm.expectRevert(NavyPayments.MerchantExists.selector);
        navy.registerMerchant(MID, merchantPayout);
    }

    function test_setMerchantActiveAndPayout() public {
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setMerchantActive(MID, false);
        navy.setMerchantPayout(MID, address(0x0555));
        vm.stopPrank();
        (address payout, bool active,) = navy.merchants(MID);
        assertEq(payout, address(0x0555));
        assertFalse(active);
    }

    function test_setRelayer_onlyOwner() public {
        vm.expectRevert(NavyPayments.NotOwner.selector);
        navy.setRelayer(relayer, true);

        vm.prank(owner);
        navy.setRelayer(relayer, true);
        assertTrue(navy.relayers(relayer));
    }

    function test_setConfig_boundsFee() public {
        vm.prank(owner);
        vm.expectRevert(NavyPayments.FeeTooHigh.selector);
        navy.setConfig(1001, treasury);
    }
}
