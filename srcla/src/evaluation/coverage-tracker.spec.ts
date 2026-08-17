/**
 * Coverage Tracker Tests
 */

import {
  CoverageTracker,
  fromExported,
  DEFAULT_COVERAGE_CONFIG,
  type CoverageRecord,
} from './coverage-tracker.js';
import { WAD } from '../protocols/math.js';

describe('CoverageTracker', () => {
  let tracker: CoverageTracker;

  beforeEach(() => {
    tracker = new CoverageTracker();
  });

  describe('recordOutcome', () => {
    it('should record a covered forecast', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      const lowerBound = WAD; // 1 WAD = 100% return
      const actualReturn = WAD + 10_000_000_000_000_000n; // +10% above lower

      tracker.recordOutcome('compound', timestamp, lowerBound, actualReturn, 86400);

      expect(tracker.getRecordCount('compound')).toBe(1);
      expect(tracker.getMarketIds()).toContain('compound');
    });

    it('should record an uncovered forecast', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      const lowerBound = WAD + 50_000_000_000_000_000n; // +50% lower bound
      const actualReturn = WAD + 20_000_000_000_000_000n; // +20% actual (below bound)

      tracker.recordOutcome('compound', timestamp, lowerBound, actualReturn, 86400);

      const records = tracker.export().get('compound')!;
      expect(records[0]!.covered).toBe(false);
      expect(records[0]!.shortfall).toBe(30_000_000_000_000_000n);
    });

    it('should handle exact boundary coverage', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      const bound = 100_000_000_000_000_000n; // 100% return

      tracker.recordOutcome('compound', timestamp, bound, bound, 86400);

      const records = tracker.export().get('compound')!;
      expect(records[0]!.covered).toBe(true);
      expect(records[0]!.shortfall).toBeNull();
    });

    it('should support multiple markets', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');

      tracker.recordOutcome('compound', timestamp, WAD, WAD, 86400);
      tracker.recordOutcome('aave', timestamp, WAD, WAD, 86400);
      tracker.recordOutcome('morpho', timestamp, WAD, WAD, 86400);

      expect(tracker.getMarketIds()).toHaveLength(3);
      expect(tracker.getRecordCount()).toBe(3);
    });
  });

  describe('calculateCoverage', () => {
    it('should return zero coverage for empty market', () => {
      const metrics = tracker.calculateCoverage('unknown');
      expect(metrics.totalRecords).toBe(0);
      expect(metrics.coverage).toBe(0);
      expect(metrics.exceedsTarget).toBe(false);
    });

    it('should calculate 100% coverage when all covered', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      for (let i = 0; i < 10; i++) {
        // All covered: actual >= lower
        tracker.recordOutcome('compound', timestamp, WAD, WAD + 10_000_000_000_000_000n, 86400);
      }

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.coverage).toBe(1);
      expect(metrics.coveredRecords).toBe(10);
      expect(metrics.totalRecords).toBe(10);
    });

    it('should calculate partial coverage', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      // 7 covered, 3 uncovered
      for (let i = 0; i < 7; i++) {
        tracker.recordOutcome('compound', timestamp, WAD, WAD + 10_000_000_000_000_000n, 86400);
      }
      for (let i = 0; i < 3; i++) {
        tracker.recordOutcome('compound', timestamp, WAD + 50_000_000_000_000_000n, WAD, 86400);
      }

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.coverage).toBeCloseTo(0.7, 1);
      expect(metrics.coveredRecords).toBe(7);
      expect(metrics.totalRecords).toBe(10);
    });

    it('should calculate shortfall statistics', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      // Record uncovered forecasts with known shortfalls
      tracker.recordOutcome('compound', timestamp, WAD + 10n, WAD, 86400); // shortfall: 10
      tracker.recordOutcome('compound', timestamp, WAD + 50n, WAD, 86400); // shortfall: 50
      tracker.recordOutcome('compound', timestamp, WAD + 30n, WAD, 86400); // shortfall: 30

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.maxShortfall).toBe(50n);
      // Average shortfall in WAD units
      expect(metrics.averageShortfall).toBe(30n); // (10 + 50 + 30) / 3
    });

    it('should filter by window days', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago (outside 7-day window)
      const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago (inside 7-day window)

      // Old record (not covered)
      tracker.recordOutcome('compound', oldDate, WAD + 100n, WAD, 86400);
      // Recent records (all covered)
      tracker.recordOutcome('compound', recentDate, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('compound', recentDate, WAD, WAD + 10n, 86400);

      // 7-day window should only include recent records (oldDate is 10 days ago)
      const allMetrics = tracker.calculateCoverage('compound', 7);
      expect(allMetrics.totalRecords).toBe(2);

      // 3-day window should also include recent records
      const recentMetrics = tracker.calculateCoverage('compound', 3);
      expect(recentMetrics.totalRecords).toBe(2);
      expect(recentMetrics.coverage).toBe(1);
    });

    it('should check exceedsTarget against config', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      // 96% coverage - should not exceed 95% target
      for (let i = 0; i < 96; i++) {
        tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      }
      for (let i = 0; i < 4; i++) {
        tracker.recordOutcome('compound', timestamp, WAD + 100n, WAD, 86400);
      }

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.coverage).toBeCloseTo(0.96, 2);
      expect(metrics.exceedsTarget).toBe(true);
    });

    it('should respect custom target coverage', () => {
      const trackerCustom = new CoverageTracker({ targetCoverage: 0.99 });
      const timestamp = new Date('2026-01-01T00:00:00Z');

      // 96% coverage
      for (let i = 0; i < 96; i++) {
        trackerCustom.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      }
      for (let i = 0; i < 4; i++) {
        trackerCustom.recordOutcome('compound', timestamp, WAD + 100n, WAD, 86400);
      }

      const metrics = trackerCustom.calculateCoverage('compound');
      expect(metrics.exceedsTarget).toBe(false);
    });
  });

  describe('calculateOverallCoverage', () => {
    it('should aggregate across multiple markets', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');

      // Compound: 8 covered, 2 uncovered
      for (let i = 0; i < 8; i++) {
        tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      }
      for (let i = 0; i < 2; i++) {
        tracker.recordOutcome('compound', timestamp, WAD + 100n, WAD, 86400);
      }

      // Aave: 9 covered, 1 uncovered
      for (let i = 0; i < 9; i++) {
        tracker.recordOutcome('aave', timestamp, WAD, WAD + 10n, 86400);
      }
      for (let i = 0; i < 1; i++) {
        tracker.recordOutcome('aave', timestamp, WAD + 100n, WAD, 86400);
      }

      const metrics = tracker.calculateOverallCoverage();
      // Total: 20 records, 17 covered = 85%
      expect(metrics.totalRecords).toBe(20);
      expect(metrics.coveredRecords).toBe(17);
      expect(metrics.coverage).toBeCloseTo(0.85, 2);
    });
  });

  describe('generateCoverageReport', () => {
    it('should generate complete report', () => {
      const timestamp1 = new Date('2026-01-01T00:00:00Z');
      const timestamp2 = new Date('2026-01-02T00:00:00Z');

      tracker.recordOutcome('compound', timestamp1, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('compound', timestamp2, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('aave', timestamp1, WAD, WAD + 10n, 604800);

      const report = tracker.generateCoverageReport();

      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.overallMetrics.totalRecords).toBe(3);
      expect(report.marketMetrics.size).toBe(2);
      expect(report.marketMetrics.has('compound')).toBe(true);
      expect(report.marketMetrics.has('aave')).toBe(true);
      expect(report.horizons).toContain(86400);
      expect(report.horizons).toContain(604800);
      expect(report.targetCoverage).toBe(DEFAULT_COVERAGE_CONFIG.targetCoverage);
      expect(report.timeRange).not.toBeNull();
      expect(report.timeRange?.start).toEqual(timestamp1);
      expect(report.timeRange?.end).toEqual(timestamp2);
    });

    it('should handle empty tracker', () => {
      const report = tracker.generateCoverageReport();
      expect(report.overallMetrics.totalRecords).toBe(0);
      expect(report.marketMetrics.size).toBe(0);
      expect(report.timeRange).toBeNull();
    });

    it('should apply window filter to report', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      tracker.recordOutcome('compound', oldDate, WAD, WAD - 10n, 86400);
      tracker.recordOutcome('compound', recentDate, WAD, WAD + 10n, 86400);

      const report = tracker.generateCoverageReport(7);
      expect(report.overallMetrics.totalRecords).toBe(1);
    });
  });

  describe('export/import', () => {
    it('should export all records', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('aave', timestamp, WAD, WAD + 10n, 604800);

      const exported = tracker.export();

      expect(exported.size).toBe(2);
      expect(exported.get('compound')!).toHaveLength(1);
      expect(exported.get('aave')!).toHaveLength(1);
    });

    it('should import records into new tracker', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);

      const exported = tracker.export();

      const newTracker = new CoverageTracker();
      newTracker.import(exported);

      expect(newTracker.getRecordCount('compound')).toBe(1);
    });

    it('should merge imported records with existing', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);

      const newRecords: Map<string, CoverageRecord[]> = new Map();
      newRecords.set('compound', [
        { marketId: 'compound', timestamp, lowerBound: WAD, actualReturn: WAD + 20n, covered: true, horizon: 86400, shortfall: null },
      ]);
      newRecords.set('aave', [
        { marketId: 'aave', timestamp, lowerBound: WAD, actualReturn: WAD + 30n, covered: true, horizon: 604800, shortfall: null },
      ]);

      tracker.import(newRecords);

      expect(tracker.getRecordCount('compound')).toBe(2);
      expect(tracker.getRecordCount('aave')).toBe(1);
    });

    it('should create tracker from exported data', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);

      const exported = tracker.export();
      const restored = fromExported(exported);

      expect(restored.getRecordCount('compound')).toBe(1);
    });

    it('should preserve coverage calculations after export/import', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      for (let i = 0; i < 10; i++) {
        tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      }

      const originalMetrics = tracker.calculateCoverage('compound');
      const exported = tracker.export();

      const newTracker = new CoverageTracker();
      newTracker.import(exported);
      const restoredMetrics = newTracker.calculateCoverage('compound');

      expect(restoredMetrics.coverage).toBe(originalMetrics.coverage);
      expect(restoredMetrics.totalRecords).toBe(originalMetrics.totalRecords);
    });
  });

  describe('clear', () => {
    it('should clear all records', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('aave', timestamp, WAD, WAD + 10n, 86400);

      tracker.clear();

      expect(tracker.getRecordCount()).toBe(0);
      expect(tracker.getMarketIds()).toHaveLength(0);
    });

    it('should clear specific market', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('aave', timestamp, WAD, WAD + 10n, 86400);

      tracker.clear('compound');

      expect(tracker.getRecordCount('compound')).toBe(0);
      expect(tracker.getRecordCount('aave')).toBe(1);
    });
  });

  describe('getRecordCount', () => {
    it('should return count for specific market', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('aave', timestamp, WAD, WAD + 10n, 86400);

      expect(tracker.getRecordCount('compound')).toBe(2);
      expect(tracker.getRecordCount('aave')).toBe(1);
    });

    it('should return total count when no market specified', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('aave', timestamp, WAD, WAD + 10n, 86400);

      expect(tracker.getRecordCount()).toBe(2);
    });
  });

  describe('getMarketIds', () => {
    it('should return all market IDs', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('aave', timestamp, WAD, WAD + 10n, 86400);
      tracker.recordOutcome('morpho', timestamp, WAD, WAD + 10n, 86400);

      const ids = tracker.getMarketIds();
      expect(ids).toContain('compound');
      expect(ids).toContain('aave');
      expect(ids).toContain('morpho');
    });

    it('should return empty array for empty tracker', () => {
      expect(tracker.getMarketIds()).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle negative returns', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      // Both are negative returns but actual > lower, so covered
      const lowerBound = WAD - 20_000_000_000_000_000n; // -20% lower bound
      const actualReturn = WAD - 10_000_000_000_000_000n; // -10% actual (covered because -10% > -20%)

      tracker.recordOutcome('compound', timestamp, lowerBound, actualReturn, 86400);

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.coveredRecords).toBe(1);
    });

    it('should handle zero WAD values', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      tracker.recordOutcome('compound', timestamp, 0n, 0n, 86400);

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.coveredRecords).toBe(1);
    });

    it('should handle very large shortfall', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');
      const lowerBound = WAD * 1000n; // 1000 WAD = huge
      const actualReturn = WAD; // Just 1 WAD

      tracker.recordOutcome('compound', timestamp, lowerBound, actualReturn, 86400);

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.maxShortfall).toBe(lowerBound - actualReturn);
    });
  });

  describe('integration with forecast calibration', () => {
    it('should track coverage from calibration results', () => {
      const timestamp = new Date('2026-01-01T00:00:00Z');

      // Simulate calibration results: lower bound forecasts
      // Coverage: actual >= lower bound
      const lowerBounds = [
        50_000_000_000_000_000n, // lower: 50%
        55_000_000_000_000_000n, // lower: 55%
        48_000_000_000_000_000n, // lower: 48%
        52_000_000_000_000_000n, // lower: 52%
        51_000_000_000_000_000n, // lower: 51%
      ];

      // Realized returns (compared to lower bounds above)
      // Index 0: 53 >= 50 -> covered
      // Index 1: 54 < 55 -> NOT covered
      // Index 2: 45 < 48 -> NOT covered
      // Index 3: 56 >= 52 -> covered
      // Index 4: 50 < 51 -> NOT covered
      const realized = [
        53_000_000_000_000_000n, // covered (53 >= 50)
        54_000_000_000_000_000n, // NOT covered (54 < 55)
        45_000_000_000_000_000n, // NOT covered (45 < 48)
        56_000_000_000_000_000n, // covered (56 >= 52)
        50_000_000_000_000_000n, // NOT covered (50 < 51)
      ];

      for (let i = 0; i < lowerBounds.length; i++) {
        tracker.recordOutcome('compound', timestamp, lowerBounds[i]!, realized[i]!, 86400);
      }

      const metrics = tracker.calculateCoverage('compound');
      expect(metrics.totalRecords).toBe(5);
      expect(metrics.coveredRecords).toBe(2);
      expect(metrics.coverage).toBeCloseTo(0.4, 1);
    });
  });
});
