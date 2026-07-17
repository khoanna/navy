// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
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
        bytes32 nonce = keccak256(abi.encodePacked(MID, invoiceId));
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer,
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

    /// @dev Fee floors and merchant+treasury exactly conserve the amount, for any valid amount.
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

        uint256 expectedFee = (amount * feeBps) / 10000;
        assertEq(usdc.balanceOf(treasury), expectedFee);
        assertEq(usdc.balanceOf(merchantPayout), amount - expectedFee);
        assertEq(usdc.balanceOf(merchantPayout) + usdc.balanceOf(treasury), amount);
    }
}
