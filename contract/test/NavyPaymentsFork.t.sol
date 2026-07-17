// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyPayments} from "../src/NavyPayments.sol";
import {IEIP3009} from "../src/interfaces/IEIP3009.sol";

/// @dev Exercises the REAL Circle USDC receiveWithAuthorization on a Sepolia fork.
/// Skips automatically when SEPOLIA_RPC_URL is not set.
contract NavyPaymentsForkTest is Test {
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    NavyPayments navy;
    address owner = address(0x0111);
    address treasury = address(0x7EA5);
    address relayer = address(0x0333);
    address merchantPayout = address(0x0444);
    bytes16 constant MID = bytes16(hex"11111111111111111111111111111111");
    uint256 payerPk = 0xA11CE;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        vm.prank(owner);
        navy = new NavyPayments(USDC, treasury, 100, owner);
        vm.startPrank(owner);
        navy.registerMerchant(MID, merchantPayout);
        navy.setRelayer(relayer, true);
        vm.stopPrank();
    }

    function _domainSeparator() internal view returns (bytes32) {
        // FiatTokenV2_2 exposes DOMAIN_SEPARATOR().
        (bool ok, bytes memory out) = USDC.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        require(ok, "no DOMAIN_SEPARATOR");
        return abi.decode(out, (bytes32));
    }

    function _signFork(address payer, bytes16 invoiceId, uint256 amount, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 nonce = keccak256(abi.encodePacked(MID, invoiceId));
        bytes32 typeHash = keccak256(
            "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
        bytes32 structHash =
            keccak256(abi.encode(typeHash, payer, address(navy), amount, uint256(0), validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        return vm.sign(payerPk, digest);
    }

    function test_fork_realUsdcReceiveWithAuthorization() public {
        if (address(navy) == address(0)) {
            emit log("SKIP: set SEPOLIA_RPC_URL to run the fork test");
            return;
        }
        address payer = vm.addr(payerPk);
        uint256 amount = 1_000_000;
        // Give the payer USDC by cheating balance via `deal` (works on forked ERC-20s).
        deal(USDC, payer, amount);

        bytes16 invoiceId = bytes16(hex"22222222222222222222222222222222");
        uint256 validBefore = block.timestamp + 3600;
        (uint8 v, bytes32 r, bytes32 s) = _signFork(payer, invoiceId, amount, validBefore);

        vm.prank(relayer);
        navy.payInvoice(MID, invoiceId, amount, 0, validBefore, payer, v, r, s);

        assertEq(IEIP3009(USDC).balanceOf(merchantPayout), 990_000);
        assertEq(IEIP3009(USDC).balanceOf(treasury), 10_000);
    }
}
