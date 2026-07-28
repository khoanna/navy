// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MorphoAdapter} from "../src/adapters/MorphoAdapter.sol";
import {MarketParams} from "../src/interfaces/IMorpho.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MorphoAdapterForkTest is Test {
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant MORPHO = 0xd011EE229E7459ba1ddd22631eF7bF528d424A14;
    address VAULT;

    MorphoAdapter adapter;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        // No-op offline. Also require the market to be resolved: without a pinned
        // MORPHO_MARKET_ID the live params are unknown, so skip (see DEPLOYMENTS.md).
        bytes32 id = vm.envOr("MORPHO_MARKET_ID", bytes32(0));
        if (bytes(rpc).length == 0 || id == bytes32(0)) return;
        vm.createSelectFork(rpc);
        MarketParams memory p = MarketParams({
            loanToken: USDC,
            collateralToken: vm.envAddress("MORPHO_COLLATERAL"),
            oracle: vm.envAddress("MORPHO_ORACLE"),
            irm: vm.envAddress("MORPHO_IRM"),
            lltv: vm.envUint("MORPHO_LLTV")
        });
        adapter = new MorphoAdapter(VAULT, USDC, MORPHO, p, id);
    }

    function test_supplyWithdrawAndRate() public {
        if (address(adapter) == address(0)) return;
        uint256 amount = 10e6;
        deal(USDC, address(adapter), amount);
        vm.prank(VAULT);
        adapter.deposit(amount);
        assertApproxEqAbs(adapter.totalAssets(), amount, 2);

        uint256 apr = adapter.supplyRatePerYear();
        assertLt(apr, 1e18); // sanity: < 100% APR (may be 0 if utilization is 0)

        vm.prank(VAULT);
        adapter.withdraw(amount - 2, VAULT);
        assertApproxEqAbs(IERC20(USDC).balanceOf(VAULT), amount - 2, 2);
    }
}
