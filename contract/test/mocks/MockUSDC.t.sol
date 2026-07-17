// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;
    uint256 payerPk = 0xA11CE;
    address payer;
    address spender = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        payer = vm.addr(payerPk);
        usdc.mint(payer, 1_000_000);
        vm.warp(1_700_000_000); // realistic timestamp
    }

    function _signPermit(address owner, address spndr, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(usdc.PERMIT_TYPEHASH(), owner, spndr, value, usdc.nonces(owner), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(payerPk, digest);
    }

    function test_permit_setsAllowanceAndBumpsNonce() public {
        uint256 deadline = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(payer, spender, 500_000, deadline);

        usdc.permit(payer, spender, 500_000, deadline, v, r, s);

        assertEq(usdc.allowance(payer, spender), 500_000);
        assertEq(usdc.nonces(payer), 1);

        vm.prank(spender);
        usdc.transferFrom(payer, spender, 500_000);
        assertEq(usdc.balanceOf(payer), 500_000);
        assertEq(usdc.balanceOf(spender), 500_000);
        assertEq(usdc.allowance(payer, spender), 0);
    }

    function test_permit_revertsOnExpiredDeadline() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(payer, spender, 500_000, deadline);

        vm.expectRevert(bytes("permit expired"));
        usdc.permit(payer, spender, 500_000, deadline, v, r, s);
    }

    function test_permit_revertsOnBadSignature() public {
        uint256 deadline = block.timestamp + 3600;
        // Sign for 500_000 but submit a different value → recovered signer != owner.
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(payer, spender, 500_000, deadline);

        vm.expectRevert(bytes("invalid permit signature"));
        usdc.permit(payer, spender, 900_000, deadline, v, r, s);
    }
}
