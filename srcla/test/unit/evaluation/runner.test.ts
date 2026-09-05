import { describe, it, expect } from 'vitest';
import { computeSharpeFromSnapshots } from '../../../src/evaluation/metrics/statistics.js';

describe('EvaluationRunner real metrics', () => {
  describe('computeSharpeFromSnapshots', () => {
    it('should compute Sharpe from snapshot series, not stub', () => {
      // Setup: create snapshots with known returns
      const snapshots = [
        { assets: 100_000_000_000n, timestamp: new Date('2024-01-01') },
        { assets: 101_000_000_000n, timestamp: new Date('2024-01-02') }, // 1% return
        { assets: 102_000_000_000n, timestamp: new Date('2024-01-03') }, // ~1% return
      ];
      const sharpe = computeSharpeFromSnapshots(snapshots);
      expect(sharpe).toBeGreaterThan(0); // Should be non-zero
      expect(sharpe).not.toBe(Infinity);
    });

    it('should return 0 for less than 2 snapshots', () => {
      const snapshots = [{ assets: 100_000_000_000n, timestamp: new Date('2024-01-01') }];
      expect(computeSharpeFromSnapshots(snapshots)).toBe(0);
    });

    it('should return 0 for zero previous assets', () => {
      const snapshots = [
        { assets: 0n, timestamp: new Date('2024-01-01') },
        { assets: 100_000_000_000n, timestamp: new Date('2024-01-02') },
      ];
      expect(computeSharpeFromSnapshots(snapshots)).toBe(0);
    });

    it('should return 0 when std dev is 0 (no variance)', () => {
      const snapshots = [
        { assets: 100_000_000_000n, timestamp: new Date('2024-01-01') },
        { assets: 100_000_000_000n, timestamp: new Date('2024-01-02') },
        { assets: 100_000_000_000n, timestamp: new Date('2024-01-03') },
      ];
      expect(computeSharpeFromSnapshots(snapshots)).toBe(0);
    });

    it('should compute reasonable Sharpe for positive returns', () => {
      // 2% daily return with low variance
      const snapshots = [
        { assets: 100_000_000_000n, timestamp: new Date('2024-01-01') },
        { assets: 102_000_000_000n, timestamp: new Date('2024-01-02') },
        { assets: 104_040_000_000n, timestamp: new Date('2024-01-03') },
        { assets: 106_120_800_000n, timestamp: new Date('2024-01-04') },
      ];
      const sharpe = computeSharpeFromSnapshots(snapshots);
      expect(sharpe).toBeGreaterThan(0);
      expect(sharpe).toBeLessThan(50); // Should be a reasonable value
    });
  });
});
