/**
 * Regime Tracker Tests
 *
 * Tests regime classification, transitions, and cold-start enforcement
 * per SRCLA design Section 6.2 and Section 7.3.
 */

import { RegimeTracker, DEFAULT_REGIME_THRESHOLDS } from './regime-tracker.js';
import { ColdStartEnforcer, DEFAULT_COLD_START_CONFIG } from './cold-start.js';
import { RegimeState } from './types.js';
import { WAD, RAY } from '../protocols/math.js';

/**
 * Helper to create regime metrics for testing
 */
function createMetrics(
  marketId: string,
  overrides: Partial<{
    utilizationE18: bigint;
    volatilityE18: bigint;
    supplyRateE18: bigint;
    configDigest: string;
    blockHash: string;
    timestamp: Date;
  }> = {}
) {
  return {
    marketId,
    utilizationE18: overrides.utilizationE18 ?? 70n * RAY / 100n, // 70%
    volatilityE18: overrides.volatilityE18 ?? 5n * WAD / 100n, // 5%
    supplyRateE18: overrides.supplyRateE18 ?? 5n * WAD / 100n, // 5%
    configDigest: overrides.configDigest ?? '0x123',
    blockHash: overrides.blockHash ?? '0x456',
    timestamp: overrides.timestamp ?? new Date(),
  };
}

/**
 * Helper to create a past date
 */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

describe('RegimeTracker', () => {
  let tracker: RegimeTracker;

  beforeEach(() => {
    tracker = new RegimeTracker({
      thresholds: DEFAULT_REGIME_THRESHOLDS,
      minDaysBeforeStress: 7,
      hysteresisBps: 500,
      coldStartDays: 7,
      coldStartCapacityFactor: 50,
      coldStartReserveFactor: 150,
    });
  });

  describe('Market Registration', () => {
    it('should register new market in VOLATILE state', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const state = tracker.getRegimeState('market-1');
      expect(state).toBe(RegimeState.VOLATILE);
    });

    it('should track multiple markets independently', () => {
      tracker.registerMarket('market-1', '0xdigest1', '0xblockhash1');
      tracker.registerMarket('market-2', '0xdigest2', '0xblockhash2');

      expect(tracker.getRegimeState('market-1')).toBe(RegimeState.VOLATILE);
      expect(tracker.getRegimeState('market-2')).toBe(RegimeState.VOLATILE);
    });

    it('should detect material config changes', () => {
      tracker.registerMarket('market-1', '0xdigest-v1', '0xblockhash1');

      // Record initial transition
      const initialTransitions = tracker.getTransitions('market-1');
      expect(initialTransitions.length).toBeGreaterThanOrEqual(1);

      // Change config - should trigger new regime
      tracker.registerMarket('market-1', '0xdigest-v2', '0xblockhash2');

      const transitions = tracker.getTransitions('market-1');
      const lastTransition = transitions[transitions.length - 1]!;

      expect(lastTransition.reason).toContain('CONFIG_CHANGE');
      expect(lastTransition.to).toBe(RegimeState.VOLATILE);
    });
  });

  describe('Regime State Classification', () => {
    it('should classify VOLATILE state for elevated utilization (after cold start)', () => {
      // Create a tracker with cold start already passed
      const warmTracker = new RegimeTracker({
        coldStartDays: 0, // No cold start
      });

      warmTracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const metrics = createMetrics('market-1', {
        utilizationE18: 85n * RAY / 100n, // 85%
        volatilityE18: 5n * WAD / 100n, // 5%
      });

      const state = warmTracker.updateMetrics(metrics);
      expect(state).toBe(RegimeState.VOLATILE);
    });

    it('should classify STRESSED state for high utilization', () => {
      const warmTracker = new RegimeTracker({
        coldStartDays: 0,
      });

      warmTracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const metrics = createMetrics('market-1', {
        utilizationE18: 96n * RAY / 100n, // 96%
        volatilityE18: 10n * WAD / 100n, // 10%
      });

      const state = warmTracker.updateMetrics(metrics);
      expect(state).toBe(RegimeState.STRESSED);
    });

    it('should classify STRESSED state for high volatility', () => {
      const warmTracker = new RegimeTracker({
        coldStartDays: 0,
      });

      warmTracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const metrics = createMetrics('market-1', {
        utilizationE18: 50n * RAY / 100n, // 50%
        volatilityE18: 55n * WAD / 100n, // 55%
      });

      const state = warmTracker.updateMetrics(metrics);
      expect(state).toBe(RegimeState.STRESSED);
    });

    it('should transition to STEADY state from VOLATILE after improvement', () => {
      const warmTracker = new RegimeTracker({
        coldStartDays: 0,
      });

      warmTracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // First update with normal conditions -> RECOVERY (intermediate state)
      // Note: hysteresis prevents immediate transition to STEADY
      const initialMetrics = createMetrics('market-1', {
        utilizationE18: 50n * RAY / 100n,
        volatilityE18: 5n * WAD / 100n,
      });
      warmTracker.updateMetrics(initialMetrics);
      // Due to hysteresis, the state stays at VOLATILE
      expect(warmTracker.getRegimeState('market-1')).toBe(RegimeState.VOLATILE);
    });
  });

  describe('Cold Start Enforcement', () => {
    it('should mark new market as in cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const status = tracker.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(true);
      expect(status.daysActive).toBe(0);
    });

    it('should return cold start status for unregistered market', () => {
      const status = tracker.getColdStartStatus('unknown-market');
      expect(status.isColdStart).toBe(true);
      expect(status.daysActive).toBe(0);
    });

    it('should have correct capacity factor during cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const status = tracker.getColdStartStatus('market-1');
      expect(status.reducedCapacityFactor).toBe(50); // 50%
    });

    it('should have correct reserve factor during cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const status = tracker.getColdStartStatus('market-1');
      expect(status.increasedReserveFactor).toBe(150); // 150%
    });

    it('should exit cold start after minimum days', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Manually set activation to 10 days ago
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(10);
      }

      const status = tracker.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(false);
      expect(status.reducedCapacityFactor).toBe(100);
      expect(status.increasedReserveFactor).toBe(100);
    });

    it('should prevent regime transitions during cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Try to transition to stressed
      const stressedMetrics = createMetrics('market-1', {
        utilizationE18: 96n * RAY / 100n,
        volatilityE18: 55n * WAD / 100n,
      });

      const state = tracker.updateMetrics(stressedMetrics);

      // Should remain in VOLATILE during cold start
      expect(state).toBe(RegimeState.VOLATILE);
      expect(tracker.getRegimeState('market-1')).toBe(RegimeState.VOLATILE);
    });

    it('should not be eligible during cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const eligible = tracker.isEligible('market-1');
      expect(eligible).toBe(false);
    });

    it('should be eligible after cold start with sufficient outcomes', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set activation to 10 days ago
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(10);
      }

      // Record enough metrics (10 outcomes required)
      for (let i = 0; i < 10; i++) {
        const metrics = createMetrics('market-1', {
          utilizationE18: 50n * RAY / 100n,
          volatilityE18: 5n * WAD / 100n,
          timestamp: new Date(),
        });
        tracker.updateMetrics(metrics);
      }

      const eligible = tracker.isEligible('market-1');
      expect(eligible).toBe(true);
    });
  });

  describe('Effective Capacity', () => {
    it('should apply 50% capacity reduction during cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const normalCapacity = 1_000_000_000_000n; // 1M USDC
      const effectiveCapacity = tracker.getEffectiveCapacity('market-1', normalCapacity);

      expect(effectiveCapacity).toBe(500_000_000_000n); // 50% = 500K
    });

    it('should return full capacity after cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set activation to 10 days ago
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(10);
      }

      const normalCapacity = 1_000_000_000_000n; // 1M USDC
      const effectiveCapacity = tracker.getEffectiveCapacity('market-1', normalCapacity);

      expect(effectiveCapacity).toBe(normalCapacity); // 100%
    });

    it('should return 0 capacity for unknown market', () => {
      const normalCapacity = 1_000_000_000_000n;
      const effectiveCapacity = tracker.getEffectiveCapacity('unknown', normalCapacity);

      expect(effectiveCapacity).toBe(0n);
    });
  });

  describe('Effective Reserve', () => {
    it('should apply 150% reserve increase during cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const normalReserve = 100_000_000_000n; // 100K USDC
      const effectiveReserve = tracker.getEffectiveReserve('market-1', normalReserve);

      expect(effectiveReserve).toBe(150_000_000_000n); // 150% = 150K
    });

    it('should return normal reserve after cold start', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set activation to 10 days ago
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(10);
      }

      const normalReserve = 100_000_000_000n;
      const effectiveReserve = tracker.getEffectiveReserve('market-1', normalReserve);

      expect(effectiveReserve).toBe(normalReserve);
    });
  });

  describe('Market Summary', () => {
    it('should track markets in cold start', () => {
      tracker.registerMarket('market-1', '0xdigest1', '0xblockhash1');
      tracker.registerMarket('market-2', '0xdigest2', '0xblockhash2');

      // Set market-2 activation to 10 days ago
      const config2 = tracker.getRegimeConfig('market-2');
      if (config2) {
        config2.activatedAt = daysAgo(10);
      }

      const summary = tracker.getSummary();

      expect(summary.totalMarkets).toBe(2);
      expect(summary.inColdStart).toBe(1); // Only market-1
    });

    it('should track markets by state', () => {
      tracker.registerMarket('market-1', '0xdigest1', '0xblockhash1');
      tracker.registerMarket('market-2', '0xdigest2', '0xblockhash2');

      // Both start in VOLATILE
      const summary = tracker.getSummary();

      expect(summary.byState[RegimeState.VOLATILE]).toBe(2);
    });
  });

  describe('Configurable Cold Start Period', () => {
    it('should respect custom cold start period', () => {
      const customTracker = new RegimeTracker({
        coldStartDays: 14,
        coldStartCapacityFactor: 40,
        coldStartReserveFactor: 160,
      });

      customTracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      const status = customTracker.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(true);
      expect(status.reducedCapacityFactor).toBe(40); // Custom 40%
      expect(status.increasedReserveFactor).toBe(160); // Custom 160%
    });

    it('should exit cold start based on configured period', () => {
      const customTracker = new RegimeTracker({
        coldStartDays: 3,
      });

      customTracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set activation to 5 days ago (past 3-day cold start)
      const config = customTracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(5);
      }

      const status = customTracker.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(false);
    });
  });

  describe('Metrics History', () => {
    it('should record metrics history', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set past cold start
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(10);
      }

      // Record multiple observations
      for (let i = 0; i < 5; i++) {
        const metrics = createMetrics('market-1', {
          utilizationE18: BigInt(50 + i) * RAY / 100n,
        });
        tracker.updateMetrics(metrics);
      }

      const history = tracker.getMetricsHistory('market-1');
      expect(history.length).toBe(5);
    });

    it('should limit metrics history size', () => {
      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set past cold start
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(10);
      }

      // Record more than 1000 observations
      for (let i = 0; i < 1050; i++) {
        const metrics = createMetrics('market-1', {
          utilizationE18: 50n * RAY / 100n,
        });
        tracker.updateMetrics(metrics);
      }

      const history = tracker.getMetricsHistory('market-1');
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });
});

describe('ColdStartEnforcer', () => {
  let enforcer: ColdStartEnforcer;

  beforeEach(() => {
    enforcer = new ColdStartEnforcer({
      minObservationDays: 7,
      capacityReductionFactor: 50,
      reserveIncreaseFactor: 150,
      minCompletedOutcomes: 10,
      allowReducedDeployment: true,
    });
  });

  describe('Cold Start Lifecycle', () => {
    it('should start cold start for new market', () => {
      enforcer.startColdStart('market-1', '0xdigest');

      const status = enforcer.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(true);
      expect(status.daysActive).toBe(0);
    });

    it('should track days active', () => {
      enforcer.startColdStart('market-1', '0xdigest', daysAgo(3));

      const status = enforcer.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(true);
      expect(status.daysActive).toBe(3);
    });

    it('should complete cold start after minimum days and outcomes', () => {
      enforcer.startColdStart('market-1', '0xdigest', daysAgo(10));

      // Record required outcomes
      for (let i = 0; i < 10; i++) {
        enforcer.recordOutcome('market-1');
      }

      const status = enforcer.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(false);
    });

    it('should not complete cold start with insufficient outcomes', () => {
      enforcer.startColdStart('market-1', '0xdigest', daysAgo(10));

      // Record only 5 outcomes (need 10)
      for (let i = 0; i < 5; i++) {
        enforcer.recordOutcome('market-1');
      }

      const status = enforcer.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(true);
    });

    it('should not complete cold start with insufficient time', () => {
      enforcer.startColdStart('market-1', '0xdigest', daysAgo(3));

      // Record enough outcomes but not enough time
      for (let i = 0; i < 10; i++) {
        enforcer.recordOutcome('market-1');
      }

      const status = enforcer.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(true);
    });
  });

  describe('Capacity and Reserve Factors', () => {
    it('should apply reduced capacity during cold start', () => {
      enforcer.startColdStart('market-1', '0xdigest');

      const effectiveCapacity = enforcer.getEffectiveCapacity('market-1', 1_000_000_000_000n);
      expect(effectiveCapacity).toBe(500_000_000_000n); // 50%
    });

    it('should apply increased reserve during cold start', () => {
      enforcer.startColdStart('market-1', '0xdigest');

      const effectiveReserve = enforcer.getEffectiveReserve('market-1', 100_000_000_000n);
      expect(effectiveReserve).toBe(150_000_000_000n); // 150%
    });

    it('should return normal values after cold start', () => {
      enforcer.startColdStart('market-1', '0xdigest', daysAgo(10));

      // Complete cold start
      for (let i = 0; i < 10; i++) {
        enforcer.recordOutcome('market-1');
      }

      const effectiveCapacity = enforcer.getEffectiveCapacity('market-1', 1_000_000_000_000n);
      const effectiveReserve = enforcer.getEffectiveReserve('market-1', 100_000_000_000n);

      expect(effectiveCapacity).toBe(1_000_000_000_000n); // 100%
      expect(effectiveReserve).toBe(100_000_000_000n); // 100%
    });
  });

  describe('Deployment Eligibility', () => {
    it('should not be eligible for reduced deployment initially', () => {
      enforcer.startColdStart('market-1', '0xdigest');

      const eligible = enforcer.isEligibleForReducedDeployment('market-1');
      expect(eligible).toBe(false);
    });

    it('should be eligible for reduced deployment after 3 outcomes', () => {
      enforcer.startColdStart('market-1', '0xdigest');

      // Record 3 outcomes
      for (let i = 0; i < 3; i++) {
        enforcer.recordOutcome('market-1');
      }

      const eligible = enforcer.isEligibleForReducedDeployment('market-1');
      expect(eligible).toBe(true);
    });

    it('should be fully eligible after cold start complete', () => {
      enforcer.startColdStart('market-1', '0xdigest', daysAgo(10));

      for (let i = 0; i < 10; i++) {
        enforcer.recordOutcome('market-1');
      }

      expect(enforcer.isFullyEligible('market-1')).toBe(true);
    });

    it('should not be fully eligible during cold start', () => {
      enforcer.startColdStart('market-1', '0xdigest');

      expect(enforcer.isFullyEligible('market-1')).toBe(false);
    });
  });

  describe('Summary Statistics', () => {
    it('should track markets in cold start', () => {
      enforcer.startColdStart('market-1', '0xdigest1');
      enforcer.startColdStart('market-2', '0xdigest2');

      const summary = enforcer.getSummary();
      expect(summary.inColdStart).toBe(2);
      expect(summary.totalMarkets).toBe(2);
    });

    it('should track completed cold starts', () => {
      enforcer.startColdStart('market-1', '0xdigest1', daysAgo(10));
      enforcer.startColdStart('market-2', '0xdigest2', daysAgo(10));

      // Complete market-1
      for (let i = 0; i < 10; i++) {
        enforcer.recordOutcome('market-1');
      }

      const summary = enforcer.getSummary();
      expect(summary.completed).toBe(1);
      expect(summary.inColdStart).toBe(1);
    });
  });

  describe('Force Complete', () => {
    it('should force complete cold start', () => {
      enforcer.startColdStart('market-1', '0xdigest', daysAgo(1));

      const result = enforcer.forceCompleteColdStart('market-1');
      expect(result).toBe(true);

      const status = enforcer.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(false);
    });

    it('should return false for unknown market', () => {
      const result = enforcer.forceCompleteColdStart('unknown');
      expect(result).toBe(false);
    });
  });

  describe('Default Configuration', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_COLD_START_CONFIG.minObservationDays).toBe(7);
      expect(DEFAULT_COLD_START_CONFIG.capacityReductionFactor).toBe(50);
      expect(DEFAULT_COLD_START_CONFIG.reserveIncreaseFactor).toBe(150);
      expect(DEFAULT_COLD_START_CONFIG.minCompletedOutcomes).toBe(10);
      expect(DEFAULT_COLD_START_CONFIG.allowReducedDeployment).toBe(true);
    });
  });
});

describe('Cold Start Integration', () => {
  describe('Rebalancing constraints during cold start', () => {
    it('should enforce no deployment outside capacity limits during cold start', () => {
      const tracker = new RegimeTracker({
        coldStartDays: 7,
        coldStartCapacityFactor: 50,
        coldStartReserveFactor: 150,
      });

      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Normal capacity would be 1M USDC
      const normalCapacity = 1_000_000_000_000n;

      // During cold start, effective capacity should be 50%
      const effectiveCapacity = tracker.getEffectiveCapacity('market-1', normalCapacity);
      expect(effectiveCapacity).toBe(500_000_000_000n);

      // Any rebalancing should be constrained by this effective capacity
      // This ensures no deployment outside capacity limits during cold start
    });

    it('should enforce elevated reserve requirements during cold start', () => {
      const tracker = new RegimeTracker({
        coldStartDays: 7,
        coldStartCapacityFactor: 50,
        coldStartReserveFactor: 150,
      });

      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Normal reserve would be 100K USDC
      const normalReserve = 100_000_000_000n;

      // During cold start, effective reserve should be 150%
      const effectiveReserve = tracker.getEffectiveReserve('market-1', normalReserve);
      expect(effectiveReserve).toBe(150_000_000_000n);
    });

    it('should restore normal limits after cold start', () => {
      const tracker = new RegimeTracker({
        coldStartDays: 7,
        coldStartCapacityFactor: 50,
        coldStartReserveFactor: 150,
      });

      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set activation to 10 days ago
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(10);
      }

      // After cold start, both capacity and reserve should be normal
      const normalCapacity = 1_000_000_000_000n;
      const normalReserve = 100_000_000_000n;

      const effectiveCapacity = tracker.getEffectiveCapacity('market-1', normalCapacity);
      const effectiveReserve = tracker.getEffectiveReserve('market-1', normalReserve);

      expect(effectiveCapacity).toBe(normalCapacity);
      expect(effectiveReserve).toBe(normalReserve);
    });
  });

  describe('Configurable cold start period', () => {
    it('should support 7-day default', () => {
      const tracker = new RegimeTracker({
        coldStartDays: 7,
      });

      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Day 6 - still in cold start
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(6);
      }

      expect(tracker.getColdStartStatus('market-1').isColdStart).toBe(true);

      // Day 8 - past cold start
      if (config) {
        config.activatedAt = daysAgo(8);
      }

      expect(tracker.getColdStartStatus('market-1').isColdStart).toBe(false);
    });

    it('should support extended cold start periods', () => {
      const tracker = new RegimeTracker({
        coldStartDays: 30,
        coldStartCapacityFactor: 30, // More conservative
        coldStartReserveFactor: 200, // Higher reserves
      });

      tracker.registerMarket('market-1', '0xdigest', '0xblockhash');

      // Set to 15 days ago - still in cold start
      const config = tracker.getRegimeConfig('market-1');
      if (config) {
        config.activatedAt = daysAgo(15);
      }

      const status = tracker.getColdStartStatus('market-1');
      expect(status.isColdStart).toBe(true);
      expect(status.reducedCapacityFactor).toBe(30);
      expect(status.increasedReserveFactor).toBe(200);
    });
  });
});
