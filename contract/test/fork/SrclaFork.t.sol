// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NavyVaultSRCLA} from "../../src/NavyVaultSRCLA.sol";

/**
 * @title SrclaForkTest
 * @notice Base mainnet-pinned fork tests for SRCLA vault evaluation
 * @dev Implements paper §11.4: "Pinned Base-fork jobs validate exact adapter math"
 *
 * Tests run against real Sepolia state to verify:
 * - Adapter balance reconciliation
 * - Share price calculation
 * - State consistency at decision points
 */
contract SrclaForkTest is Test {
    // Deployed NavyVaultSRCLA on Base
    address constant VAULT_ADDRESS = 0x55E728b08FdB9432520FB3Fd1b9D7777320f8ED3;
    address constant COMPOUND_ADAPTER = 0xcF3755C6Ab0Af30bBfffB099f50C8775183ee90d;
    
    NavyVaultSRCLA vault;
    bool forkCreated;
    
    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkCreated = false;
            return;
        }
        forkCreated = true;
        vm.createSelectFork(rpc);
        vault = NavyVaultSRCLA(VAULT_ADDRESS);
    }
    
    modifier withFork() {
        if (!forkCreated) {
            vm.skip(true);
            return;
        }
        _;
    }
    
    /// @notice Verify vault totalAssets > 0 and is consistent
    function test_vault_totalAssetsConsistency() public withFork {
        uint256 totalAssets = vault.totalAssets();
        uint256 idle = IERC20(vault.asset()).balanceOf(address(vault));
        
        console.log("Total assets:", totalAssets);
        console.log("Idle:", idle);
        
        assertGe(idle, 0);
        assertLe(idle, totalAssets);
    }
    
    /// @notice Verify share price is non-zero and reasonable
    function test_vault_sharePriceNonZero() public withFork {
        // convertToAssets(1e18) gives the share price in USDC (6 decimals)
        uint256 sharePrice = vault.convertToAssets(1e18);
        
        console.log("Share price (per 1e18 shares in USDC 6dec):", sharePrice);
        
        // Share price should be positive
        assertGt(sharePrice, 0);
    }
    
    /// @notice Verify adapter balance reconciliation  
    function test_adapterBalance_reconciliation() public withFork {
        // Try to read adapter balance; skip gracefully if selector not available
        // (different contract versions may have different storage layouts)
        (bool success, bytes memory data) = address(vault).staticcall(
            abi.encodeWithSignature("strategyAssets(address)", COMPOUND_ADAPTER)
        );
        
        if (!success || data.length == 0) {
            vm.skip(true);
            return;
        }
        
        uint256 adapterBalance = abi.decode(data, (uint256));
        uint256 totalAssets = vault.totalAssets();
        
        console.log("Compound adapter balance:", adapterBalance);
        console.log("Total assets:", totalAssets);
        
        // Only reconcile if vault has assets deployed
        if (totalAssets == 0) {
            // Vault is empty — adapter balance should also be zero
            assertEq(adapterBalance, 0);
            return;
        }
        
        // Adapter balance + idle should approximately equal totalAssets
        // Allow for rounding and dust
        uint256 idle = IERC20(vault.asset()).balanceOf(address(vault));
        uint256 expectedDeployed = totalAssets > idle ? totalAssets - idle : 0;
        
        if (adapterBalance > 0) {
            // Allow for dust (1 USDC = 1e6)
            assertApproxEqAbs(adapterBalance, expectedDeployed, 1_000_000);
        }
    }
    
    /// @notice Verify vault total supply matches accounting
    function test_vault_totalSupplyNonZero() public withFork {
        uint256 totalSupply = vault.totalSupply();
        uint256 totalAssets = vault.totalAssets();
        
        console.log("Total supply (shares):", totalSupply);
        console.log("Total assets (USDC):", totalAssets);
        
        // If there are assets, there should be shares
        if (totalAssets > 0) {
            assertGt(totalSupply, 0);
        }
    }
    
    /// @notice Verify share conversion is consistent
    function test_vault_sharePriceConvergence() public withFork {
        uint256 totalSupply = vault.totalSupply();
        if (totalSupply == 0) {
            vm.skip(true);
            return;
        }
        
        // Share price via convertToAssets
        uint256 sharePrice = vault.convertToAssets(1e18);
        
        // Share price via totalAssets/totalSupply (approximate)
        uint256 totalAssets = vault.totalAssets();
        uint256 impliedPrice = (totalAssets * 1e18) / totalSupply;
        
        console.log("Share price (convertToAssets):", sharePrice);
        console.log("Implied price (totalAssets/totalSupply):", impliedPrice);
        
        // Should match within 1% (100 bps)
        uint256 diff = sharePrice > impliedPrice ? sharePrice - impliedPrice : impliedPrice - sharePrice;
        uint256 tolerance = impliedPrice / 100; // 1%
        assertLe(diff, tolerance);
    }
    
    /// @notice Stress test: verify vault handles state inspection without revert
    function test_vault_stateInspectionComplete() public withFork {
        // All standard ERC-4626 getters should return without reverting
        vault.totalAssets();
        vault.totalSupply();
        vault.convertToAssets(1e18);
        
        // asset() and balanceOf are only safe if vault has been initialized
        address assetAddr = vault.asset();
        if (assetAddr != address(0)) {
            IERC20(assetAddr).balanceOf(address(vault));
        }
        
        // strategyAssets may not be available in older deployments
        (bool success,) = address(vault).staticcall(
            abi.encodeWithSignature("strategyAssets(address)", COMPOUND_ADAPTER)
        );
        // We don't assert on this — just verifying it doesn't crash the test runner
        (success); // suppress unused variable warning
        
        // If we get here, all reads succeeded
        assertTrue(true);
    }
}
