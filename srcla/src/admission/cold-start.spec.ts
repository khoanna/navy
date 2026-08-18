import {
  checkColdStartEligibility,
  checkColdStartFromSnapshot,
  computeColdStartAllocationCap,
  daysBetween,
  DEFAULT_COLD_START_CONFIG,
  type ColdStartConfig,
} from './cold-start.js';
import type { MarketSnapshot } from '../domain/snapshots.js';

// Helper to create a mock MarketSnapshot
function createSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    marketId: 'test-market',
    blockHash: '0x123',
    timestamp: new Date(),
    totalAssetsBase: 10_000_000_000_000n,
    idleBase: 200_000_000_000n,
    supplyRateE18: 50000000000000000n,
    utilizationE18: 700000000000000000n,
    cashBase: 100_000_000_000n,
    borrowsBase: 5_000_000_000_000n,
    reservesBase: 1_000_000_000_000n,
    capBps: 10000,
    paused: false,
    configDigest: '0x456',
    ...overrides,
  };
}

describe('daysBetween', () => {
  it('should return 0 for same day', () => {
    const date = new Date('2026-08-17T12:00:00Z');
    expect(daysBetween(date, date)).toBe(0);
  });

  it('should return 1 for next day', () => {
    const start = new Date('2026-08-17T00:00:00Z');
    const end = new Date('2026-08-18T00:00:00Z');
    expect(daysBetween(start, end)).toBe(1);
  });

  it('should return 7 for one week', () => {
    const start = new Date('2026-08-10T00:00:00Z');
    const end = new Date('2026-08-17T00:00:00Z');
    expect(daysBetween(start, end)).toBe(7);
  });

  it('should handle fractional days (floors to integer)', () => {
    const start = new Date('2026-08-17T00:00:00Z');
    const end = new Date('2026-08-18T01:00:00Z'); // 1 day + 1 hour
    expect(daysBetween(start, end)).toBe(1); // Should floor to 1
  });
});

describe('checkColdStartEligibility', () => {
  const now = new Date('2026-08-17');

  describe('INSUFFICIENT_OBSERVATIONS', () => {
    it('should reject market with 0 observations', () => {
      const status = checkColdStartEligibility(
        'test-market',
        0,
        new Date('2026-08-01'),
        now
      );

      expect(status.eligible).toBe(false);
      expect(status.reason).toBe('INSUFFICIENT_OBSERVATIONS');
      expect(status.weightCap).toBe(0);
      expect(status.reserveAdjustment).toBe(1.0);
      expect(status.details).toContain('0 observations');
    });

    it('should reject market with 10 observations (below minimum of 30)', () => {
      const status = checkColdStartEligibility(
        'test-market',
        10,
        new Date('2026-08-01'),
        now
      );

      expect(status.eligible).toBe(false);
      expect(status.reason).toBe('INSUFFICIENT_OBSERVATIONS');
      expect(status.weightCap).toBe(0);
    });

    it('should reject market with exactly 29 observations', () => {
      const status = checkColdStartEligibility(
        'test-market',
        29,
        new Date('2026-08-01'),
        now
      );

      expect(status.eligible).toBe(false);
      expect(status.reason).toBe('INSUFFICIENT_OBSERVATIONS');
    });

    it('should include observation count in details', () => {
      const status = checkColdStartEligibility(
        'low-obs-market',
        15,
        new Date('2026-08-01'),
        now
      );

      expect(status.details).toContain('15');
    });
  });

  describe('COLD_START_PERIOD', () => {
    it('should allow market with sufficient observations but in cold-start period', () => {
      // 6 days ago - within cold-start period (< 7 days)
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-11'),
        now
      );

      expect(status.eligible).toBe(true);
      expect(status.reason).toBe('COLD_START_PERIOD');
      expect(status.weightCap).toBe(0.5);
      expect(status.reserveAdjustment).toBe(1.5);
    });

    it('should be in cold-start on day 1', () => {
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-16'), // 1 day ago
        now
      );

      expect(status.eligible).toBe(true);
      expect(status.reason).toBe('COLD_START_PERIOD');
      expect(status.details).toContain('6 day(s) remaining');
    });

    it('should be in cold-start on day 6', () => {
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-11'), // 6 days ago
        now
      );

      expect(status.eligible).toBe(true);
      expect(status.reason).toBe('COLD_START_PERIOD');
      expect(status.details).toContain('1 day(s) remaining');
    });

    it('should apply capacity factor of 0.5 by default', () => {
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-11'), // 6 days ago, still in cold-start
        now
      );

      expect(status.weightCap).toBe(0.5);
    });

    it('should apply reserve factor of 1.5 by default', () => {
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-11'), // 6 days ago, still in cold-start
        now
      );

      expect(status.reserveAdjustment).toBe(1.5);
    });
  });

  describe('FULL_CAPACITY', () => {
    it('should fully eligible market past cold-start (day 8)', () => {
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-09'), // 8 days ago
        now
      );

      expect(status.eligible).toBe(true);
      expect(status.reason).toBe('FULL_CAPACITY');
      expect(status.weightCap).toBe(1.0);
      expect(status.reserveAdjustment).toBe(1.0);
    });

    it('should be fully eligible on day 16 (well past cold-start)', () => {
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-01'), // 16 days ago
        now
      );

      expect(status.eligible).toBe(true);
      expect(status.reason).toBe('FULL_CAPACITY');
      expect(status.weightCap).toBe(1.0);
      expect(status.reserveAdjustment).toBe(1.0);
    });

    it('should include market ID in details', () => {
      const status = checkColdStartEligibility(
        'compound-adapter',
        30,
        new Date('2026-08-01'),
        now
      );

      expect(status.details).toContain('compound-adapter');
    });
  });

  describe('custom config', () => {
    it('should use custom minObservations', () => {
      const customConfig: ColdStartConfig = {
        ...DEFAULT_COLD_START_CONFIG,
        minObservations: 10,
      };

      // 9 observations should fail with custom config
      const status = checkColdStartEligibility(
        'test-market',
        9,
        new Date('2026-08-01'),
        now,
        customConfig
      );

      expect(status.reason).toBe('INSUFFICIENT_OBSERVATIONS');

      // 10 observations should pass with custom config
      const status2 = checkColdStartEligibility(
        'test-market',
        10,
        new Date('2026-08-01'),
        now,
        customConfig
      );

      expect(status2.eligible).toBe(true);
    });

    it('should use custom coldStartDays', () => {
      const customConfig: ColdStartConfig = {
        ...DEFAULT_COLD_START_CONFIG,
        coldStartDays: 14,
      };

      // 7 days ago - should be in cold-start with 14-day period
      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-10'), // 7 days ago
        now,
        customConfig
      );

      expect(status.reason).toBe('COLD_START_PERIOD');
      expect(status.details).toContain('7 day(s) remaining');
    });

    it('should use custom capacity and reserve factors', () => {
      const customConfig: ColdStartConfig = {
        ...DEFAULT_COLD_START_CONFIG,
        coldStartCapacityFactor: 0.25,
        coldStartReserveFactor: 2.0,
      };

      const status = checkColdStartEligibility(
        'test-market',
        30,
        new Date('2026-08-11'), // 6 days ago, still in cold-start
        now,
        customConfig
      );

      expect(status.weightCap).toBe(0.25);
      expect(status.reserveAdjustment).toBe(2.0);
    });
  });
});

describe('checkColdStartFromSnapshot', () => {
  const now = new Date('2026-08-17');

  it('should extract marketId from snapshot', () => {
    const snapshot = createSnapshot({ marketId: 'compound-v3' });
    const observations = {
      observationCount: 30,
      firstObservationDate: new Date('2026-08-01'),
    };

    const status = checkColdStartFromSnapshot(snapshot, observations, now);

    expect(status.details).toContain('compound-v3');
  });

  it('should pass through to checkColdStartEligibility', () => {
    const snapshot = createSnapshot({ marketId: 'test-market' });
    const observations = {
      observationCount: 10,
      firstObservationDate: new Date('2026-08-01'),
    };

    const status = checkColdStartFromSnapshot(snapshot, observations, now);

    expect(status.reason).toBe('INSUFFICIENT_OBSERVATIONS');
  });
});

describe('computeColdStartAllocationCap', () => {
  const now = new Date('2026-08-17');
  const totalAssets = 1_000_000_000_000_000n; // 1M USDC (6 decimals)

  it('should return 0 for ineligible market', () => {
    const cap = computeColdStartAllocationCap(
      'test-market',
      10, // insufficient
      new Date('2026-08-01'),
      now,
      totalAssets
    );

    expect(cap).toBe(0n);
  });

  it('should apply 50% weight cap during cold-start', () => {
    const cap = computeColdStartAllocationCap(
      'test-market',
      30,
      new Date('2026-08-11'), // 6 days ago, in cold-start
      now,
      totalAssets,
      10000 // 100% cap
    );

    // 50% of 1M = 500K
    expect(cap).toBe(500_000_000_000_000n);
  });

  it('should apply 100% weight cap after cold-start', () => {
    const cap = computeColdStartAllocationCap(
      'test-market',
      30,
      new Date('2026-08-01'), // past cold-start
      now,
      totalAssets,
      10000 // 100% cap
    );

    // 100% of 1M = 1M
    expect(cap).toBe(1_000_000_000_000_000n);
  });

  it('should apply both market cap and weight cap', () => {
    const cap = computeColdStartAllocationCap(
      'test-market',
      30,
      new Date('2026-08-11'), // 6 days ago, in cold-start
      now,
      totalAssets,
      5000 // 50% market cap
    );

    // Market cap: 50% of 1M = 500K
    // Weight cap: 50%
    // Final: 250K
    expect(cap).toBe(250_000_000_000_000n);
  });

  it('should default market cap to 100%', () => {
    const cap = computeColdStartAllocationCap(
      'test-market',
      30,
      new Date('2026-08-01'),
      now,
      totalAssets
    );

    // 100% of 1M = 1M (no cold-start reduction needed)
    expect(cap).toBe(1_000_000_000_000_000n);
  });
});

describe('edge cases', () => {
  const now = new Date('2026-08-17');

  it('should handle future first observation date', () => {
    const future = new Date('2026-08-20');
    const status = checkColdStartEligibility(
      'test-market',
      30,
      future,
      now
    );

    // Days since first obs would be negative, still in cold-start
    expect(status.reason).toBe('COLD_START_PERIOD');
  });

  it('should handle market at exact cold-start boundary (7 days)', () => {
    // Exactly 7 days ago - at boundary
    const sevenDaysAgo = new Date('2026-08-10T00:00:00Z');
    const status = checkColdStartEligibility(
      'test-market',
      30,
      sevenDaysAgo,
      now
    );

    // 7 - 7 = 0, which is NOT < 7, so should be FULL_CAPACITY
    expect(status.reason).toBe('FULL_CAPACITY');
  });

  it('should handle market at day 6 of cold-start', () => {
    const sixDaysAgo = new Date('2026-08-11T00:00:00Z');
    const status = checkColdStartEligibility(
      'test-market',
      30,
      sixDaysAgo,
      now
    );

    // 7 - 6 = 1, which IS < 7, so should be in cold-start
    expect(status.reason).toBe('COLD_START_PERIOD');
  });

  it('should handle exactly minObservations', () => {
    const status = checkColdStartEligibility(
      'test-market',
      30, // exactly min
      new Date('2026-08-01'),
      now
    );

    // 30 >= 30, so passes observation check
    expect(status.eligible).toBe(true);
  });
});
