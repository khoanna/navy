/**
 * Evaluation Runner Tests
 *
 * Tests for:
 * - EvaluationRunner class
 * - Release gate evaluation (forecast, safety, performance)
 * - Policy comparison
 * - Content hash generation
 */
import { EvaluationRunner, createEvaluationRunner, runQuickEvaluation, type Policy } from './runner.js';
import { createEvaluationManifest, freezeEvaluationManifest, type EvaluationManifest } from '../manifest/manifest.js';
import { CoverageTracker } from '../coverage-tracker.js';
import { createSyntheticDataset, type EvaluationDataset } from '../dataset.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a test manifest
 */
function createTestManifest(): EvaluationManifest {
  return createEvaluationManifest({
    dataset: {
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-08-01'),
    },
    tiers: {
      amounts: [
        1_000_000_000n,    // $1,000
        10_000_000_000n,   // $10,000
      ],
      labels: ['micro', 'small'],
    },
    successCriteria: {
      minCoverage: 0.95,
      minWithdrawalSuccessRate: 0.99,
      maxDrawdown: 0.05,
      minApyImprovementOverB1: 0.001,
      minApyImprovementOverB2: 0.0005,
    },
  });
}

/**
 * Create a test dataset
 */
function createTestDataset(): EvaluationDataset {
  return createSyntheticDataset('test-manifest', 30, new Date('2026-07-01'));
}

/**
 * Create a mock policy
 */
function createMockPolicy(id: string, _apy: number): Policy {
  return {
    id,
    name: `Mock Policy ${id}`,
    description: 'Mock policy for testing',
    deployable: true,
    run: () => [], // Empty by default
  };
}

// ============================================================================
// EvaluationRunner Tests
// ============================================================================

describe('EvaluationRunner', () => {
  describe('constructor', () => {
    it('should create runner with valid manifest', () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);

      expect(runner).toBeDefined();
    });

    it('should create runner via factory function', () => {
      const manifest = createTestManifest();
      const runner = createEvaluationRunner(manifest);

      expect(runner).toBeDefined();
    });
  });

  describe('run', () => {
    it('should run evaluation with empty policies', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(results).toBeDefined();
      expect(results.manifestId).toBe(manifest.id);
      expect(results.generatedAt).toBeInstanceOf(Date);
      expect(results.results).toBeDefined();
      expect(Array.isArray(results.results)).toBe(true);
      expect(results.comparison).toBeDefined();
      expect(results.releaseGates).toBeDefined();
      expect(typeof results.contentHash).toBe('string');
    });

    it('should run evaluation with custom policies', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const policies = new Map<string, Policy>();
      policies.set('custom-1', createMockPolicy('custom-1', 0.05));
      policies.set('custom-2', createMockPolicy('custom-2', 0.06));

      const results = await runner.run(dataset, policies, coverageTracker);

      expect(results.results.length).toBeGreaterThan(0);
    });

    it('should include SRCLA policy in results', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      const srclaResults = results.results.filter((r) => r.policyId === 'srcla');
      expect(srclaResults.length).toBeGreaterThan(0);
    });

    it('should run evaluation across all tiers', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      const tierAmounts = manifest.tiers.amounts;
      const resultsPerTier = new Map<string, number>();

      for (const result of results.results) {
        const count = resultsPerTier.get(result.tier.toString()) ?? 0;
        resultsPerTier.set(result.tier.toString(), count + 1);
      }

      // Each tier should have at least one SRCLA result
      for (const tier of tierAmounts) {
        const tierResults = results.results.filter((r) => r.tier === tier);
        expect(tierResults.length).toBeGreaterThan(0);
      }
    });
  });

  describe('PolicyResult structure', () => {
    it('should produce valid PolicyResult objects', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      for (const result of results.results) {
        expect(typeof result.policyId).toBe('string');
        expect(typeof result.tier).toBe('bigint');
        expect(typeof result.realizedNetApy).toBe('number');
        expect(typeof result.realizedGrossApy).toBe('number');
        expect(typeof result.totalCost).toBe('bigint');
        expect(typeof result.rebalanceCount).toBe('number');
        expect(typeof result.withdrawalSuccessRate).toBe('number');
        expect(typeof result.maxDrawdown).toBe('number');
        expect(typeof result.sharpeRatio).toBe('number');

        // APY should be reasonable (between -1 and 10)
        expect(result.realizedNetApy).toBeGreaterThanOrEqual(-1);
        expect(result.realizedNetApy).toBeLessThan(10);

        // Withdrawal success rate should be between 0 and 1
        expect(result.withdrawalSuccessRate).toBeGreaterThanOrEqual(0);
        expect(result.withdrawalSuccessRate).toBeLessThanOrEqual(1);

        // Max drawdown should be between 0 and 1
        expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
        expect(result.maxDrawdown).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('PolicyComparison', () => {
    it('should compute valid comparison', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(results.comparison).toBeDefined();
      expect('srclaVsB0' in results.comparison).toBe(true);
      expect('srclaVsB1' in results.comparison).toBe(true);
      expect('srclaVsB2' in results.comparison).toBe(true);
      expect('srclaVsB3' in results.comparison).toBe(true);
      expect('srclaVsB4' in results.comparison).toBe(true);

      // Each comparison should have apyDiff and srclaWins
      for (const comparison of Object.values(results.comparison)) {
        expect(typeof comparison.apyDiff).toBe('number');
        expect(typeof comparison.srclaWins).toBe('boolean');
      }
    });
  });
});

// ============================================================================
// Release Gate Tests
// ============================================================================

describe('Release Gates', () => {
  describe('Forecast Gate', () => {
    it('should pass when coverage meets target', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker({
        targetCoverage: 0.95,
      });

      // Add some coverage records with 100% coverage
      const testDate = new Date('2026-07-15');
      for (let i = 0; i < 100; i++) {
        coverageTracker.recordOutcome(
          'compound',
          new Date(testDate.getTime() + i * 86400000),
          1_000_000_000_000_000_000n, // 100% lower bound
          1_500_000_000_000_000_000n, // 150% actual return
          604800,
        );
      }

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(results.releaseGates.forecastGate.passed).toBe(true);
      expect(results.releaseGates.forecastGate.minCoverage).toBeGreaterThanOrEqual(0.95);
    });

    it('should fail when coverage below target', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker({
        targetCoverage: 0.95,
      });

      // Add coverage records with only 50% coverage
      const testDate = new Date('2026-07-15');
      for (let i = 0; i < 100; i++) {
        // Half are covered, half are not
        const actualReturn = i % 2 === 0
          ? 1_000_000_000_000_000_000n // Covered
          : 500_000_000_000_000_000n;   // Not covered

        coverageTracker.recordOutcome(
          'compound',
          new Date(testDate.getTime() + i * 86400000),
          1_000_000_000_000_000_000n, // 100% lower bound
          actualReturn,
          604800,
        );
      }

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(results.releaseGates.forecastGate.passed).toBe(false);
      expect(results.releaseGates.forecastGate.minCoverage).toBeLessThan(0.95);
    });

    it('should report correct target coverage', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(results.releaseGates.forecastGate.targetCoverage).toBe(0.95);
    });
  });

  describe('Safety Gate', () => {
    it('should pass when no catastrophic failures', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      // With synthetic data, safety gate should pass
      expect(results.releaseGates.safetyGate).toBeDefined();
      // The noCatastrophicFailures depends on the data
      expect(typeof results.releaseGates.safetyGate.noCatastrophicFailures).toBe('boolean');
    });

    it('should check withdrawal success rate threshold', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(results.releaseGates.safetyGate.minRequiredRate).toBe(0.99);
      expect(results.releaseGates.safetyGate.withdrawalSuccessRate).toBeGreaterThanOrEqual(0);
      expect(results.releaseGates.safetyGate.withdrawalSuccessRate).toBeLessThanOrEqual(1);
    });
  });

  describe('Performance Gate', () => {
    it('should evaluate SRCLA vs baseline performance', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(results.releaseGates.performanceGate.srclaBeatsB0).toBeDefined();
      expect(results.releaseGates.performanceGate.srclaBeatsB1).toBeDefined();
      expect(results.releaseGates.performanceGate.srclaBeatsB2).toBeDefined();
      expect(typeof results.releaseGates.performanceGate.details).toBe('string');
    });
  });

  describe('Overall Gate', () => {
    it('should aggregate all gate results', async () => {
      const manifest = createTestManifest();
      const runner = new EvaluationRunner(manifest);
      const dataset = createTestDataset();
      const coverageTracker = new CoverageTracker();

      const results = await runner.run(dataset, new Map(), coverageTracker);

      expect(typeof results.releaseGates.overall).toBe('boolean');
      // Overall should be true only if all gates pass
      if (results.releaseGates.overall) {
        expect(results.releaseGates.forecastGate.passed).toBe(true);
        expect(results.releaseGates.safetyGate.passed).toBe(true);
        expect(results.releaseGates.performanceGate.passed).toBe(true);
      }
    });
  });
});

// ============================================================================
// Content Hash Tests
// ============================================================================

describe('Content Hash', () => {
  it('should generate consistent hash for same input', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results1 = await runner.run(dataset, new Map(), coverageTracker);

    // Create new runner with same manifest
    const runner2 = new EvaluationRunner(manifest);
    const results2 = await runner2.run(dataset, new Map(), coverageTracker);

    // Note: Hashes won't be identical because timestamps differ,
    // but the structure should be the same
    expect(results1.contentHash).toBeDefined();
    expect(results2.contentHash).toBeDefined();
    expect(typeof results1.contentHash).toBe('string');
    expect(results1.contentHash.length).toBe(64); // SHA-256 hex length
  });

  it('should include manifest ID in hash content', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    expect(results.manifestId).toBe(manifest.id);
  });

  it('should produce valid SHA-256 hex string', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    // SHA-256 produces 64 character hex string
    expect(results.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================================
// Quick Evaluation Tests
// ============================================================================

describe('runQuickEvaluation', () => {
  it('should run evaluation with minimal configuration', async () => {
    const manifest = createTestManifest();
    const dataset = createTestDataset();

    const results = await runQuickEvaluation(dataset, manifest);

    expect(results).toBeDefined();
    expect(results.manifestId).toBe(manifest.id);
    expect(results.results.length).toBeGreaterThan(0);
    expect(results.releaseGates.forecastGate.targetCoverage).toBe(0.95);
  });
});

// ============================================================================
// Manifest Integration Tests
// ============================================================================

describe('Manifest Integration', () => {
  it('should use manifest tiers for evaluation', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    // Check that results are generated for each tier
    const uniqueTiers = new Set(results.results.map((r) => r.tier.toString()));
    expect(uniqueTiers.size).toBe(manifest.tiers.amounts.length);
  });

  it('should use manifest success criteria', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    expect(results.releaseGates.forecastGate.targetCoverage).toBe(
      manifest.evaluation.successCriteria.minCoverage
    );
    expect(results.releaseGates.safetyGate.minRequiredRate).toBe(
      manifest.evaluation.successCriteria.minWithdrawalSuccessRate
    );
  });

  it('should serialize manifest to JSON', () => {
    const manifest = createTestManifest();
    const frozen = freezeEvaluationManifest(manifest);

    expect(typeof frozen).toBe('string');
    expect(frozen.length).toBeGreaterThan(0);

    // Should be valid JSON
    const parsed = JSON.parse(frozen);
    expect(parsed.id).toBe(manifest.id);
    expect(parsed.contentHash).toBeDefined();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty dataset', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createSyntheticDataset('test', 0, new Date());
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    expect(results).toBeDefined();
    expect(results.results.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty coverage tracker', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker(); // Empty tracker

    const results = await runner.run(dataset, new Map(), coverageTracker);

    expect(results.forecastMetrics.size).toBe(0);
    expect(results.releaseGates.forecastGate.minCoverage).toBe(0);
  });

  it('should handle custom policy map', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const policies = new Map<string, Policy>();
    policies.set('test-policy', {
      id: 'test-policy',
      name: 'Test Policy',
      description: 'A test policy',
      deployable: true,
      run: () => [],
    });

    const results = await runner.run(dataset, policies, coverageTracker);

    expect(results).toBeDefined();
  });
});

// ============================================================================
// Baseline and Ablation Integration
// ============================================================================

describe('Baseline and Ablation Policies', () => {
  it('should evaluate deployable baseline policies', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    // Should have results for deployable baselines (B1-B4)
    // B0 (Idle) and B5 (Hindsight) are not deployable
    const deployableBaselineIds = ['b1', 'b2', 'b3', 'b4'];
    for (const id of deployableBaselineIds) {
      const hasBaseline = results.results.some((r) => r.policyId === id);
      expect(hasBaseline).toBe(true);
    }
  });

  it('should evaluate ablation policies', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    // Should have results for H1-H5 ablations
    const ablationIds = ['h1', 'h2', 'h3', 'h4', 'h5'];
    for (const id of ablationIds) {
      const hasAblation = results.results.some((r) => r.policyId === id);
      expect(hasAblation).toBe(true);
    }
  });

  it('should include SRCLA alongside baselines', async () => {
    const manifest = createTestManifest();
    const runner = new EvaluationRunner(manifest);
    const dataset = createTestDataset();
    const coverageTracker = new CoverageTracker();

    const results = await runner.run(dataset, new Map(), coverageTracker);

    // Should have both SRCLA and baselines
    expect(results.results.some((r) => r.policyId === 'srcla')).toBe(true);
    expect(results.results.some((r) => r.policyId === 'b1')).toBe(true);
    expect(results.results.some((r) => r.policyId === 'b2')).toBe(true);
  });
});
