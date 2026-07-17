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

    uint256 payerPk = 0xA11CE;

    function _payer() internal view returns (address) {
        return vm.addr(payerPk);
    }

    function _invoiceKey(bytes16 merchantId, bytes16 invoiceId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(merchantId, invoiceId));
    }

    function _signInvoice(bytes16 merchantId, bytes16 invoiceId, uint256 amount, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 nonce = _invoiceKey(merchantId, invoiceId);
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                _payer(),
                address(navy),
                amount,
                uint256(0),
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    function _setup_merchant_relayer_funds() internal {
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setRelayer(relayer, true);
        vm.stopPrank();
        usdc.mint(_payer(), 1_000_000);
        vm.warp(1_700_000_000);
    }

    function test_payInvoice_splitsAndEmits() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"22222222222222222222222222222222");
        uint256 amount = 1_000_000; // 1 USDC
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, amount, validBefore);

        vm.expectEmit(true, true, true, true);
        emit NavyPayments.InvoicePaid(MID, invoiceId, _payer(), amount, 10_000, block.timestamp);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, _payer(), v, r, s);

        assertEq(usdc.balanceOf(merchantPayout), 990_000);
        assertEq(usdc.balanceOf(treasury), 10_000);
        assertEq(usdc.balanceOf(_payer()), 0);
        assertTrue(navy.invoicePaid(_invoiceKey(MID, invoiceId)));
    }

    function test_payInvoice_zeroFeeWhenFeeBpsZero() public {
        vm.prank(owner);
        navy.setConfig(0, treasury);
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"33333333333333333333333333333333");
        uint256 amount = 500_000;
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signInvoice(MID, invoiceId, amount, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, _payer(), v, r, s);

        assertEq(usdc.balanceOf(merchantPayout), 500_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }
}
