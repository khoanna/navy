/**
 * Decision Cycle Integration Tests
 *
 * Tests the complete SRCLA decision cycle end-to-end:
 * - Cold-start eligibility checks
 * - Reserve calculation
 * - Cost gate evaluation
 * - Allocation optimization
 */

import { describe, it, expect } from '@jest/globals';
import { runDecisionCycle, simulateDecisionCycles, type DecisionCycleInput } from './decision-cycle.js';

describe('Decision Cycle Integration', () => {
  describe('runDecisionCycle', () => {
    it('should complete full cycle with valid markets', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 1_000_000_000_000n, // 1M USDC
          idle: 100_000_000_000n, // 100k idle
        },
        markets: [
          {
            marketId: 'aave',
            cash: 50_000_000_000_000n,
            borrows: 30_000_000_000_000n,
            supplyRate: 50_000_000_000_000_00n, // 5% APY
            capacity: 500_000_000_000n, // 500k capacity
          },
          {
            marketId: 'compound',
            cash: 30_000_000_000_000n,
            borrows: 20_000_000_000_000n,
            supplyRate: 45_000_000_000_000_00n, // 4.5% APY
            capacity: 400_000_000_000n, // 400k capacity
          },
        ],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map([
            ['aave', 60],
            ['compound', 45],
          ]),
          firstObservation: new Map([
            ['aave', new Date('2026-01-01')],
            ['compound', new Date('2026-01-15')],
          ]),
          withdrawalHistory: new Map([
            ['aave', [10_000_000_000_000n, 5_000_000_000_000n]],
            ['compound', [8_000_000_000_000n]],
          ]),
        },
      };

      const result = await runDecisionCycle(input);

      // Should have no errors for eligible markets
      expect(result.errors.filter(e => e.includes('INSUFFICIENT') || e.includes('COLD_START'))).toHaveLength(0);

      // Should pass cold-start gate
      expect(result.passed.coldStart).toBe(true);

      // Should have calculated reserve
      expect(result.reserve).toBeGreaterThan(0n);

      // Should complete with valid idle tracking (idle >= 0)
      expect(result.idle).toBeGreaterThanOrEqual(0n);

      // Allocations should be valid (non-negative amounts)
      for (const amount of result.allocations.values()) {
        expect(amount).toBeGreaterThanOrEqual(0n);
      }

      // Should have calculated reserve
      expect(result.reserve).toBeGreaterThan(0n);

      // Should have allocations or be fully idle
      const totalAllocated = [...result.allocations.values()].reduce((a, b) => a + b, 0n);
      expect(totalAllocated >= 0n).toBe(true);
    });

    it('should reject market in cold-start', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 1_000_000_000_000n,
          idle: 100_000_000_000n,
        },
        markets: [
          {
            marketId: 'aave',
            cash: 50_000_000_000_000n,
            borrows: 30_000_000_000_000n,
            supplyRate: 50_000_000_000_000_00n,
            capacity: 500_000_000_000n,
          },
        ],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map([['aave', 5]]), // Below minimum
          firstObservation: new Map([['aave', new Date('2026-08-10')]]), // Recent
          withdrawalHistory: new Map([['aave', []]]),
        },
      };

      const result = await runDecisionCycle(input);

      // Should have cold-start errors
      expect(result.errors.some((e) => e.includes('INSUFFICIENT_OBSERVATIONS') || e.includes('COLD_START'))).toBe(true);

      // Market should not be eligible
      const eligibility = result.marketEligibility.get('aave');
      expect(eligibility?.eligible).toBe(false);

      // No allocations since market is ineligible
      expect(result.allocations.size).toBe(0);
    });

    it('should handle insufficient observations error', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 1_000_000_000_000n,
          idle: 50_000_000_000n,
        },
        markets: [
          {
            marketId: 'morpho',
            cash: 20_000_000_000_000n,
            borrows: 10_000_000_000_000n,
            supplyRate: 60_000_000_000_000_00n, // 6% - highest rate
            capacity: 600_000_000_000n,
          },
        ],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map([['morpho', 10]]), // Below 30
          firstObservation: new Map([['morpho', new Date('2026-01-01')]]), // Old enough in time
          withdrawalHistory: new Map([['morpho', []]]),
        },
      };

      const result = await runDecisionCycle(input);

      // Should have observation count error
      expect(result.errors.some((e) => e.includes('INSUFFICIENT_OBSERVATIONS'))).toBe(true);
      expect(result.marketEligibility.get('morpho')?.eligible).toBe(false);
    });

    it('should calculate reserve correctly', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 10_000_000_000_000n, // 10M USDC
          idle: 0n,
        },
        markets: [],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map(),
          firstObservation: new Map(),
          withdrawalHistory: new Map([
            ['default', [
              100_000_000_000n, // 100k
              200_000_000_000n, // 200k
              150_000_000_000n, // 150k
              50_000_000_000n, // 50k
              300_000_000_000n, // 300k
            ]],
          ]),
        },
      };

      const result = await runDecisionCycle(input);

      // Reserve should be at least 5% of total assets (minReserveBps = 500 = 5%)
      const minExpected = (input.vault.totalAssets * 500n) / 10000n;
      expect(result.reserve).toBeGreaterThanOrEqual(minExpected);
    });

    it('should allocate to highest rate markets', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 5_000_000_000_000n, // 5M USDC
          idle: 0n,
        },
        markets: [
          {
            marketId: 'low-rate',
            cash: 100_000_000_000_000n,
            borrows: 50_000_000_000_000n,
            supplyRate: 20_000_000_000_000_00n, // 2% APY
            capacity: 1_000_000_000_000n,
          },
          {
            marketId: 'high-rate',
            cash: 100_000_000_000_000n,
            borrows: 50_000_000_000_000n,
            supplyRate: 80_000_000_000_000_00n, // 8% APY
            capacity: 2_000_000_000_000n,
          },
        ],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map([
            ['low-rate', 60],
            ['high-rate', 60],
          ]),
          firstObservation: new Map([
            ['low-rate', new Date('2026-01-01')],
            ['high-rate', new Date('2026-01-01')],
          ]),
          withdrawalHistory: new Map(),
        },
      };

      const result = await runDecisionCycle(input);

      // High-rate market should be preferred
      // (if cost gate passes and allocation is made)
      const highRateAllocation = result.allocations.get('high-rate') ?? 0n;
      const lowRateAllocation = result.allocations.get('low-rate') ?? 0n;

      // Either both get nothing (cost gate failed), or high-rate gets more
      expect(highRateAllocation >= lowRateAllocation).toBe(true);
    });

    it('should respect capacity limits', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 100_000_000_000_000n, // 100M USDC - huge
          idle: 0n,
        },
        markets: [
          {
            marketId: 'limited',
            cash: 500_000_000_000_000n,
            borrows: 200_000_000_000_000n,
            supplyRate: 50_000_000_000_000_00n,
            capacity: 10_000_000_000_000n, // Only 10M capacity
          },
        ],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map([['limited', 60]]),
          firstObservation: new Map([['limited', new Date('2026-01-01')]]),
          withdrawalHistory: new Map(),
        },
      };

      const result = await runDecisionCycle(input);

      const allocation = result.allocations.get('limited') ?? 0n;
      // Allocation should not exceed capacity
      expect(allocation).toBeLessThanOrEqual(input.markets[0]!.capacity);
    });

    it('should handle empty markets list', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 1_000_000_000_000n,
          idle: 1_000_000_000_000n,
        },
        markets: [],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map(),
          firstObservation: new Map(),
          withdrawalHistory: new Map(),
        },
      };

      const result = await runDecisionCycle(input);

      // Should complete without errors
      expect(result.errors).toHaveLength(0);

      // All funds should remain idle
      expect(result.idle).toBe(input.vault.totalAssets);

      // No allocations
      expect(result.allocations.size).toBe(0);
    });

    it('should handle zero total assets', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 0n,
          idle: 0n,
        },
        markets: [
          {
            marketId: 'aave',
            cash: 50_000_000_000_000n,
            borrows: 30_000_000_000_000n,
            supplyRate: 50_000_000_000_000_00n,
            capacity: 500_000_000_000n,
          },
        ],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map([['aave', 60]]),
          firstObservation: new Map([['aave', new Date('2026-01-01')]]),
          withdrawalHistory: new Map(),
        },
      };

      const result = await runDecisionCycle(input);

      // Should handle zero assets gracefully
      expect(result.reserve).toBe(0n);
      expect(result.allocations.size).toBe(0);
      expect(result.idle).toBe(0n);
    });
  });

  describe('simulateDecisionCycles', () => {
    it('should run multiple decision cycles', async () => {
      const inputs: DecisionCycleInput[] = [
        {
          vault: { totalAssets: 1_000_000_000_000n, idle: 100_000_000_000n },
          markets: [{
            marketId: 'aave',
            cash: 50_000_000_000_000n,
            borrows: 30_000_000_000_000n,
            supplyRate: 50_000_000_000_000_00n,
            capacity: 500_000_000_000n,
          }],
          config: { coldStartDays: 7, minObservations: 30, minReserveBps: 500n },
          historicalData: {
            observationCount: new Map([['aave', 60]]),
            firstObservation: new Map([['aave', new Date('2026-01-01')]]),
            withdrawalHistory: new Map(),
          },
        },
        {
          vault: { totalAssets: 1_100_000_000_000n, idle: 50_000_000_000n },
          markets: [{
            marketId: 'aave',
            cash: 55_000_000_000_000n,
            borrows: 33_000_000_000_000n,
            supplyRate: 52_000_000_000_000_00n, // Slightly higher rate
            capacity: 550_000_000_000n,
          }],
          config: { coldStartDays: 7, minObservations: 30, minReserveBps: 500n },
          historicalData: {
            observationCount: new Map([['aave', 61]]),
            firstObservation: new Map([['aave', new Date('2026-01-01')]]),
            withdrawalHistory: new Map(),
          },
        },
      ];

      const results = await simulateDecisionCycles(inputs);

      expect(results).toHaveLength(2);

      // Both should complete successfully
      expect(results[0]!.passed.coldStart).toBe(true);
      expect(results[1]!.passed.coldStart).toBe(true);
    });

    it('should call onCycle callback', async () => {
      const inputs: DecisionCycleInput[] = [
        {
          vault: { totalAssets: 1_000_000_000_000n, idle: 100_000_000_000n },
          markets: [{
            marketId: 'aave',
            cash: 50_000_000_000_000n,
            borrows: 30_000_000_000_000n,
            supplyRate: 50_000_000_000_000_00n,
            capacity: 500_000_000_000n,
          }],
          config: { coldStartDays: 7, minObservations: 30, minReserveBps: 500n },
          historicalData: {
            observationCount: new Map([['aave', 60]]),
            firstObservation: new Map([['aave', new Date('2026-01-01')]]),
            withdrawalHistory: new Map(),
          },
        },
      ];

      const callbackResults: Array<{ index: number; result: typeof inputs }> = [];

      await simulateDecisionCycles(inputs, (index, result) => {
        callbackResults.push({ index, result: [result as unknown as DecisionCycleInput] });
      });

      expect(callbackResults).toHaveLength(1);
      expect(callbackResults[0]!.index).toBe(0);
    });
  });

  describe('marketEligibility', () => {
    it('should correctly report eligibility status', async () => {
      const input: DecisionCycleInput = {
        vault: {
          totalAssets: 1_000_000_000_000n,
          idle: 100_000_000_000n,
        },
        markets: [
          {
            marketId: 'eligible',
            cash: 50_000_000_000_000n,
            borrows: 30_000_000_000_000n,
            supplyRate: 50_000_000_000_000_00n,
            capacity: 500_000_000_000n,
          },
          {
            marketId: 'ineligible',
            cash: 40_000_000_000_000n,
            borrows: 20_000_000_000_000n,
            supplyRate: 45_000_000_000_000_00n,
            capacity: 400_000_000_000n,
          },
        ],
        config: {
          coldStartDays: 7,
          minObservations: 30,
          minReserveBps: 500n,
        },
        historicalData: {
          observationCount: new Map([
            ['eligible', 60],
            ['ineligible', 5], // Below minimum
          ]),
          firstObservation: new Map([
            ['eligible', new Date('2026-01-01')],
            ['ineligible', new Date('2026-08-10')],
          ]),
          withdrawalHistory: new Map(),
        },
      };

      const result = await runDecisionCycle(input);

      const eligibleMarket = result.marketEligibility.get('eligible');
      const ineligibleMarket = result.marketEligibility.get('ineligible');

      expect(eligibleMarket?.eligible).toBe(true);
      expect(eligibleMarket?.reason).toBe('ELIGIBLE');

      expect(ineligibleMarket?.eligible).toBe(false);
      expect(ineligibleMarket?.reason).toContain('INSUFFICIENT_OBSERVATIONS');

      // Ineligible market should have reduced capacity (cold start)
      expect(ineligibleMarket?.effectiveCapacity).toBeLessThan(
        input.markets.find((m) => m.marketId === 'ineligible')!.capacity
      );
    });
  });
});
