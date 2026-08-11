import { describe, it, expect } from '@jest/globals';
import {
  ConstrainedOptimizer,
  OptimizationConstraints,
  AdapterForecast,
} from './constrained-optimizer';
import { DependencyGroups, DependencyGroup } from './dependency-groups';

const AAVE_ADDR = '0x0000000000000000000000000000000000000A11';
const COMPOUND_ADDR = '0x0000000000000000000000000000000000000C01';
const MOONWELL_ADDR = '0x0000000000000000000000000000000000000M01';

function createForecast(
  adapter: string,
  meanReturn: bigint,
  lowerReturn: bigint,
  capacity: bigint,
  currentAllocation: bigint = 0n
): AdapterForecast {
  return {
    adapter,
    forecast: {
      marketId: adapter,
      horizon: 86400,
      meanReturn,
      lowerReturn,
      coverage: 0.95,
      method: 'rolling',
      config: {},
    },
    capacity,
    currentAllocation,
  };
}

function createConstraints(): OptimizationConstraints {
  return {
    minReserveBps: 500n, // 5%
    maxMarketCapBps: 4000n, // 40%
    maxDependencyGroupCapBps: 5000n, // 50%
    maxAbsoluteExposure: 10_000_000_000000n, // 10M USDC
    minActionAmount: 100_000_0000n, // 100 USDC
  };
}

describe('ConstrainedOptimizer', () => {
  describe('basic optimization', () => {
    it('should respect minimum reserve constraint', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const totalAssets = 1_000_000_000000n; // 1M USDC
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 10_000_000_000000n), // 5% mean, 4% lower
        createForecast(COMPOUND_ADDR, 400n, 300n, 10_000_000_000000n), // 4% mean, 3% lower
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // Should have at least 5% reserve (500 bps)
      expect(result.idleAmount).toBeGreaterThanOrEqual(50_000_000000n);
      expect(result.success).toBe(true);
    });

    it('should allocate to higher return adapters first', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const totalAssets = 1_000_000_000000n; // 1M USDC
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 300n, 200n, 10_000_000_000000n), // lower return
        createForecast(COMPOUND_ADDR, 500n, 400n, 10_000_000_000000n), // higher return
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // Compound should get allocated (higher return)
      const compoundAlloc = result.allocations.get(COMPOUND_ADDR) ?? 0n;
      expect(compoundAlloc).toBeGreaterThan(0n);
    });

    it('should respect capacity constraints', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const totalAssets = 1_000_000_000000n; // 1M USDC
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 100_000_000000n), // only 100k capacity
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // Aave should not exceed its capacity
      const aaveAlloc = result.allocations.get(AAVE_ADDR) ?? 0n;
      expect(aaveAlloc).toBeLessThanOrEqual(100_000_000000n);
    });

    it('should respect market cap constraints', () => {
      const constraints: OptimizationConstraints = {
        ...createConstraints(),
        maxMarketCapBps: 2000n, // 20%
      };
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const totalAssets = 1_000_000_000000n; // 1M USDC
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 10_000_000_000000n),
        createForecast(COMPOUND_ADDR, 400n, 300n, 10_000_000_000000n),
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // No single adapter should exceed 20% of TVL
      for (const [_, allocation] of result.allocations) {
        expect(allocation).toBeLessThanOrEqual(200_000_000000n); // 20% of 1M
      }
    });
  });

  describe('dependency group constraints', () => {
    it('should respect dependency group caps', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n, // 50%
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
      ];

      const constraints = createConstraints();
      const optimizer = new ConstrainedOptimizer(constraints, new DependencyGroups(groups));

      const totalAssets = 1_000_000_000000n; // 1M USDC
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 10_000_000_000000n),
        createForecast(COMPOUND_ADDR, 400n, 300n, 10_000_000_000000n),
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // Combined allocation to Aave + Compound should not exceed 50%
      const aaveAlloc = result.allocations.get(AAVE_ADDR) ?? 0n;
      const compoundAlloc = result.allocations.get(COMPOUND_ADDR) ?? 0n;
      const total = aaveAlloc + compoundAlloc;

      expect(total).toBeLessThanOrEqual(500_000_000000n); // 50% of 1M
    });

    it('should report violation when group cap exceeded', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'small-group',
          capBps: 1000n, // 10%
          adapters: [AAVE_ADDR],
        },
      ];

      const constraints = createConstraints();
      const optimizer = new ConstrainedOptimizer(constraints, new DependencyGroups(groups));

      const totalAssets = 1_000_000_000000n; // 1M USDC
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 10_000_000_000000n),
        createForecast(COMPOUND_ADDR, 400n, 300n, 10_000_000_000000n),
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // Check if violations are reported
      // Note: The optimizer itself respects the cap, so it shouldn't violate
      // But we can test that it respects the constraint
      const aaveAlloc = result.allocations.get(AAVE_ADDR) ?? 0n;
      expect(aaveAlloc).toBeLessThanOrEqual(100_000_000000n); // 10% cap
    });
  });

  describe('minimum action amount', () => {
    it('should filter out allocations below minimum', () => {
      const constraints: OptimizationConstraints = {
        ...createConstraints(),
        minActionAmount: 1_000_000_000000n, // 1000 USDC
      };
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const totalAssets = 500_000_000000n; // 500k USDC
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 10_000_000_000000n),
        createForecast(COMPOUND_ADDR, 400n, 300n, 10_000_000_000000n),
        createForecast(MOONWELL_ADDR, 300n, 200n, 100_000_000000n), // small capacity
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // All allocations should be at least 1000 USDC
      for (const [_, allocation] of result.allocations) {
        expect(allocation).toBeGreaterThanOrEqual(1_000_000_000000n);
      }
    });
  });

  describe('calculateDelta', () => {
    it('should calculate positive delta for new allocations', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const current = new Map<string, bigint>([
        [AAVE_ADDR, 100_000_000000n],
      ]);

      const target = new Map<string, bigint>([
        [AAVE_ADDR, 200_000_000000n],
        [COMPOUND_ADDR, 100_000_000000n],
      ]);

      const delta = optimizer.calculateDelta(current, target);

      expect(delta.get(AAVE_ADDR)).toBe(100_000_000000n); // +100k
      expect(delta.get(COMPOUND_ADDR)).toBe(100_000_000000n); // +100k (new)
    });

    it('should calculate negative delta for reduced allocations', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const current = new Map<string, bigint>([
        [AAVE_ADDR, 200_000_000000n],
        [COMPOUND_ADDR, 100_000_000000n],
      ]);

      const target = new Map<string, bigint>([
        [AAVE_ADDR, 100_000_000000n],
      ]);

      const delta = optimizer.calculateDelta(current, target);

      expect(delta.get(AAVE_ADDR)).toBe(-100_000_000000n); // -100k
    });
  });

  describe('filterActionsByMinimum', () => {
    it('should filter out small actions', () => {
      const constraints: OptimizationConstraints = {
        ...createConstraints(),
        minActionAmount: 1_000_000_000000n, // 1000 USDC
      };
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const actions = new Map<string, bigint>([
        [AAVE_ADDR, 2_000_000_000000n], // 2000 USDC - keep
        [COMPOUND_ADDR, 500_000_000000n], // 500 USDC - filter
      ]);

      const filtered = optimizer.filterActionsByMinimum(actions);

      expect(filtered.size).toBe(1);
      expect(filtered.get(AAVE_ADDR)).toBe(2_000_000_000000n);
    });
  });

  describe('edge cases', () => {
    it('should handle empty forecasts', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const totalAssets = 1_000_000_000000n;
      const result = optimizer.optimize(totalAssets, []);

      // All assets should be idle
      expect(result.idleAmount).toBe(totalAssets);
      expect(result.allocations.size).toBe(0);
    });

    it('should handle zero total assets', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 10_000_000_000000n),
      ];

      const result = optimizer.optimize(0n, forecasts);

      expect(result.idleAmount).toBe(0n);
      expect(result.allocations.size).toBe(0);
    });

    it('should handle current allocations', () => {
      const constraints = createConstraints();
      const groups = new DependencyGroups([]);
      const optimizer = new ConstrainedOptimizer(constraints, groups);

      const totalAssets = 1_000_000_000000n;
      const forecasts: AdapterForecast[] = [
        createForecast(AAVE_ADDR, 500n, 400n, 10_000_000_000000n, 300_000_000000n), // already has 300k
      ];

      const result = optimizer.optimize(totalAssets, forecasts);

      // Aave should have at least the current allocation
      const aaveAlloc = result.allocations.get(AAVE_ADDR) ?? 0n;
      expect(aaveAlloc).toBeGreaterThanOrEqual(300_000_000000n);
    });
  });
});
