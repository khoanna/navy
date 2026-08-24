/**
 * Unit tests for GreedyAllocator
 *
 * Tests the unified greedy allocation algorithm that consolidates
 * the three prior implementations in the codebase.
 */

import { GreedyAllocator } from '../../../src/optimizer/greedy-allocator.js';
import type { AllocatableMarket } from '../../../src/optimizer/greedy-allocator.js';

describe('GreedyAllocator', () => {
  let allocator: GreedyAllocator;

  beforeEach(() => {
    allocator = new GreedyAllocator();
  });

  describe('basic allocation', () => {
    it('allocates all funds when markets have sufficient capacity', () => {
      const markets: AllocatableMarket[] = [
        { id: 'compound', expectedReturn: 50_000_000_000_000_000n, capacity: 500_000_000_000n }, // 5%
        { id: 'aave', expectedReturn: 40_000_000_000_000_000n, capacity: 500_000_000_000n }, // 4%
      ];
      const totalAmount = 1_000_000_000_000n; // 1M USDC

      const result = allocator.allocate(totalAmount, markets);

      expect(result.totalAllocated).toBe(1_000_000_000_000n);
      expect(result.idleAmount).toBe(0n);
      expect(result.allocations).toHaveLength(2);
    });

    it('sorts allocations by expected return (highest first)', () => {
      const markets: AllocatableMarket[] = [
        { id: 'low', expectedReturn: 10_000_000_000_000_000n, capacity: 200_000_000_000n },
        { id: 'high', expectedReturn: 100_000_000_000_000_000n, capacity: 200_000_000_000n },
        { id: 'medium', expectedReturn: 50_000_000_000_000_000n, capacity: 200_000_000_000n },
      ];
      const totalAmount = 600_000_000_000n;

      const result = allocator.allocate(totalAmount, markets);

      // High gets 200k first, then medium gets 200k, then low gets remaining 200k
      expect(result.allocations[0]!.marketId).toBe('high');
      expect(result.allocations[1]!.marketId).toBe('medium');
      expect(result.allocations[2]!.marketId).toBe('low');
      expect(result.allocations).toHaveLength(3);
    });

    it('respects market capacity limits', () => {
      const markets: AllocatableMarket[] = [
        { id: 'limited', expectedReturn: 100_000_000_000_000_000n, capacity: 100_000_000_000n }, // 100k limit
        { id: 'unlimited', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
      ];
      const totalAmount = 500_000_000_000n; // 500k USDC

      const result = allocator.allocate(totalAmount, markets);

      // Limited market should only get 100k
      const limitedAllocation = result.allocations.find((a) => a.marketId === 'limited');
      expect(limitedAllocation!.amount).toBe(100_000_000_000n);
      // Remaining should go to unlimited
      expect(result.totalAllocated).toBe(500_000_000_000n);
    });

    it('handles empty markets array', () => {
      const result = allocator.allocate(1_000_000_000_000n, []);

      expect(result.allocations).toHaveLength(0);
      expect(result.totalAllocated).toBe(0n);
      expect(result.idleAmount).toBe(1_000_000_000_000n);
    });

    it('handles zero capacity markets', () => {
      const markets: AllocatableMarket[] = [
        { id: 'active', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
        { id: 'inactive', expectedReturn: 100_000_000_000_000_000n, capacity: 0n },
      ];
      const totalAmount = 500_000_000_000n;

      const result = allocator.allocate(totalAmount, markets);

      // Only active market should receive allocation
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]!.marketId).toBe('active');
    });
  });

  describe('idle buffer', () => {
    it('keeps idle buffer as specified in basis points', () => {
      const markets: AllocatableMarket[] = [
        { id: 'compound', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
      ];
      const totalAmount = 1_000_000_000_000n; // 1M USDC

      const result = allocator.allocate(totalAmount, markets, {
        idleBufferBps: 500, // 5%
      });

      // Should allocate 95% and keep 5% idle
      expect(result.idleAmount).toBe(50_000_000_000n);
      expect(result.totalAllocated).toBe(950_000_000_000n);
    });

    it('keeps full amount idle when idleBufferBps is 10000', () => {
      const markets: AllocatableMarket[] = [
        { id: 'compound', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
      ];
      const totalAmount = 1_000_000_000_000n;

      const result = allocator.allocate(totalAmount, markets, {
        idleBufferBps: 10000, // 100%
      });

      expect(result.idleAmount).toBe(1_000_000_000_000n);
      expect(result.totalAllocated).toBe(0n);
    });
  });

  describe('minimum allocation', () => {
    it('skips allocations below minimum threshold', () => {
      const markets: AllocatableMarket[] = [
        { id: 'small', expectedReturn: 100_000_000_000_000_000n, capacity: 10_000_000n }, // 10 USDC
        { id: 'large', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
      ];
      const totalAmount = 1_000_000_000_000n;

      const result = allocator.allocate(totalAmount, markets, {
        minAllocation: 100_000_000n, // 100 USDC minimum
      });

      // Small allocation should be skipped
      expect(result.allocations.find((a) => a.marketId === 'small')).toBeUndefined();
      // Large should still get funded
      expect(result.allocations.find((a) => a.marketId === 'large')).toBeDefined();
    });
  });

  describe('cold start factor', () => {
    it('reduces allocation during cold start', () => {
      const markets: AllocatableMarket[] = [
        { id: 'compound', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
      ];
      const totalAmount = 1_000_000_000_000n; // 1M USDC

      const result = allocator.allocate(totalAmount, markets, {
        coldStartFactor: 0.5, // 50% capacity
      });

      // Should only deploy 50% of deployable amount
      expect(result.totalAllocated).toBe(500_000_000_000n);
      expect(result.idleAmount).toBe(500_000_000_000n);
    });

    it('allows full allocation when cold start factor is 1.0', () => {
      const markets: AllocatableMarket[] = [
        { id: 'compound', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
      ];
      const totalAmount = 1_000_000_000_000n;

      const result = allocator.allocate(totalAmount, markets, {
        coldStartFactor: 1.0,
      });

      expect(result.totalAllocated).toBe(1_000_000_000_000n);
    });
  });

  describe('portfolio return calculation', () => {
    it('calculates weighted average portfolio return', () => {
      const markets: AllocatableMarket[] = [
        { id: 'high', expectedReturn: 100_000_000_000_000_000n, capacity: 500_000_000_000n }, // 10%
        { id: 'low', expectedReturn: 20_000_000_000_000_000n, capacity: 500_000_000_000n }, // 2%
      ];
      const totalAmount = 1_000_000_000_000n;

      const result = allocator.allocate(totalAmount, markets);

      // 500k at 10% + 500k at 2% = 6% average
      // Expected: (500k * 10% + 500k * 2%) / 1M = 6%
      expect(result.portfolioReturn).toBe(60_000_000_000_000_000n);
    });

    it('returns zero portfolio return when nothing allocated', () => {
      const result = allocator.allocate(1_000_000_000_000n, []);

      expect(result.portfolioReturn).toBe(0n);
    });
  });

  describe('computeRebalanceTarget', () => {
    it('computes target allocation for rebalancing', () => {
      const markets: AllocatableMarket[] = [
        { id: 'compound', expectedReturn: 50_000_000_000_000_000n, capacity: 1_000_000_000_000n },
      ];
      const totalAssets = 1_000_000_000_000n;
      const currentAllocation = new Map<string, bigint>([['compound', 0n]]);

      const target = allocator.computeRebalanceTarget(
        currentAllocation,
        markets,
        totalAssets,
      );

      // With no current allocation, target = greedy allocation = 1M
      expect(target.get('compound')).toBe(1_000_000_000_000n);
    });
  });
});
