// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NavyPayments} from "../src/NavyPayments.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract NavyPaymentsFuzzTest is Test {
    NavyPayments navy;
    MockUSDC usdc;
    address owner = address(0x0111);
    address treasury = address(0x7EA5);
    address relayer = address(0x0333);
    address merchantPayout = address(0x0444);
    bytes16 constant MID = bytes16(hex"11111111111111111111111111111111");
    uint256 payerPk = 0xA11CE;

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        navy = new NavyPayments(address(usdc), treasury, 100, owner);
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setRelayer(relayer, true);
        vm.stopPrank();
        vm.warp(1_700_000_000);
    }

    function _signAuth(bytes16 invoiceId, uint256 amount, uint256 validAfter, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address payer = vm.addr(payerPk);
        bytes32 nonce = navy.authorizationNonce(MID, invoiceId);
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), payer, address(navy), amount, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    /// @dev Fee uses ceiling and merchant+treasury exactly conserve the amount, for any valid amount.
    function testFuzz_splitConservesValue(uint256 amount, uint16 feeBps) public {
        amount = bound(amount, navy.MIN_INVOICE_AMOUNT(), 1_000_000_000_000); // 0.01 .. 1M USDC
        feeBps = uint16(bound(feeBps, 0, navy.MAX_FEE_BPS()));
        vm.prank(owner);
        navy.setConfig(feeBps, treasury);

        address payer = vm.addr(payerPk);
        usdc.mint(payer, amount);
        bytes16 invoiceId = bytes16(uint128(amount)); // unique per amount
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(invoiceId, amount, 0, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, payer, v, r, s);

        uint256 expectedFee = feeBps == 0 ? 0 : Math.mulDiv(amount, feeBps, 10_000, Math.Rounding.Ceil);
        assertEq(usdc.balanceOf(treasury), expectedFee);
        assertEq(usdc.balanceOf(merchantPayout), amount - expectedFee);
        assertEq(usdc.balanceOf(merchantPayout) + usdc.balanceOf(treasury), amount);
    }

    /// @dev Fee uses ceiling division: fee is at least the exact rational and differs by < 1 unit.
    /// merchantAmount + fee == amount exactly.
    function testFuzz_ceilingFeeInequalities(uint256 amount, uint16 feeBps) public view {
        amount = bound(amount, navy.MIN_INVOICE_AMOUNT(), 1_000_000_000_000);
        feeBps = uint16(bound(feeBps, 1, navy.MAX_FEE_BPS())); // exclude zero BPS

        uint256 expectedFee = Math.mulDiv(amount, feeBps, 10_000, Math.Rounding.Ceil);
        uint256 exactFee = (amount * feeBps) / 10_000;

        // Ceiling fee is always >= exact fee
        assertTrue(expectedFee >= exactFee);
        // And differs by less than 1 unit (handle equality case to avoid underflow)
        if (expectedFee > exactFee) {
            assertEq(expectedFee - exactFee, 1);
        } else {
            assertEq(expectedFee, exactFee);
        }
        // Cannot be zero when BPS > 0 and amount >= MIN_INVOICE_AMOUNT
        assertGt(expectedFee, 0);
    }

    /// @dev For any valid amount and BPS, the split conserves value exactly.
    function testFuzz_splitConservesValueCeiling(uint256 amount, uint16 feeBps) public {
        amount = bound(amount, navy.MIN_INVOICE_AMOUNT(), 1_000_000_000_000);
        feeBps = uint16(bound(feeBps, 0, navy.MAX_FEE_BPS()));

        vm.prank(owner);
        navy.setConfig(feeBps, treasury);

        address payer = vm.addr(payerPk);
        usdc.mint(payer, amount);
        bytes16 invoiceId = bytes16(uint128(amount + 1)); // unique
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(invoiceId, amount, 0, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, payer, v, r, s);

        uint256 expectedFee = feeBps == 0 ? 0 : Math.mulDiv(amount, feeBps, 10_000, Math.Rounding.Ceil);
        assertEq(usdc.balanceOf(treasury), expectedFee);
        assertEq(usdc.balanceOf(merchantPayout), amount - expectedFee);
        assertEq(usdc.balanceOf(merchantPayout) + usdc.balanceOf(treasury), amount);
    }
}
