// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;
    uint256 payerPk = 0xA11CE;
    address payer;
    address payee = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        payer = vm.addr(payerPk);
        usdc.mint(payer, 1_000_000);
        vm.warp(1_700_000_000); // realistic timestamp
    }

    function _signAuth(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    function test_receiveWithAuthorization_transfersAndMarksNonce() public {
        bytes32 nonce = keccak256("nonce-1");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payer, payee, 500_000, 0, validBefore, nonce);

        vm.prank(payee);
        usdc.receiveWithAuthorization(payer, payee, 500_000, 0, validBefore, nonce, v, r, s);

        assertEq(usdc.balanceOf(payer), 500_000);
        assertEq(usdc.balanceOf(payee), 500_000);
        assertTrue(usdc.authorizationState(payer, nonce));
    }

    function test_receiveWithAuthorization_revertsWhenCallerNotPayee() public {
        bytes32 nonce = keccak256("nonce-2");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payer, payee, 500_000, 0, validBefore, nonce);

        vm.expectRevert(bytes("caller must be the payee"));
        usdc.receiveWithAuthorization(payer, payee, 500_000, 0, validBefore, nonce, v, r, s);
    }

    function test_receiveWithAuthorization_revertsOnExpired() public {
        bytes32 nonce = keccak256("nonce-3");
        uint256 validBefore = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payer, payee, 500_000, 0, validBefore, nonce);

        vm.prank(payee);
        vm.expectRevert(bytes("authorization expired"));
        usdc.receiveWithAuthorization(payer, payee, 500_000, 0, validBefore, nonce, v, r, s);
    }

    function test_receiveWithAuthorization_revertsOnReusedNonce() public {
        bytes32 nonce = keccak256("nonce-4");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payer, payee, 100_000, 0, validBefore, nonce);

        vm.prank(payee);
        usdc.receiveWithAuthorization(payer, payee, 100_000, 0, validBefore, nonce, v, r, s);

        vm.prank(payee);
        vm.expectRevert(bytes("authorization used"));
        usdc.receiveWithAuthorization(payer, payee, 100_000, 0, validBefore, nonce, v, r, s);
    }

    function test_receiveWithAuthorization_revertsOnBadSignature() public {
        bytes32 nonce = keccak256("nonce-5");
        uint256 validBefore = block.timestamp + 3600;
        // Sign for 500_000 but submit a different value → recovered signer != from.
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(payer, payee, 500_000, 0, validBefore, nonce);

        vm.prank(payee);
        vm.expectRevert(bytes("invalid authorization signature"));
        usdc.receiveWithAuthorization(payer, payee, 900_000, 0, validBefore, nonce, v, r, s);
    }
}
