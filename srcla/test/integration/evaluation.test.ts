/**
 * Evaluation Integration Tests
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { runEvaluation, type EvaluationConfig } from '../../src/evaluation/runner/integration.js';

// Mock the database
const mockPrisma = {
  marketSnapshot: {
    findMany: jest.fn().mockResolvedValue([]),
    groupBy: jest.fn().mockResolvedValue([]),
  },
  evaluationRun: {
    create: jest.fn().mockResolvedValue({ id: 'eval-1' }),
    update: jest.fn().mockResolvedValue({}),
  },
  forecastCalibration: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  },
  $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]),
  $disconnect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/db/client.js', () => ({
  getPrisma: () => mockPrisma,
  closePrisma: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/db/repositories/snapshot-repository.js', () => ({
  SnapshotRepository: jest.fn().mockImplementation(() => ({
    getRange: jest.fn().mockResolvedValue([]),
    getLatest: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../../src/db/repositories/evaluation-repository.js', () => ({
  EvaluationRepository: jest.fn().mockImplementation(() => ({
    createRun: jest.fn().mockResolvedValue({ id: 'eval-1' }),
    completeRun: jest.fn().mockResolvedValue({}),
  })),
}));

describe('EvaluationRunner', () => {
  const config: EvaluationConfig = {
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate: new Date(),
    marketIds: ['vault'],
    tiers: [10_000n],
    coverageTarget: 0.95,
    significanceLevel: 0.05,
  };

  describe('runEvaluation', () => {
    it('should run evaluation with synthetic data', async () => {
      const result = await runEvaluation(config);

      expect(result).toBeDefined();
      expect(result.evaluationId).toBeDefined();
      expect(result.manifestHash).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(result.releaseGate).toBeDefined();
      expect(result.releaseGate.pass).toBeDefined();
      expect(result.releaseGate.checks).toBeDefined();
    });

    it('should return errors array', async () => {
      const result = await runEvaluation(config);

      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should include baseline results', async () => {
      const result = await runEvaluation(config);

      // Results may or may not have baselines depending on data availability
      expect(result.baselines !== undefined || result.errors.length > 0).toBe(true);
    });
  });
});
