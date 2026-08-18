// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CohortLib} from "../../src/libraries/CohortLib.sol";

contract CohortLibTest is Test {
    using CohortLib for CohortLib.Cohort;

    function testCalculateReturn_ZeroStartPrice() public pure {
        CohortLib.Cohort memory cohort;
        // Should return 0 when start price is 0
        assertEq(cohort.calculateReturn(1e18), 0);
    }

    function testCalculateReturn_PositiveReturn() public pure {
        CohortLib.Cohort memory cohort = CohortLib.Cohort({
            windowStart: 0,
            windowEnd: 7 days,
            startTotalAssets: 1000e6,
            startTotalShares: 1000e18,
            startSharePrice: 1e18, // 1 USDC per share
            totalDeposits: 0,
            totalWithdrawals: 0,
            closed: false
        });

        // End price = 1.05 USDC (5% return)
        int256 result = cohort.calculateReturn(1.05e18);
        assertEq(result, 50000000000000000); // 0.05e18 = 5% in WAD
    }

    function testCalculateReturn_NegativeReturn() public pure {
        CohortLib.Cohort memory cohort = CohortLib.Cohort({
            windowStart: 0,
            windowEnd: 7 days,
            startTotalAssets: 1000e6,
            startTotalShares: 1000e18,
            startSharePrice: 1e18,
            totalDeposits: 0,
            totalWithdrawals: 0,
            closed: false
        });

        // End price = 0.95 USDC (-5% return)
        int256 result = cohort.calculateReturn(0.95e18);
        assertEq(result, -50000000000000000); // -5% in WAD
    }

    function testCalculateProfit() public pure {
        CohortLib.Cohort memory cohort = CohortLib.Cohort({
            windowStart: 0,
            windowEnd: 7 days,
            startTotalAssets: 1000e6,
            startTotalShares: 1000e18,
            startSharePrice: 1e18,
            totalDeposits: 0,
            totalWithdrawals: 0,
            closed: false
        });

        // 100 shares at 5% return
        // Profit = 100 * 0.05 = 5 (in WAD terms)
        int256 profit = cohort.calculateProfit(100e18, 1.05e18);
        assertEq(profit, 5000000000000000000); // 5e18 = 5 USDC
    }

    function testCalculateProfit_NegativeReturn() public pure {
        CohortLib.Cohort memory cohort = CohortLib.Cohort({
            windowStart: 0,
            windowEnd: 7 days,
            startTotalAssets: 1000e6,
            startTotalShares: 1000e18,
            startSharePrice: 1e18,
            totalDeposits: 0,
            totalWithdrawals: 0,
            closed: false
        });

        // 100 shares at -5% return
        int256 profit = cohort.calculateProfit(100e18, 0.95e18);
        assertEq(profit, -5000000000000000000); // -5e18 = -5 USDC loss
    }
}
