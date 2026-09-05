/**
 * Scheduler Cold-Start Gate Tests
 *
 * Tests cold-start constraint enforcement per SRCLA design §9.4
 * and RegimeTracker.isEligible() integration.
 */

import { Scheduler, SchedulerConfig } from '../../../src/runtime/scheduler.js';
import { SnapshotCollector } from '../../../src/collector/snapshot-collector.js';
import { PrismaClient } from '@prisma/client';
import { ChainClient } from '../../../src/chain/client.js';

// Mock dependencies
const mockCollector = {
  collect: jest.fn(),
  client: {} as ChainClient,
} as unknown as SnapshotCollector;

const mockPrisma = {
  chainBlock: { upsert: jest.fn() },
  marketSnapshot: { upsert: jest.fn() },
  withdrawalEvent: { findMany: jest.fn(), findFirst: jest.fn() },
  chainBlock: { findUnique: jest.fn() },
  decision: { create: jest.fn() },
} as unknown as PrismaClient;

const defaultConfig: SchedulerConfig = {
  collectorEnabled: false,
  collectorIntervalMs: 900000,
  controllerEnabled: false,
  controllerIntervalMs: 3600000,
  calibrationIntervalMs: 604800000,
  calibrationWindowDays: 30,
  heldOutWindowDays: 7,
  forecastHorizonSeconds: 604800,
  artifactHash: 'test-artifact',
  chainId: 8453,
  executionEnabled: false,
  coldStartCapacityFactor: 0.5,
  coldStartReserveFactor: 1.5,
};

describe('Scheduler cold-start gate', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new Scheduler(
      mockCollector,
      mockPrisma,
      defaultConfig,
      '0x0000000000000000000000000000000000000001'
    );
  });

  describe('applyColdStartConstraints', () => {
    it('should reduce capacity for ineligible markets', () => {
      const market = { marketId: '0xineligible', effectiveCap: 100_000_000_000n };
      const isEligible = false;

      const result = scheduler.applyColdStartConstraints(market, isEligible);

      // 50% of original capacity (coldStartCapacityFactor = 0.5)
      expect(result.effectiveCap).toBe(50_000_000_000n);
      expect(result.coldStartApplied).toBe(true);
      expect(result.marketId).toBe('0xineligible');
    });

    it('should not reduce capacity for eligible markets', () => {
      const market = { marketId: '0xeligible', effectiveCap: 100_000_000_000n };
      const isEligible = true;

      const result = scheduler.applyColdStartConstraints(market, isEligible);

      expect(result.effectiveCap).toBe(100_000_000_000n);
      expect(result.coldStartApplied).toBe(false);
      expect(result.marketId).toBe('0xeligible');
    });

    it('should preserve original marketId', () => {
      const market = { marketId: '0xmarket123', effectiveCap: 1_000_000_000n };
      const isEligible = false;

      const result = scheduler.applyColdStartConstraints(market, isEligible);

      expect(result.marketId).toBe('0xmarket123');
    });

    it('should handle zero effectiveCap', () => {
      const market = { marketId: '0xzero', effectiveCap: 0n };
      const isEligible = false;

      const result = scheduler.applyColdStartConstraints(market, isEligible);

      expect(result.effectiveCap).toBe(0n);
      expect(result.coldStartApplied).toBe(true);
    });

    it('should handle non-divisible capacities correctly', () => {
      // 100 with 0.5 factor should give 50
      const market = { marketId: '0xtest', effectiveCap: 101n };
      const isEligible = false;

      const result = scheduler.applyColdStartConstraints(market, isEligible);

      // 101 * 50 / 100 = 50.5 -> 50
      expect(result.effectiveCap).toBe(50n);
    });

    it('should respect custom coldStartCapacityFactor from config', () => {
      const customConfig: SchedulerConfig = {
        ...defaultConfig,
        coldStartCapacityFactor: 0.25, // 25%
      };
      const customScheduler = new Scheduler(
        mockCollector,
        mockPrisma,
        customConfig,
        '0x0000000000000000000000000000000000000001'
      );

      const market = { marketId: '0xtest', effectiveCap: 100_000_000_000n };
      const result = customScheduler.applyColdStartConstraints(market, false);

      expect(result.effectiveCap).toBe(25_000_000_000n);
      expect(result.coldStartApplied).toBe(true);
    });
  });

  describe('getRegimeTracker', () => {
    it('should return null when WithdrawalTracker does not expose regimeTracker', () => {
      const regimeTracker = scheduler.getRegimeTracker();
      expect(regimeTracker).toBeNull();
    });
  });
});
