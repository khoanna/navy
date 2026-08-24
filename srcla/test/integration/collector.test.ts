/**
 * Collector Integration Tests
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { CollectorOrchestrator, type CollectorConfig } from '../../src/collector/orchestrator.js';

// Mock the database
jest.mock('../../src/db/client.js', () => {
  const mockPrisma = {
    chainBlock: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    marketSnapshot: {
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    withdrawalEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };

  return {
    getPrisma: () => mockPrisma,
    closePrisma: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockResolvedValue(true),
  };
});

// Mock the chain client
jest.mock('../../src/chain/client.js', () => {
  return {
    ChainClient: jest.fn().mockImplementation(() => ({
      getBlockNumber: jest.fn().mockResolvedValue(12345678),
      getBlock: jest.fn().mockResolvedValue({
        number: 12345678,
        hash: '0x1234567890abcdef',
        timestamp: BigInt(1234567890),
      }),
      getFinalizedBlock: jest.fn().mockResolvedValue({
        number: 12345678,
        hash: '0x1234567890abcdef',
        timestamp: BigInt(1234567890),
      }),
      getBalance: jest.fn().mockResolvedValue(BigInt(1000000000000)),
      call: jest.fn().mockResolvedValue('0x0'),
      getLogs: jest.fn().mockResolvedValue([]),
      chainId: 8453,
      close: jest.fn(),
    })),
  };
});

describe('CollectorOrchestrator', () => {
  let orchestrator: CollectorOrchestrator;
  const config: CollectorConfig = {
    vaultAddress: '0x1234567890123456789012345678901234567890',
    strategyAddresses: {
      aave: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      compound: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      moonwell: '0xcccccccccccccccccccccccccccccccccccccccc',
    },
    chainRpcUrl: 'http://localhost:8545',
    chainId: 8453,
  };

  beforeAll(() => {
    orchestrator = new CollectorOrchestrator(config);
  });

  afterAll(async () => {
    orchestrator.close();
  });

  describe('runCollectionCycle', () => {
    it('should run collection cycle successfully', async () => {
      const result = await orchestrator.runCollectionCycle();

      expect(result).toBeDefined();
      expect(result.blockNumber).toBe(12345678);
      expect(result.blockHash).toBe('0x1234567890abcdef');
      expect(Array.isArray(result.strategySnapshots)).toBe(true);
      expect(typeof result.withdrawalEvents).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return collection statistics', async () => {
      const stats = await orchestrator.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.lastBlock).toBe('number');
      expect(typeof stats.totalSnapshots).toBe('number');
      expect(typeof stats.totalWithdrawals).toBe('number');
      expect(stats.lastCollection === null || stats.lastCollection instanceof Date).toBe(true);
    });
  });
});
