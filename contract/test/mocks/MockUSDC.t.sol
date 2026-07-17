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
        vm.warp(1_700_000_000); // realistic timestamp so validAfter=0 passes
    }

    function _sign(uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer,
                payee,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    function test_receiveWithAuthorization_movesFundsAndBurnsNonce() public {
        bytes32 nonce = keccak256("inv-1");
        (uint8 v, bytes32 r, bytes32 s) = _sign(500_000, 0, block.timestamp + 3600, nonce);

        vm.prank(payee);
        usdc.receiveWithAuthorization(payer, payee, 500_000, 0, block.timestamp + 3600, nonce, v, r, s);

        assertEq(usdc.balanceOf(payer), 500_000);
        assertEq(usdc.balanceOf(payee), 500_000);
        assertTrue(usdc.authorizationState(payer, nonce));
    }

    function test_receiveWithAuthorization_revertsWhenCallerNotPayee() public {
        bytes32 nonce = keccak256("inv-2");
        (uint8 v, bytes32 r, bytes32 s) = _sign(500_000, 0, block.timestamp + 3600, nonce);

        vm.expectRevert(bytes("caller must be the payee"));
        usdc.receiveWithAuthorization(payer, payee, 500_000, 0, block.timestamp + 3600, nonce, v, r, s);
    }
}
