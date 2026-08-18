// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CohortLib
 * @notice Library for cohort-based profit tracking per paper §5.1
 * @dev Tracks cohort windows and calculates weighted returns
 */
library CohortLib {
    uint256 internal constant WAD = 1e18;

    struct Cohort {
        uint64 windowStart;
        uint64 windowEnd;
        uint256 startTotalAssets;
        uint256 startTotalShares;
        uint256 startSharePrice; // WAD format
        uint256 totalDeposits;
        uint256 totalWithdrawals;
        bool closed;
    }

    /**
     * @notice Calculate cohort return for a given end share price
     * @param cohort The cohort data
     * @param endSharePrice The share price at end of period (WAD)
     * @return Return in WAD format (e.g., 50000000000000000 = 5%)
     */
    function calculateReturn(Cohort memory cohort, uint256 endSharePrice)
        internal
        pure
        returns (int256)
    {
        if (cohort.startSharePrice == 0) return 0;

        int256 start = int256(cohort.startSharePrice);
        int256 end = int256(endSharePrice);

        // Return = (end - start) / start
        return ((end - start) * int256(WAD)) / start;
    }

    /**
     * @notice Calculate profit for a specific share amount
     * @param cohort The cohort data
     * @param shareAmount Number of shares (WAD)
     * @param endSharePrice The share price at end of period (WAD)
     * @return Profit in base asset units (WAD)
     */
    function calculateProfit(
        Cohort memory cohort,
        uint256 shareAmount,
        uint256 endSharePrice
    ) internal pure returns (int256) {
        int256 cohortReturn = calculateReturn(cohort, endSharePrice);
        int256 shares = int256(shareAmount);

        // Profit = shares * return (both in WAD terms)
        return (shares * cohortReturn) / int256(WAD);
    }

    /**
     * @notice Calculate weighted return for a late depositor
     * @param cohortReturn Full cohort return (WAD)
     * @param totalDays Total days in cohort window
     * @param daysAfterDeposit Days from deposit to cohort end
     * @return Weighted return (WAD)
     */
    function calculateWeightedReturn(
        int256 cohortReturn,
        uint256 totalDays,
        uint256 daysAfterDeposit
    ) internal pure returns (int256) {
        if (totalDays == 0) return 0;
        if (daysAfterDeposit >= totalDays) return cohortReturn;

        // Weight = daysAfterDeposit / totalDays (as WAD fraction)
        int256 weight = (int256(daysAfterDeposit) * int256(WAD)) / int256(totalDays);

        // Weighted return = cohortReturn * weight
        return (cohortReturn * weight) / int256(WAD);
    }
}
