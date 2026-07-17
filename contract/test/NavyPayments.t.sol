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

    /// @dev Sign an EIP-2612 permit authorizing the NavyPayments contract to pull `amount`.
    function _signPermit(uint256 amount, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(usdc.PERMIT_TYPEHASH(), _payer(), address(navy), amount, usdc.nonces(_payer()), deadline)
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
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, deadline);

        vm.expectEmit(true, true, true, true);
        emit NavyPayments.InvoicePaid(MID, invoiceId, _payer(), amount, 10_000, block.timestamp);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, deadline, _payer(), v, r, s);

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
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(amount, deadline);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, deadline, _payer(), v, r, s);

        assertEq(usdc.balanceOf(merchantPayout), 500_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_payInvoice_onlyRelayer() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"44444444444444444444444444444444");
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(500_000, deadline);

        vm.expectRevert(NavyPayments.NotRelayer.selector);
        navy.payInvoice(MID, invoiceId, 500_000, deadline, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsReplay() public {
        _setup_merchant_relayer_funds();
        usdc.mint(_payer(), 1_000_000); // top up for the (never-completed) second attempt
        bytes16 invoiceId = bytes16(hex"55555555555555555555555555555555");
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(500_000, deadline);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, 500_000, deadline, _payer(), v, r, s);

        // The invoice replay guard trips before the permit is re-checked.
        vm.prank(relayer);
        vm.expectRevert(NavyPayments.AlreadyPaid.selector);
        navy.payInvoice(MID, invoiceId, 500_000, deadline, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsInactiveMerchant() public {
        _setup_merchant_relayer_funds();
        vm.prank(owner);
        navy.setMerchantActive(MID, false);
        bytes16 invoiceId = bytes16(hex"66666666666666666666666666666666");
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(500_000, deadline);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.MerchantInactive.selector);
        navy.payInvoice(MID, invoiceId, 500_000, deadline, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsUnknownMerchant() public {
        _setup_merchant_relayer_funds();
        bytes16 unknown = bytes16(hex"99999999999999999999999999999999");
        bytes16 invoiceId = bytes16(hex"77777777777777777777777777777777");
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(500_000, deadline);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.MerchantInactive.selector);
        navy.payInvoice(unknown, invoiceId, 500_000, deadline, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsBelowMinimum() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"88888888888888888888888888888888");
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(9_999, deadline);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.AmountTooSmall.selector);
        navy.payInvoice(MID, invoiceId, 9_999, deadline, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsExpiredDeadline() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(500_000, deadline);

        vm.warp(deadline + 1); // now past the permit deadline
        vm.prank(relayer);
        vm.expectRevert(bytes("permit expired"));
        navy.payInvoice(MID, invoiceId, 500_000, deadline, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsAmountTamper() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        uint256 deadline = block.timestamp + 3600;
        // Sign a permit for 500_000 but submit 900_000: permit signature verification must reject.
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(500_000, deadline);

        vm.prank(relayer);
        vm.expectRevert(bytes("invalid permit signature"));
        navy.payInvoice(MID, invoiceId, 900_000, deadline, _payer(), v, r, s);
    }
}
