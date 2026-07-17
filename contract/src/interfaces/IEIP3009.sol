// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal subset of an EIP-3009 token (Circle Sepolia USDC) that NavyPayments depends on.
/// `receiveWithAuthorization` requires `msg.sender == to`, so only NavyPayments can redeem an
/// authorization signed against it — binding merchant+invoice+amount+payer+expiry into the nonce.
interface IEIP3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function transfer(address to, uint256 value) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}
