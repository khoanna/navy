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

    function test_constructor_revertsOnZeroUsdc() public {
        vm.expectRevert(NavyPayments.ZeroAddress.selector);
        new NavyPayments(address(0), treasury, 100, owner);
    }

    function test_constructor_revertsOnZeroTreasury() public {
        vm.expectRevert(NavyPayments.ZeroAddress.selector);
        new NavyPayments(address(usdc), address(0), 100, owner);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(NavyPayments.ZeroAddress.selector);
        new NavyPayments(address(usdc), treasury, 100, address(0));
    }

    function test_registerMerchant_onlyOwner() public {
        vm.expectRevert(NavyPayments.NotOwner.selector);
        navy.registerMerchant(MID, merchantPayout);
    }

    function test_registerMerchant_revertsOnZeroPayout() public {
        vm.prank(owner);
        vm.expectRevert(NavyPayments.ZeroAddress.selector);
        navy.registerMerchant(MID, address(0));
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

    function test_setMerchantActive_revertsOnUnknownMerchant() public {
        vm.prank(owner);
        vm.expectRevert(NavyPayments.MerchantUnknown.selector);
        navy.setMerchantActive(MID, false);
    }

    function test_setMerchantPayout_revertsOnUnknownMerchant() public {
        vm.prank(owner);
        vm.expectRevert(NavyPayments.MerchantUnknown.selector);
        navy.setMerchantPayout(MID, merchantPayout);
    }

    function test_setMerchantPayout_revertsOnZeroPayout() public {
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        vm.expectRevert(NavyPayments.ZeroAddress.selector);
        navy.setMerchantPayout(MID, address(0));
        vm.stopPrank();
    }

    function test_setRelayer_onlyOwner() public {
        vm.expectRevert(NavyPayments.NotOwner.selector);
        navy.setRelayer(relayer, true);

        vm.prank(owner);
        navy.setRelayer(relayer, true);
        assertTrue(navy.relayers(relayer));
    }

    function test_setRelayer_removalRevertsPayInvoice() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"cccccccccccccccccccccccccccccccc");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        // Owner revokes the relayer.
        vm.prank(owner);
        navy.setRelayer(relayer, false);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.NotRelayer.selector);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_setConfig_boundsFee() public {
        vm.prank(owner);
        vm.expectRevert(NavyPayments.FeeTooHigh.selector);
        navy.setConfig(1001, treasury);
    }

    function test_setConfig_revertsOnZeroTreasury() public {
        vm.prank(owner);
        vm.expectRevert(NavyPayments.ZeroAddress.selector);
        navy.setConfig(100, address(0));
    }

    uint256 payerPk = 0xA11CE;

    function _payer() internal view returns (address) {
        return vm.addr(payerPk);
    }

    function _invoiceKey(bytes16 merchantId, bytes16 invoiceId) internal view returns (bytes32) {
        return navy.authorizationNonce(merchantId, invoiceId);
    }

    function test_configurationChangeInvalidatesPendingAuthorization() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"dddddddddddddddddddddddddddddddd");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        vm.prank(owner);
        navy.setMerchantPayout(MID, address(0xBEEF));

        vm.prank(relayer);
        vm.expectRevert();
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    /// @dev Sign an EIP-3009 ReceiveWithAuthorization whose nonce = keccak256(merchantId, invoiceId).
    /// This binds the merchant + invoice + amount + payer + expiry window into the payer's signature.
    function _signAuth(bytes16 merchantId, bytes16 invoiceId, uint256 amount, uint256 validAfter, uint256 validBefore)
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
                validAfter,
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
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, amount, 0, validBefore);

        vm.expectEmit(true, true, true, true);
        emit NavyPayments.InvoicePaid(MID, invoiceId, _payer(), amount, 10_000, block.timestamp);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, _payer(), v, r, s);

        assertEq(usdc.balanceOf(merchantPayout), 990_000);
        assertEq(usdc.balanceOf(treasury), 10_000);
        assertEq(usdc.balanceOf(_payer()), 0);
        assertTrue(navy.invoicePaid(navy.invoiceKey(MID, invoiceId)));
    }

    function test_feeRoundsUp_c10_001At100Bps_equals101() public {
        // 10,001 * 100 / 10,000 = 100.01, should round up to 101
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"deadbeefdeadbeefdeadbeefdeadbeef");
        uint256 amount = 10_001;
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, amount, 0, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, _payer(), v, r, s);

        assertEq(usdc.balanceOf(treasury), 101); // rounded up
        assertEq(usdc.balanceOf(merchantPayout), 9_900); // 10001 - 101
        assertEq(usdc.balanceOf(merchantPayout) + usdc.balanceOf(treasury), amount);
    }

    function test_payInvoice_zeroFeeWhenFeeBpsZero() public {
        vm.prank(owner);
        navy.setConfig(0, treasury);
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"33333333333333333333333333333333");
        uint256 amount = 500_000;
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, amount, 0, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, _payer(), v, r, s);

        assertEq(usdc.balanceOf(merchantPayout), 500_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_payInvoice_onlyRelayer() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"44444444444444444444444444444444");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        vm.expectRevert(NavyPayments.NotRelayer.selector);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsReplay() public {
        _setup_merchant_relayer_funds();
        usdc.mint(_payer(), 1_000_000); // top up for the (never-completed) second attempt
        bytes16 invoiceId = bytes16(hex"55555555555555555555555555555555");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);

        // The invoice replay guard trips before the authorization is re-checked.
        vm.prank(relayer);
        vm.expectRevert(NavyPayments.AlreadyPaid.selector);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsInactiveMerchant() public {
        _setup_merchant_relayer_funds();
        vm.prank(owner);
        navy.setMerchantActive(MID, false);
        bytes16 invoiceId = bytes16(hex"66666666666666666666666666666666");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.MerchantInactive.selector);
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsUnknownMerchant() public {
        _setup_merchant_relayer_funds();
        bytes16 unknown = bytes16(hex"99999999999999999999999999999999");
        bytes16 invoiceId = bytes16(hex"77777777777777777777777777777777");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(unknown, invoiceId, 500_000, 0, validBefore);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.MerchantInactive.selector);
        navy.payInvoice(unknown, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsBelowMinimum() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"88888888888888888888888888888888");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 9_999, 0, validBefore);

        vm.prank(relayer);
        vm.expectRevert(NavyPayments.AmountTooSmall.selector);
        navy.payInvoice(MID, invoiceId, 9_999, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsExpiredValidBefore() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        vm.warp(validBefore + 1); // now past the authorization's validBefore
        vm.prank(relayer);
        vm.expectRevert(bytes("authorization expired"));
        navy.payInvoice(MID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsAmountTamper() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceId = bytes16(hex"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        uint256 validBefore = block.timestamp + 3600;
        // Sign an authorization for 500_000 but submit 900_000: the USDC signature check must reject.
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        vm.prank(relayer);
        vm.expectRevert(bytes("invalid authorization signature"));
        navy.payInvoice(MID, invoiceId, 900_000, 0, validBefore, _payer(), v, r, s);
    }

    /// @dev The KEY property EIP-3009 restores: the nonce = keccak256(merchantId, invoiceId) is
    /// part of the signed message, so an authorization signed for (MID, invoiceA) cannot be redeemed
    /// for a different invoice or a different merchant — the USDC signature check fails.
    function test_payInvoice_rejectsInvoiceBindingMismatch() public {
        _setup_merchant_relayer_funds();
        bytes16 invoiceA = bytes16(hex"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1");
        bytes16 invoiceB = bytes16(hex"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2");
        uint256 validBefore = block.timestamp + 3600;
        // Signature bound to (MID, invoiceA).
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceA, 500_000, 0, validBefore);

        // Submitting it for (MID, invoiceB) recomputes a different nonce → signature recovery fails.
        vm.prank(relayer);
        vm.expectRevert(bytes("invalid authorization signature"));
        navy.payInvoice(MID, invoiceB, 500_000, 0, validBefore, _payer(), v, r, s);
    }

    function test_payInvoice_rejectsMerchantBindingMismatch() public {
        _setup_merchant_relayer_funds();
        bytes16 otherMID = bytes16(hex"22222222222222222222222222222222");
        vm.prank(owner);
        navy.registerMerchant(otherMID, address(0x0999));
        bytes16 invoiceId = bytes16(hex"c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3");
        uint256 validBefore = block.timestamp + 3600;
        // Signature bound to (MID, invoiceId).
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(MID, invoiceId, 500_000, 0, validBefore);

        // Submitting it under otherMID recomputes a different nonce → signature recovery fails.
        vm.prank(relayer);
        vm.expectRevert(bytes("invalid authorization signature"));
        navy.payInvoice(otherMID, invoiceId, 500_000, 0, validBefore, _payer(), v, r, s);
    }
}
