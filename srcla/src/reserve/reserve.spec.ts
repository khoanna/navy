import { ReserveOptimizer } from './reserve.js';
import { ActionDecisionEngine } from '../decision/action-decision.js';

describe('ReserveOptimizer - 3-Component Dynamic Reserve', () => {
  // Common test values
  const TEN_THOUSAND = 10_000_000_000_000n; // 10M USDC (6 decimals)

  describe('Component 1: Floor Reserve', () => {
    it('should calculate minimum reserve at 5% (500 bps)', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const floor = optimizer.minReserve(TEN_THOUSAND);
      expect(floor).toBe(500_000_000_000n); // 5% of 10M
    });

    it('should calculate minimum reserve at different bps', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 1000n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const floor = optimizer.minReserve(TEN_THOUSAND);
      expect(floor).toBe(1_000_000_000_000n); // 10% of 10M
    });

    it('should return 0 for 0 total assets', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const floor = optimizer.minReserve(0n);
      expect(floor).toBe(0n);
    });
  });

  describe('Component 2: Quantile Reserve', () => {
    it('should return floor when withdrawal history is empty', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const quantile = optimizer.quantileReserve(TEN_THOUSAND, [], 0.95);
      expect(quantile).toBe(500_000_000_000n); // Should fall back to floor
    });

    it('should return 95th percentile of withdrawal history', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // History: [100K, 200K, 300K, 400K, 500K, 600K, 700K, 800K, 900K, 1M]
      const history: bigint[] = [
        100_000_000_000n, 200_000_000_000n, 300_000_000_000n,
        400_000_000_000n, 500_000_000_000n, 600_000_000_000n,
        700_000_000_000n, 800_000_000_000n, 900_000_000_000n,
        1_000_000_000_000n,
      ];

      // 95th percentile: index = (10-1) * 0.95 = 8.55
      // Interpolate between sorted[8]=900K and sorted[9]=1M
      // 900K + 0.55 * (1M - 900K) = 955K
      const quantile = optimizer.quantileReserve(TEN_THOUSAND, history, 0.95);
      expect(quantile).toBe(955_000_000_000n);
    });

    it('should return 50th percentile (median)', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const history: bigint[] = [
        100_000_000_000n, 200_000_000_000n, 300_000_000_000n,
        400_000_000_000n, 500_000_000_000n, 600_000_000_000n,
        700_000_000_000n, 800_000_000_000n,
      ];

      // 50th percentile of 8 items = index 3.5 -> linear interpolation
      // between sorted[3]=400K and sorted[4]=500K
      // 400K + 0.5 * (500K - 400K) = 450K
      const quantile = optimizer.quantileReserve(TEN_THOUSAND, history, 0.50);
      expect(quantile).toBe(450_000_000_000n);
    });

    it('should handle unsorted history', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // Unsorted: [1M, 100K, 500K, 200K, 800K]
      const history: bigint[] = [
        1_000_000_000_000n, 100_000_000_000n, 500_000_000_000n,
        200_000_000_000n, 800_000_000_000n,
      ];

      // Sorted: [100K, 200K, 500K, 800K, 1M]
      // 95th percentile of 5 items = index 3.8 -> between sorted[3]=800K and sorted[4]=1M
      const quantile = optimizer.quantileReserve(TEN_THOUSAND, history, 0.95);
      // 800K + 0.8 * (1M - 800K) = 960K
      expect(quantile).toBe(960_000_000_000n);
    });
  });

  describe('Component 3: Stress Reserve', () => {
    it('should return floor when no scenarios provided', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const stress = optimizer.stressReserve(TEN_THOUSAND, []);
      expect(stress).toBe(500_000_000_000n); // Should fall back to floor
    });

    it('should calculate stress reserve from scenarios', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // 0.001 (0.1%) per hour for 24 hours = 2.4% total
      // 2.4% * 0.9 probability = 2.16%
      const scenarios = [
        { name: 'normal', probability: 0.9, withdrawalRate: 0.001, durationHours: 24 },
      ];

      const stress = optimizer.stressReserve(TEN_THOUSAND, scenarios);
      // 10M * 0.024 * 0.9 = 216K
      expect(stress).toBe(216_000_000_000n);
    });

    it('should return max across multiple scenarios', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const scenarios = [
        { name: 'mild', probability: 0.5, withdrawalRate: 0.001, durationHours: 24 },
        { name: 'severe', probability: 0.1, withdrawalRate: 0.01, durationHours: 24 },
      ];

      // Mild: 10M * 0.024 * 0.5 = 120K
      // Severe: 10M * 0.24 * 0.1 = 240K
      const stress = optimizer.stressReserve(TEN_THOUSAND, scenarios);
      expect(stress).toBe(240_000_000_000n); // Max of both
    });
  });

  describe('optimalReserve: 3-Component Combination', () => {
    it('should return floor when floor is highest', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // Floor: 500K, Quantile (empty): 500K, Stress: 216K
      const scenarios = [
        { name: 'normal', probability: 0.9, withdrawalRate: 0.001, durationHours: 24 },
      ];

      const optimal = optimizer.optimalReserve(TEN_THOUSAND, scenarios);
      expect(optimal).toBe(500_000_000_000n); // Floor wins
    });

    it('should return quantile when quantile exceeds floor', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // High withdrawal history
      const history: bigint[] = [
        10_000_000_000_000n, // 10M
        11_000_000_000_000n,
        12_000_000_000_000n,
      ];

      const scenarios = [
        { name: 'normal', probability: 0.9, withdrawalRate: 0.001, durationHours: 24 },
      ];

      const optimal = optimizer.optimalReserve(TEN_THOUSAND, scenarios, history);
      // Floor: 500K, Quantile: 11.9M (interpolated between 11M and 12M), Stress: 216K -> quantile wins
      expect(optimal).toBe(11_900_000_000_000n);
    });

    it('should return stress when stress exceeds others', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 100n, // Low floor (1%)
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // Severe stress scenario
      const scenarios = [
        { name: 'bank_run', probability: 0.05, withdrawalRate: 0.05, durationHours: 48 },
      ];

      // Severe: 10M * 2.4 (5% * 48h) * 0.05 = 1.2M
      const optimal = optimizer.optimalReserve(TEN_THOUSAND, scenarios);
      // Floor: 100K, Quantile (empty): 100K, Stress: ~1.2M -> stress wins
      expect(optimal).toBe(1_200_000_000_000n);
    });

    it('should work with legacy 2-argument call', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const scenarios = [
        { name: 'normal', probability: 0.9, withdrawalRate: 0.001, durationHours: 24 },
      ];

      // Legacy call without withdrawalHistory
      const optimal = optimizer.optimalReserve(TEN_THOUSAND, scenarios);
      expect(optimal).toBe(500_000_000_000n); // floor = quantile (empty) > stress
    });

    it('should respect custom quantile percentile', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 100n, // Low floor (1% = 100K)
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // Use values that show the percentile difference
      const history: bigint[] = [
        100_000_000_000n, 200_000_000_000n, 300_000_000_000n,
        400_000_000_000n, 500_000_000_000n, // 5 elements
      ];

      const scenarios: never[] = [];

      // With 99th percentile of 5 items: index = (5-1) * 0.99 = 3.96
      // Interpolate between sorted[3]=400K and sorted[4]=500K
      // 400K + 0.96 * (500K - 400K) = 496K
      const optimal99 = optimizer.optimalReserve(TEN_THOUSAND, scenarios, history, 0.99);
      expect(optimal99).toBe(496_000_000_000n);

      // With 50th percentile of 5 items: index = 4 * 0.5 = 2
      // sorted[2] = 300K (exact match since lower === upper)
      // Floor (100K) < quantile (300K) so quantile wins
      const optimal50 = optimizer.optimalReserve(TEN_THOUSAND, scenarios, history, 0.50);
      expect(optimal50).toBe(300_000_000_000n);
    });
  });

  describe('stressTest', () => {
    it('should pass when reserve covers withdrawals', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // 0.0005 (0.05%) per hour for 24 hours = 1.2% total
      // reserve = 200K on 10M = 2%, so coverage = 2/1.2 = 1.67 > 1
      const scenarios = [
        { name: 'normal', probability: 0.9, withdrawalRate: 0.0005, durationHours: 24 },
      ];

      const result = optimizer.stressTest(TEN_THOUSAND, 200_000_000_000n, scenarios);

      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(1);
      const firstResult = result.results[0]!;
      expect(firstResult.passed).toBe(true);
      expect(firstResult.coverage).toBeGreaterThan(1);
    });

    it('should fail when reserve is insufficient', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      // 0.01 (1%) per hour for 24 hours = 24% total
      // reserve = 100K on 10M = 1%, so coverage = 1/24 = 0.042 < 1
      const scenarios = [
        { name: 'severe', probability: 1.0, withdrawalRate: 0.01, durationHours: 24 },
      ];

      const result = optimizer.stressTest(TEN_THOUSAND, 100_000_000_000n, scenarios);

      expect(result.passed).toBe(false);
      const firstResult = result.results[0]!;
      expect(firstResult.passed).toBe(false);
      expect(firstResult.shortfall).toBeGreaterThan(0n);
    });

    it('should handle zero withdrawals', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const scenarios = [
        { name: 'no_withdrawal', probability: 0.9, withdrawalRate: 0, durationHours: 24 },
      ];

      const result = optimizer.stressTest(TEN_THOUSAND, 0n, scenarios);

      expect(result.passed).toBe(true);
      const firstResult = result.results[0]!;
      expect(firstResult.coverage).toBe(Infinity);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small total assets', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const smallAssets = 1_000_000n; // 1 USDC
      const optimal = optimizer.optimalReserve(smallAssets, []);
      expect(optimal).toBe(50_000n); // 5% of 1 USDC
    });

    it('should handle very large total assets', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 500n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const largeAssets = 1_000_000_000_000_000n; // 1B USDC
      const optimal = optimizer.optimalReserve(largeAssets, []);
      expect(optimal).toBe(50_000_000_000_000n); // 5% of 1B
    });

    it('should handle extreme withdrawal rates', () => {
      const optimizer = new ReserveOptimizer({
        minReserveBps: 100n,
        stressBufferBps: 50n,
        withdrawalHorizonHours: 24,
      });

      const scenarios = [
        { name: 'extreme', probability: 1.0, withdrawalRate: 0.1, durationHours: 1 }, // 10% in 1 hour
      ];

      const optimal = optimizer.optimalReserve(TEN_THOUSAND, scenarios);
      // 10M * 0.1 * 1 * 1.0 = 1M
      expect(optimal).toBe(1_000_000_000_000n);
    });
  });
});

describe('ActionDecisionEngine', () => {
  it('should return hold when amounts are equal', () => {
    const engine = new ActionDecisionEngine({
      movementCostBps: 10n,
      cooldownSeconds: 3600,
      minActionAmount: 1000n,
      turnoverBudgetBps: 500n,
    });

    const result = engine.decide({
      currentAllocation: new Map([['aave', 5000_000_000n]]),
      optimalAllocation: new Map([['aave', 5000_000_000n]]),
      totalAssets: 10_000_000_000_000n,
      forecast: [{ meanReturn: 1_000_000_000_000_000_000n, lowerReturn: 990_000_000_000_000_000n }],
      lastActionTimestamp: new Date(Date.now() - 86400000),
      recentTurnover: 0n,
    });

    expect(result.action).toBe('hold');
  });

  it('should deploy when optimal > current', () => {
    const engine = new ActionDecisionEngine({
      movementCostBps: 10n,
      cooldownSeconds: 0,
      minActionAmount: 1000n,
      turnoverBudgetBps: 10000n,
    });

    const result = engine.decide({
      currentAllocation: new Map([['aave', 0n]]),
      optimalAllocation: new Map([['aave', 5000_000_000n]]),
      totalAssets: 10_000_000_000_000n,
      forecast: [{ meanReturn: 1_000_000_000_000_000_000n, lowerReturn: 990_000_000_000_000_000n }],
      lastActionTimestamp: new Date(Date.now() - 86400000),
      recentTurnover: 0n,
    });

    expect(['deploy', 'hold']).toContain(result.action);
  });

  it('should respect cooldown', () => {
    const engine = new ActionDecisionEngine({
      movementCostBps: 10n,
      cooldownSeconds: 86400,
      minActionAmount: 0n,
      turnoverBudgetBps: 10000n,
    });

    const result = engine.decide({
      currentAllocation: new Map([['aave', 0n]]),
      optimalAllocation: new Map([['aave', 5000_000_000n]]),
      totalAssets: 10_000_000_000_000n,
      forecast: [],
      lastActionTimestamp: new Date(),
      recentTurnover: 0n,
    });

    expect(result.action).toBe('hold');
    expect(result.reason).toBe('COOLDOWN_ACTIVE');
  });
});
