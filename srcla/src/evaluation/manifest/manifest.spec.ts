import { createManifest, validateManifest, freezeManifest, thawManifest } from './types.js';
import {
  createEvaluationManifest,
  freezeEvaluationManifest,
  thawEvaluationManifest,
  validateManifest as validateFullManifest,
  setResultsHash,
  getCodeCommitHash,
  getDatasetHash,
  getConfigHash,
  getResultsHash,
  exportArtifactHashes,
} from './manifest.js';

describe('EvaluationManifest', () => {
  const validConfig = {
    evaluationId: 'eval-001',
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-12-31'),
    forecastMethod: { method: 'rolling' as const, config: { windowDays: 30 } },
    horizons: [86400],
    tiers: [10_000_000_000n],
    coverageTarget: 0.95,
    significanceLevel: 0.05,
  };

  describe('createManifest (legacy types.js)', () => {
    it('should create manifest with all baselines', () => {
      const manifest = createManifest(validConfig);
      expect(manifest.baselines).toContain('b0');
      expect(manifest.baselines).toContain('b5');
      expect(manifest.baselines).toHaveLength(6);
    });

    it('should create manifest with all ablations', () => {
      const manifest = createManifest(validConfig);
      expect(manifest.ablations).toContain('h1');
      expect(manifest.ablations).toContain('h5');
      expect(manifest.ablations).toHaveLength(5);
    });
  });

  describe('validateManifest (legacy types.js)', () => {
    it('should accept valid manifest', () => {
      expect(() => validateManifest(validConfig)).not.toThrow();
    });

    it('should reject empty evaluationId', () => {
      const bad = { ...validConfig, evaluationId: '' };
      expect(() => validateManifest(bad)).toThrow('evaluationId');
    });

    it('should reject startDate >= endDate', () => {
      const bad = { ...validConfig, startDate: new Date('2026-01-01'), endDate: new Date('2025-01-01') };
      expect(() => validateManifest(bad)).toThrow('startDate');
    });

    it('should reject zero horizon', () => {
      const bad = { ...validConfig, horizons: [0] };
      expect(() => validateManifest(bad)).toThrow('horizons');
    });

    it('should reject empty tiers', () => {
      const bad = { ...validConfig, tiers: [] };
      expect(() => validateManifest(bad)).toThrow(/tier/i);
    });
  });

  describe('freeze/thaw (legacy types.js)', () => {
    it('should round-trip through freeze/thaw', () => {
      const manifest = createManifest(validConfig);
      const frozen = freezeManifest(manifest);
      const thawed = thawManifest(frozen);

      expect(thawed.evaluationId).toBe(manifest.evaluationId);
      expect(thawed.tiers[0]).toBe(manifest.tiers[0]);
      expect(thawed.coverageTarget).toBe(manifest.coverageTarget);
    });

    it('should include frozenAt timestamp', () => {
      const manifest = createManifest(validConfig);
      const frozen = JSON.parse(freezeManifest(manifest)) as { frozenAt?: string };
      expect(frozen.frozenAt).toBeDefined();
    });
  });

  // ===========================================================================
  // §11 Artifact Hash Tests
  // ===========================================================================

  describe('createEvaluationManifest (full §11 manifest)', () => {
    it('should create manifest with artifact hashes', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(manifest.artifactHashes).toBeDefined();
      expect(manifest.artifactHashes.codeCommit).toBeTruthy();
      expect(manifest.artifactHashes.datasetHash).toBeTruthy();
      expect(manifest.artifactHashes.configHash).toBeTruthy();
    });

    it('should generate different dataset hashes for different date ranges', () => {
      const manifest1 = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-06-30'),
        },
      });

      const manifest2 = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(manifest1.artifactHashes.datasetHash).not.toBe(manifest2.artifactHashes.datasetHash);
    });

    it('should generate different config hashes for different configurations', () => {
      const manifest1 = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
        costModel: { minActionAmount: 1_000_000n },
      });

      const manifest2 = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
        costModel: { minActionAmount: 10_000_000n },
      });

      expect(manifest1.artifactHashes.configHash).not.toBe(manifest2.artifactHashes.configHash);
    });

    it('should include codeCommit from environment', () => {
      const originalCommit = process.env.GIT_COMMIT_HASH;
      process.env.GIT_COMMIT_HASH = 'abc123def456';

      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(manifest.artifactHashes.codeCommit).toBe('abc123def456');
      expect(manifest.execution.codeCommit).toBe('abc123def456');

      if (originalCommit !== undefined) {
        process.env.GIT_COMMIT_HASH = originalCommit;
      }
    });

    it('should set resultsHash to undefined initially', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(manifest.artifactHashes.resultsHash).toBeUndefined();
    });

    it('should compute content hash', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(manifest.contentHash).toBeTruthy();
      expect(manifest.contentHash).toHaveLength(64); // SHA-256 hex
    });
  });

  describe('freezeEvaluationManifest / thawEvaluationManifest', () => {
    it('should round-trip with artifact hashes', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const frozen = freezeEvaluationManifest(manifest);
      const thawed = thawEvaluationManifest(frozen);

      expect(thawed.artifactHashes.codeCommit).toBe(manifest.artifactHashes.codeCommit);
      expect(thawed.artifactHashes.datasetHash).toBe(manifest.artifactHashes.datasetHash);
      expect(thawed.artifactHashes.configHash).toBe(manifest.artifactHashes.configHash);
    });

    it('should preserve resultsHash through freeze/thaw', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const withResults = setResultsHash(manifest, 'results-hash-abc123');
      const frozen = freezeEvaluationManifest(withResults);
      const thawed = thawEvaluationManifest(frozen);

      expect(thawed.artifactHashes.resultsHash).toBe('results-hash-abc123');
    });

    it('should detect tampered content', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const frozen = freezeEvaluationManifest(manifest);
      const parsed = JSON.parse(frozen);
      parsed.dataset.endDate = '2026-12-31T00:00:00.000Z'; // Tamper with data
      const tampered = JSON.stringify(parsed);

      expect(() => thawEvaluationManifest(tampered)).toThrow('Manifest hash mismatch');
    });
  });

  describe('setResultsHash', () => {
    it('should set results hash and recompute content hash', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const originalContentHash = manifest.contentHash;
      const withResults = setResultsHash(manifest, 'results-hash-xyz789');

      expect(withResults.artifactHashes.resultsHash).toBe('results-hash-xyz789');
      expect(withResults.contentHash).not.toBe(originalContentHash);
    });
  });

  describe('Artifact hash accessor functions', () => {
    it('getCodeCommitHash should return code commit', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(getCodeCommitHash(manifest)).toBe(manifest.artifactHashes.codeCommit);
    });

    it('getDatasetHash should return dataset hash', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(getDatasetHash(manifest)).toBe(manifest.artifactHashes.datasetHash);
    });

    it('getConfigHash should return config hash', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(getConfigHash(manifest)).toBe(manifest.artifactHashes.configHash);
    });

    it('getResultsHash should return undefined before results are set', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      expect(getResultsHash(manifest)).toBeUndefined();
    });

    it('getResultsHash should return results hash after setting', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const withResults = setResultsHash(manifest, 'final-results-hash');
      expect(getResultsHash(withResults)).toBe('final-results-hash');
    });

    it('exportArtifactHashes should return copy of hashes', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const exported = exportArtifactHashes(manifest);
      expect(exported).toEqual(manifest.artifactHashes);
      expect(exported).not.toBe(manifest.artifactHashes); // Should be a copy
    });
  });

  describe('validateFullManifest', () => {
    it('should validate manifest with all required fields', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const result = validateFullManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate artifact hashes are present', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const result = validateFullManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('should fail validation when content hash is wrong', () => {
      const manifest = createEvaluationManifest({
        dataset: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        },
      });

      const tampered = { ...manifest, contentHash: 'wrong-hash' };
      const result = validateFullManifest(tampered);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('hash mismatch'))).toBe(true);
    });
  });
});
