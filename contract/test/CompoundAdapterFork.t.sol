// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CompoundAdapter} from "../src/adapters/CompoundAdapter.sol";
import {IComet} from "../src/interfaces/IComet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Runs only when SEPOLIA_RPC_URL is set. Verifies supply/withdraw and the APR read against
/// the live Comet USDC market.
contract CompoundAdapterForkTest is Test {
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant COMET = 0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e;
    address VAULT; // stand-in vault EOA, set in setUp via makeAddr

    CompoundAdapter adapter;

    function setUp() public {
        VAULT = makeAddr("vault");
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        adapter = new CompoundAdapter(VAULT, USDC, COMET);
    }

    function test_baseTokenMatchesUsdc() public {
        if (address(adapter) == address(0)) return; // skipped without RPC
        assertEq(IComet(COMET).baseToken(), USDC);
    }

    function test_supplyWithdrawAndRate() public {
        if (address(adapter) == address(0)) return;
        uint256 amount = 10e6;
        deal(USDC, address(adapter), amount); // fund the adapter with test USDC
        vm.prank(VAULT);
        adapter.deposit(amount);
        // Comet credits via principal*index and floors, so the supplier balance can be a few base
        // units below the supplied amount. Read the actual credited balance and tolerate the floor.
        uint256 supplied = adapter.totalAssets();
        assertApproxEqAbs(supplied, amount, 5);

        uint256 apr = adapter.supplyRatePerYear();
        assertLe(apr, 1e18); // sanity: <= 100% APR (may be 0 at zero utilization)

        // Withdraw the full credited balance back to the vault.
        vm.prank(VAULT);
        adapter.withdraw(supplied, VAULT);
        assertApproxEqAbs(IERC20(USDC).balanceOf(VAULT), supplied, 5);
    }
}
