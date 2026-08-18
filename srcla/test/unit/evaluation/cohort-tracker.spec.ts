/**
 * Cohort Tracker Tests
 *
 * Tests for cohort tracking service:
 * - Cohort ID calculation
 * - Return calculations
 * - Weighted return for late depositors
 * - Profit calculations
 */
import { CohortTracker, WAD, COHORT_WINDOW_SECONDS, type Cohort, type DepositRecord } from '../../../src/evaluation/cohort-tracker.js';

// Mock vault state provider
function createMockVaultStateProvider(initialSharePrice: bigint = WAD) {
  return {
    getCurrentState: async () => ({
      totalAssets: 10_000_000_000_000n, // 10M USDC
      totalShares: 10_000_000_000_000_000_000_000_000n, // 10M shares at 1:1
      idleBase: 1_000_000_000_000n, // 1M idle
      strategyBalances: new Map<string, bigint>(),
      sharePrice: initialSharePrice,
    }),
    getSharePrice: async () => initialSharePrice,
  };
}

describe('CohortTracker', () => {
  describe('Cohort ID calculation', () => {
    it('should calculate correct cohort ID for a date', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      // Cohort epoch is 2024-01-01
      // 7-day windows, so:
      // 2024-01-01 to 2024-01-08 = cohort 0
      // 2024-01-08 to 2024-01-15 = cohort 1
      const cohortId = tracker.computeCohortId(new Date('2024-01-05'));

      expect(cohortId).toBe(0);
    });

    it('should return different IDs for different weeks', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const cohortId1 = tracker.computeCohortId(new Date('2024-01-05'));
      const cohortId2 = tracker.computeCohortId(new Date('2024-01-15'));

      expect(cohortId2).toBeGreaterThan(cohortId1);
    });
  });

  describe('Cohort window calculation', () => {
    it('should compute correct window start and end', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      // Cohort 0: 2024-01-01 to 2024-01-08
      const window = tracker.computeCohortWindow(0);

      expect(window.windowStart.getTime()).toBe(new Date('2024-01-01').getTime());
      expect(window.windowEnd.getTime()).toBe(new Date('2024-01-08').getTime());
    });

    it('should have 7-day window duration', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const window = tracker.computeCohortWindow(0);
      const duration = window.windowEnd.getTime() - window.windowStart.getTime();

      // 7 days in ms = 7 * 24 * 60 * 60 * 1000 = 604800000
      expect(duration).toBe(604800000);
    });
  });

  describe('calculateCohortReturn', () => {
    it('should return 0 for zero start price', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohort: Cohort = {
        id: 1,
        windowStart: new Date('2024-01-01'),
        windowEnd: new Date('2024-01-08'),
        startSharePrice: 0n,
        endSharePrice: undefined,
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        closed: false,
      };

      const result = tracker.calculateCohortReturn(cohort, WAD);

      expect(result).toBe(0);
    });

    it('should calculate positive return correctly', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohort: Cohort = {
        id: 1,
        windowStart: new Date('2024-01-01'),
        windowEnd: new Date('2024-01-08'),
        startSharePrice: WAD, // 1 USDC
        endSharePrice: undefined,
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        closed: true,
      };

      // End price = 1.05 USDC (5% return)
      const endPrice = (WAD * 105n) / 100n;
      const result = tracker.calculateCohortReturn(cohort, endPrice);

      expect(result).toBeCloseTo(0.05, 5);
    });

    it('should calculate negative return correctly', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohort: Cohort = {
        id: 1,
        windowStart: new Date('2024-01-01'),
        windowEnd: new Date('2024-01-08'),
        startSharePrice: WAD, // 1 USDC
        endSharePrice: undefined,
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        closed: true,
      };

      // End price = 0.95 USDC (-5% return)
      const endPrice = (WAD * 95n) / 100n;
      const result = tracker.calculateCohortReturn(cohort, endPrice);

      expect(result).toBeCloseTo(-0.05, 5);
    });

    it('should handle 10% return', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohort: Cohort = {
        id: 1,
        windowStart: new Date('2024-01-01'),
        windowEnd: new Date('2024-01-08'),
        startSharePrice: WAD,
        endSharePrice: undefined,
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        closed: true,
      };

      // End price = 1.10 USDC (10% return)
      const endPrice = (WAD * 110n) / 100n;
      const result = tracker.calculateCohortReturn(cohort, endPrice);

      expect(result).toBeCloseTo(0.10, 5);
    });
  });

  describe('calculateWeightedReturn', () => {
    it('should return full return for early depositor', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohortReturn = 0.05;
      const cohortStart = new Date('2024-01-01T00:00:00');
      const cohortEnd = new Date('2024-01-08T00:00:00');

      // Deposited on day 1 (full 7-day period)
      const depositTime = new Date('2024-01-01T00:00:00');

      const result = tracker.calculateWeightedReturn(cohortReturn, cohortStart, cohortEnd, depositTime);

      expect(result).toBeCloseTo(0.05, 5);
    });

    it('should return proportional return for late depositor (mid-cohort)', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohortReturn = 0.05;
      const cohortStart = new Date('2024-01-01T00:00:00');
      const cohortEnd = new Date('2024-01-08T00:00:00');

      // Deposited on day 4 (halfway through = 50% of period)
      const depositTime = new Date('2024-01-04T12:00:00');

      const result = tracker.calculateWeightedReturn(cohortReturn, cohortStart, cohortEnd, depositTime);

      // Should be approximately 50% of full return (0.025)
      expect(result).toBeLessThan(0.05);
      expect(result).toBeGreaterThan(0.02);
    });

    it('should return 0 for post-cohort deposit', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohortReturn = 0.05;
      const cohortStart = new Date('2024-01-01T00:00:00');
      const cohortEnd = new Date('2024-01-08T00:00:00');

      // Deposited after cohort ended
      const depositTime = new Date('2024-01-10T00:00:00');

      const result = tracker.calculateWeightedReturn(cohortReturn, cohortStart, cohortEnd, depositTime);

      expect(result).toBe(0);
    });

    it('should return proportional return for deposit very late in cohort', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohortReturn = 0.05;
      const cohortStart = new Date('2024-01-01T00:00:00');
      const cohortEnd = new Date('2024-01-08T00:00:00');

      // Deposited 1 second before cohort end
      // Should get 1 second / 7 days = 0.000165% of return
      const depositTime = new Date('2024-01-07T23:59:59');

      const result = tracker.calculateWeightedReturn(cohortReturn, cohortStart, cohortEnd, depositTime);

      // Expected: 0.05 * (1 second / 7 days) = 0.05 * (1/604800) ≈ 8.27e-8
      const expectedResult = cohortReturn * (1 / (7 * 24 * 60 * 60));
      expect(result).toBeCloseTo(expectedResult, 10);
    });

    it('should return near-full return for deposit early in cohort', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohortReturn = 0.05;
      const cohortStart = new Date('2024-01-01T00:00:00');
      const cohortEnd = new Date('2024-01-08T00:00:00');

      // Deposited 12 hours before cohort end
      // Expected: 0.05 * (12 hours / 7 days) = 0.05 * (12/168) ≈ 0.00357
      const depositTime = new Date('2024-01-07T12:00:00');

      const result = tracker.calculateWeightedReturn(cohortReturn, cohortStart, cohortEnd, depositTime);

      // Expected: 0.05 * (12 hours / 7 days) = 0.05 * 0.0714 ≈ 0.00357
      expect(result).toBeCloseTo(0.00357, 3);
    });

    it('should return 0 for exact cohort end time deposit', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());
      const cohortReturn = 0.05;
      const cohortStart = new Date('2024-01-01T00:00:00');
      const cohortEnd = new Date('2024-01-08T00:00:00');

      // Deposited exactly at cohort end
      const depositTime = new Date('2024-01-08T00:00:00');

      const result = tracker.calculateWeightedReturn(cohortReturn, cohortStart, cohortEnd, depositTime);

      expect(result).toBe(0);
    });
  });

  describe('calculateWeightedReturnWad (WAD arithmetic)', () => {
    it('should calculate weighted return using WAD arithmetic', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const cohortReturnWad = 50_000_000_000_000_000n; // 0.05 WAD
      const cohortStartMs = 1704067200000n; // 2024-01-01
      const cohortEndMs = 1704672000000n; // 2024-01-08
      const depositMs = 1704336000000n; // 2024-01-04

      const result = tracker.calculateWeightedReturnWad(cohortReturnWad, cohortStartMs, cohortEndMs, depositMs);

      // Should be approximately 50% of the return
      expect(Number(result)).toBeGreaterThan(0);
      expect(Number(result)).toBeLessThan(Number(cohortReturnWad));
    });

    it('should return full return for start-of-cohort deposit', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const cohortReturnWad = 50_000_000_000_000_000n; // 0.05 WAD
      const cohortStartMs = 1704067200000n; // 2024-01-01
      const cohortEndMs = 1704672000000n; // 2024-01-08
      const depositMs = 1704067200000n; // 2024-01-01 (start)

      const result = tracker.calculateWeightedReturnWad(cohortReturnWad, cohortStartMs, cohortEndMs, depositMs);

      expect(result).toBe(cohortReturnWad);
    });

    it('should return 0 for post-cohort deposit', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const cohortReturnWad = 50_000_000_000_000_000n; // 0.05 WAD
      const cohortStartMs = 1704067200000n; // 2024-01-01
      const cohortEndMs = 1704672000000n; // 2024-01-08
      const depositMs = 1704768000000n; // 2024-01-09 (after end)

      const result = tracker.calculateWeightedReturnWad(cohortReturnWad, cohortStartMs, cohortEndMs, depositMs);

      expect(result).toBe(0n);
    });
  });

  describe('calculateProfit', () => {
    it('should calculate profit for positive return', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      // 1000 shares, 5% return
      const shares = 1000n * WAD; // 1000 shares in WAD
      const weightedReturn = 0.05;

      const profit = tracker.calculateProfit(shares, weightedReturn);

      // Profit = 1000 * 0.05 = 50 USDC
      expect(profit).toBe(50_000_000n); // 50 USDC (6 decimals)
    });

    it('should calculate profit for negative return', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const shares = 1000n * WAD;
      const weightedReturn = -0.05;

      const profit = tracker.calculateProfit(shares, weightedReturn);

      expect(profit).toBe(-50_000_000n);
    });

    it('should return 0 for zero shares', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const profit = tracker.calculateProfit(0n, 0.05);

      expect(profit).toBe(0n);
    });

    it('should handle small returns correctly', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      // 100 shares, 0.5% return
      const shares = 100n * WAD;
      const weightedReturn = 0.005;

      const profit = tracker.calculateProfit(shares, weightedReturn);

      // Profit = 100 * 0.005 = 0.5 USDC
      expect(profit).toBe(500_000n);
    });
  });

  describe('recordDeposit', () => {
    it('should record deposit and update cohort totals', async () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const deposit: DepositRecord = {
        userAddress: '0x1234567890123456789012345678901234567890',
        amount: 1_000_000_000n, // 1000 USDC
        shares: 1_000_000_000_000_000_000_000n, // 1000 shares at 1:1
        sharePrice: WAD,
        timestamp: new Date('2024-01-05'),
        transactionHash: '0xabc',
      };

      tracker.recordDeposit(deposit);

      // Get the cohort for this deposit
      const cohortId = tracker.computeCohortId(deposit.timestamp);
      const cohort = await tracker.getCohort(cohortId);

      // Check cohort exists and has correct deposits
      expect(cohort).not.toBeNull();
      expect(cohort!.totalDeposits).toBe(1_000_000_000n);
    });

    it('should aggregate multiple deposits', async () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const deposit1: DepositRecord = {
        userAddress: '0x1234567890123456789012345678901234567890',
        amount: 1_000_000_000n,
        shares: 1_000_000_000_000_000_000_000n,
        sharePrice: WAD,
        timestamp: new Date('2024-01-05'),
        transactionHash: '0xabc1',
      };

      const deposit2: DepositRecord = {
        userAddress: '0x2345678901234567890123456789012345678901',
        amount: 2_000_000_000n,
        shares: 2_000_000_000_000_000_000_000n,
        sharePrice: WAD,
        timestamp: new Date('2024-01-05'),
        transactionHash: '0xabc2',
      };

      tracker.recordDeposit(deposit1);
      tracker.recordDeposit(deposit2);

      const cohortId = tracker.computeCohortId(deposit1.timestamp);
      const cohort = await tracker.getCohort(cohortId);

      expect(cohort).not.toBeNull();
      expect(cohort!.totalDeposits).toBe(3_000_000_000n);
    });
  });

  describe('closeCohort', () => {
    it('should set end price and mark as closed', () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      // First, create a cohort by recording a deposit
      const deposit: DepositRecord = {
        userAddress: '0x1234567890123456789012345678901234567890',
        amount: 1_000_000_000n,
        shares: 1_000_000_000_000_000_000_000n,
        sharePrice: WAD,
        timestamp: new Date('2024-01-05'),
        transactionHash: '0xabc',
      };
      tracker.recordDeposit(deposit);

      const cohortId = tracker.computeCohortId(deposit.timestamp);
      const newEndPrice = (WAD * 105n) / 100n; // 5% return

      const closedCohort = tracker.closeCohort(cohortId, newEndPrice);

      expect(closedCohort).toBeDefined();
      expect(closedCohort!.endSharePrice).toBe(newEndPrice);
      expect(closedCohort!.closed).toBe(true);
    });
  });

  describe('getCurrentCohort', () => {
    it('should return cached cohort on subsequent calls', async () => {
      const mockProvider = createMockVaultStateProvider();
      const tracker = new CohortTracker(mockProvider);

      const cohort1 = await tracker.getCurrentCohort();
      const cohort2 = await tracker.getCurrentCohort();

      expect(cohort1).toBe(cohort2); // Same reference
    });

    it('should create cohort with correct structure', async () => {
      const tracker = new CohortTracker(createMockVaultStateProvider());

      const cohort = await tracker.getCurrentCohort();

      expect(cohort.id).toBeDefined();
      expect(cohort.windowStart).toBeInstanceOf(Date);
      expect(cohort.windowEnd).toBeInstanceOf(Date);
      expect(cohort.startSharePrice).toBe(WAD);
      expect(typeof cohort.closed).toBe('boolean');
    });
  });

  describe('constants', () => {
    it('should have correct WAD value', () => {
      expect(WAD).toBe(1_000_000_000_000_000_000n);
    });

    it('should have correct COHORT_WINDOW_SECONDS', () => {
      expect(COHORT_WINDOW_SECONDS).toBe(604800n); // 7 days in seconds
    });
  });
});
