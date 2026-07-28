// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NavyVault} from "../src/NavyVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NavyVaultFuzzTest is Test {
    NavyVault vault;
    MockUSDC usdc;
    MockYieldAdapter adapter;

    address owner = address(0x0111);
    address relayer = address(0x0333);
    address allocator = address(0x0A11);

    function setUp() public {
        usdc = new MockUSDC();
        vm.startPrank(owner);
        vault = new NavyVault(IERC20(address(usdc)), owner);
        vault.setRelayer(relayer, true);
        vault.setAllocator(allocator, true);
        adapter = new MockYieldAdapter(address(vault), address(usdc), 4e16);
        vault.addAdapter(address(adapter), 10000, 10000);
        vault.setParams(0, 50); // no idle buffer so any amount is deployable in this test
        vm.stopPrank();
    }

    function _deposit(uint256 pk, uint256 amount, bytes32 nonce) internal {
        address user = vm.addr(pk);
        usdc.mint(user, amount);
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                user,
                address(vault),
                amount,
                uint256(0),
                block.timestamp + 1 hours,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.prank(relayer);
        vault.depositWithAuthorization(user, amount, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    /// @dev A user who deposits and immediately redeems all shares never gets more than deposited.
    function testFuzz_depositRedeem_roundtripNoProfit(uint96 amount) public {
        vm.assume(amount >= 1e6 && amount <= 1_000_000e6);
        uint256 pk = 0xBEEF;
        address user = vm.addr(pk);
        _deposit(pk, amount, keccak256(abi.encode(amount)));
        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        uint256 out = vault.redeem(shares, user, user);
        assertLe(out, amount);
        assertApproxEqAbs(out, amount, 1); // at most 1 base-unit rounding loss
    }

    /// @dev Deploying then redeeming through the adapter preserves the roundtrip.
    function testFuzz_deployThenRedeem(uint96 amount) public {
        vm.assume(amount >= 1e6 && amount <= 1_000_000e6);
        uint256 pk = 0xCAFE;
        address user = vm.addr(pk);
        _deposit(pk, amount, keccak256(abi.encode(amount, "x")));
        vm.prank(allocator);
        vault.deployToAdapter(address(adapter), amount);
        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        uint256 out = vault.redeem(shares, user, user);
        assertApproxEqAbs(out, amount, 1);
    }
}
