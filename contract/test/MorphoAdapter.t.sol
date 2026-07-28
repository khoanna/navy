// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MorphoAdapter} from "../src/adapters/MorphoAdapter.sol";
import {MarketParams} from "../src/interfaces/IMorpho.sol";

contract MorphoAdapterConstructorTest is Test {
    address constant USDC = address(0x1111000000000000000000000000000000001111);
    address constant MORPHO = address(0x2222000000000000000000000000000000002222);
    address constant VAULT = address(0x3333000000000000000000000000000000003333);

    function _params(address loanToken) internal pure returns (MarketParams memory) {
        return MarketParams({
            loanToken: loanToken,
            collateralToken: address(0x4444000000000000000000000000000000004444),
            oracle: address(0x5555000000000000000000000000000000005555),
            irm: address(0x6666000000000000000000000000000000006666),
            lltv: 8e17
        });
    }

    function test_constructor_acceptsMatchingMarket() public {
        MarketParams memory p = _params(USDC);
        bytes32 id = keccak256(abi.encode(p));
        MorphoAdapter a = new MorphoAdapter(VAULT, USDC, MORPHO, p, id);
        assertEq(a.marketId(), id);
    }

    function test_constructor_revertsOnLoanTokenMismatch() public {
        MarketParams memory p = _params(address(0x7777000000000000000000000000000000007777));
        bytes32 id = keccak256(abi.encode(p));
        vm.expectRevert(MorphoAdapter.LoanTokenMismatch.selector);
        new MorphoAdapter(VAULT, USDC, MORPHO, p, id);
    }

    function test_constructor_revertsOnIdMismatch() public {
        MarketParams memory p = _params(USDC);
        bytes32 wrongId = keccak256("not-the-market");
        vm.expectRevert(MorphoAdapter.MarketIdMismatch.selector);
        new MorphoAdapter(VAULT, USDC, MORPHO, p, wrongId);
    }
}
