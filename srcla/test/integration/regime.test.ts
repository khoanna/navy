/**
 * Regime Integration Tests
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { RegimeTracker } from '../../src/regime/regime-tracker.js';
import { RegimeState } from '../../src/regime/types.js';
import { WAD, RAY } from '../../src/protocols/math.js';

describe('RegimeTracker', () => {
  let tracker: RegimeTracker;

  beforeEach(() => {
    tracker = new RegimeTracker();
  });

  describe('registerMarket', () => {
    it('should register a new market', () => {
      tracker.registerMarket('aave', '0x1234', '0xabcd');

      const state = tracker.getRegimeState('aave');
      expect(state).toBe(RegimeState.VOLATILE);
    });

    it('should detect config change and start new regime', () => {
      tracker.registerMarket('compound', '0x1234', '0xabcd');
      tracker.registerMarket('compound', '0x5678', '0xefgh');

      const config = tracker.getRegimeConfig('compound');
      expect(config?.configDigest).toBe('0x5678');
      expect(config?.currentState).toBe(RegimeState.VOLATILE);
    });
  });

  describe('getColdStartStatus', () => {
    it('should return cold start status for new market', () => {
      tracker.registerMarket('moonwell', '0x1234', '0xabcd');

      const status = tracker.getColdStartStatus('moonwell');
      expect(status.isColdStart).toBe(true);
      expect(status.daysActive).toBe(0);
      expect(status.reducedCapacityFactor).toBe(50);
      expect(status.increasedReserveFactor).toBe(150);
    });
  });

  describe('isEligible', () => {
    it('should return false for new market in cold start', () => {
      tracker.registerMarket('aave', '0x1234', '0xabcd');

      expect(tracker.isEligible('aave')).toBe(false);
    });
  });

  describe('getEffectiveCapacity', () => {
    it('should apply reduced capacity during cold start', () => {
      tracker.registerMarket('aave', '0x1234', '0xabcd');

      const normalCapacity = 1_000_000_000_000n; // 1M USDC
      const effectiveCapacity = tracker.getEffectiveCapacity('aave', normalCapacity);

      // 50% of normal capacity during cold start
      expect(effectiveCapacity).toBe(500_000_000_000n);
    });
  });

  describe('updateMetrics', () => {
    it('should not transition during cold start', () => {
      tracker.registerMarket('aave', '0x1234', '0xabcd');

      const result = tracker.updateMetrics({
        marketId: 'aave',
        supplyRateE18: 50_000_000_000_000_000n, // 5%
        utilizationE18: (80n * RAY) / 100n, // 80%
        volatilityE18: (5n * WAD) / 100n, // 5%
        configDigest: '0x1234',
        blockHash: '0xabcd',
        timestamp: new Date(),
      });

      // Should return current state, not transition
      expect(result).toBe(RegimeState.VOLATILE);
    });
  });

  describe('getSummary', () => {
    it('should return correct summary statistics', () => {
      tracker.registerMarket('aave', '0x1234', '0xabcd');
      tracker.registerMarket('compound', '0x5678', '0xefgh');

      const summary = tracker.getSummary();

      expect(summary.totalMarkets).toBe(2);
      expect(summary.inColdStart).toBe(2);
      expect(summary.eligible).toBe(0);
      expect(summary.ineligible).toBe(2);
      expect(summary.byState[RegimeState.VOLATILE]).toBe(2);
    });
  });

  describe('getMarketsByState', () => {
    it('should return markets by state', () => {
      tracker.registerMarket('aave', '0x1234', '0xabcd');
      tracker.registerMarket('compound', '0x5678', '0xefgh');

      const volatileMarkets = tracker.getMarketsByState(RegimeState.VOLATILE);

      expect(volatileMarkets).toContain('aave');
      expect(volatileMarkets).toContain('compound');
      expect(volatileMarkets.length).toBe(2);
    });
  });
});
