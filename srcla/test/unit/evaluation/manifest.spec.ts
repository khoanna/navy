/**
 * Manifest System Tests
 *
 * Tests for the evaluation manifest system per SRCLA design §12.
 */
import { generateManifest, computeContentHash, computeDatasetHash, signManifest } from '../../../src/evaluation/manifest/generator.js';
import { verifyManifest, verifyContentHash, verifyDatasetHash } from '../../../src/evaluation/manifest/verifier.js';

describe('Manifest System', () => {
  const validConfig = {
    version: '1.0.0',
    dataset: {
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-08-01'),
      snapshotCadenceMinutes: 15,
      marketIds: ['aave', 'compound'],
    },
    calibrationWindows: [
      {
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-01'),
        heldOutStart: new Date('2026-02-01'),
        heldOutEnd: new Date('2026-02-08'),
      },
      {
        startDate: new Date('2026-02-08'),
        endDate: new Date('2026-03-01'),
        heldOutStart: new Date('2026-03-01'),
        heldOutEnd: new Date('2026-03-08'),
      },
    ],
    vaultTiers: ['10000', '100000'],
    markets: {
      aave: { adapters: ['0x24d4173e6b9734a52c20190a9c5681ef350D8fE2'], coldStartDays: 7, minObservations: 30 },
      compound: { adapters: ['0x24d4173e6b9734a52c20190a9c5681ef350D8fE2'], coldStartDays: 0, minObservations: 14 },
    },
    costs: {
      l2GasPrice: '30000000000',
      l1GasPrice: '1000000000',
      ethPrice: '3500000000000',
      slippageBps: 5,
      mevBps: 5,
    },
    policies: {
      baselines: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'] as const,
      ablations: ['h1', 'h2', 'h3', 'h4', 'h5'] as const,
      srcla: true,
    },
    codeCommit: 'abc123',
  };

  describe('generateManifest', () => {
    it('should generate manifest with all required fields', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.id).toBeDefined();
      expect(manifest.id).toMatch(/^manifest-/);
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.createdAt).toBeDefined();
    });

    it('should include dataset configuration', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.dataset.startDate).toBe('2026-01-01T00:00:00.000Z');
      expect(manifest.dataset.endDate).toBe('2026-08-01T00:00:00.000Z');
      expect(manifest.dataset.snapshotCadenceMinutes).toBe(15);
      expect(manifest.dataset.marketIds).toEqual(['aave', 'compound']);
    });

    it('should include calibration windows', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.calibration.windows).toHaveLength(2);
      expect(manifest.calibration.windows[0]!.startDate).toBe('2026-01-01T00:00:00.000Z');
      expect(manifest.calibration.windows[0]!.heldOutEnd).toBe('2026-02-08T00:00:00.000Z');
    });

    it('should include vault tiers', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.vaultTiers).toEqual(['10000', '100000']);
    });

    it('should include policies with baselines and ablations', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.policies.baselines).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5']);
      expect(manifest.policies.ablations).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
      expect(manifest.policies.srcla).toBe(true);
    });

    it('should include market configurations', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.markets.aave).toBeDefined();
      expect(manifest.markets.aave!.adapters).toContain('0x24d4173e6b9734a52c20190a9c5681ef350D8fE2');
      expect(manifest.markets.aave!.coldStartDays).toBe(7);
    });

    it('should include cost parameters', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.costs.l2GasPrice).toBe('30000000000');
      expect(manifest.costs.l1GasPrice).toBe('1000000000');
      expect(manifest.costs.ethPrice).toBe('3500000000000');
      expect(manifest.costs.slippageBps).toBe(5);
      expect(manifest.costs.mevBps).toBe(5);
    });

    it('should include code commit from config', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.contentHashes.codeCommit).toBe('abc123');
    });

    it('should use unknown as default code commit', () => {
      const configWithoutCommit = { ...validConfig };
      delete (configWithoutCommit as { codeCommit?: string }).codeCommit;

      const manifest = generateManifest(configWithoutCommit);

      expect(manifest.contentHashes.codeCommit).toBe('unknown');
    });
  });

  describe('computeContentHash', () => {
    it('should compute SHA-256 hash', () => {
      const manifest = generateManifest(validConfig);
      const hash = computeContentHash(manifest);

      expect(hash).toBeDefined();
      expect(hash).toHaveLength(64); // SHA-256 hex
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should produce same hash for same manifest', () => {
      const manifest = generateManifest(validConfig);
      const hash1 = computeContentHash(manifest);
      const hash2 = computeContentHash(manifest);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', () => {
      const manifest1 = generateManifest(validConfig);

      const config2 = {
        ...validConfig,
        dataset: {
          ...validConfig.dataset,
          startDate: new Date('2026-02-01'),
        },
      };
      const manifest2 = generateManifest(config2);

      const hash1 = computeContentHash(manifest1);
      const hash2 = computeContentHash(manifest2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('computeDatasetHash', () => {
    it('should compute hash from dataset fields', () => {
      const manifest = generateManifest(validConfig);
      const hash = computeDatasetHash(manifest);

      expect(hash).toBeDefined();
      expect(hash).toHaveLength(64);
    });

    it('should produce same hash for same dataset', () => {
      const manifest1 = generateManifest(validConfig);
      const manifest2 = generateManifest(validConfig);

      expect(computeDatasetHash(manifest1)).toBe(computeDatasetHash(manifest2));
    });

    it('should produce different hash for different date ranges', () => {
      const manifest1 = generateManifest(validConfig);

      const config2 = {
        ...validConfig,
        dataset: {
          ...validConfig.dataset,
          endDate: new Date('2026-07-01'),
        },
      };
      const manifest2 = generateManifest(config2);

      expect(computeDatasetHash(manifest1)).not.toBe(computeDatasetHash(manifest2));
    });
  });

  describe('signManifest', () => {
    it('should fill in content hashes', () => {
      const unsigned = generateManifest(validConfig);
      expect(unsigned.contentHashes.manifest).toBe('');
      expect(unsigned.contentHashes.dataset).toBe('');

      const signed = signManifest(unsigned);

      expect(signed.contentHashes.manifest).toBeDefined();
      expect(signed.contentHashes.dataset).toBeDefined();
      expect(signed.contentHashes.manifest).toHaveLength(64);
      expect(signed.contentHashes.dataset).toHaveLength(64);
    });

    it('should preserve code commit', () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned);

      expect(signed.contentHashes.codeCommit).toBe('abc123');
    });
  });

  describe('verifyManifest', () => {
    it('should verify valid manifest', async () => {
      // Use single window config to avoid validation complexity
      const singleWindowConfig = {
        ...validConfig,
        calibrationWindows: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-02-01'),
            heldOutStart: new Date('2026-02-01'),
            heldOutEnd: new Date('2026-02-08'),
          },
        ],
      };
      const unsigned = generateManifest(singleWindowConfig);
      const signed = signManifest(unsigned);
      const result = await verifyManifest(signed);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing manifest id', async () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned);
      signed.id = '';

      const result = await verifyManifest(signed);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing manifest id');
    });

    it('should detect missing version', async () => {
      const unsigned = generateManifest({ ...validConfig, version: '' });
      const signed = signManifest(unsigned);

      const result = await verifyManifest(signed);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing version');
    });

    it('should detect invalid date format', async () => {
      const unsigned = generateManifest({
        ...validConfig,
        calibrationWindows: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-02-01'),
            heldOutStart: new Date('2026-02-01'),
            heldOutEnd: new Date('2026-02-08'),
          },
        ],
      });
      unsigned.dataset.startDate = 'invalid-date';

      const result = await verifyManifest(unsigned);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid date format in dataset');
    });

    it('should detect startDate >= endDate', async () => {
      const config = {
        ...validConfig,
        dataset: {
          ...validConfig.dataset,
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-01-01'),
        },
      };
      const unsigned = generateManifest(config);

      const result = await verifyManifest(unsigned);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Dataset startDate must be before endDate');
    });

    it('should detect overlapping calibration windows', async () => {
      const config = {
        ...validConfig,
        calibrationWindows: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-02-01'),
            heldOutStart: new Date('2026-02-01'),
            heldOutEnd: new Date('2026-02-08'),
          },
          {
            startDate: new Date('2026-02-05'), // Overlaps with previous held-out
            endDate: new Date('2026-03-01'),
            heldOutStart: new Date('2026-03-01'),
            heldOutEnd: new Date('2026-03-08'),
          },
        ],
      };
      const unsigned = generateManifest(config);

      const result = await verifyManifest(unsigned);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('overlap'))).toBe(true);
    });

    it('should detect invalid held-out window', async () => {
      const config = {
        ...validConfig,
        calibrationWindows: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-02-01'),
            heldOutStart: new Date('2026-02-08'),
            heldOutEnd: new Date('2026-02-01'), // Invalid: end before start
          },
        ],
      };
      const unsigned = generateManifest(config);

      const result = await verifyManifest(unsigned);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Held-out window'))).toBe(true);
    });

    it('should detect tampered content hash', async () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned);
      signed.contentHashes.manifest = 'tampered-hash';

      const result = await verifyManifest(signed);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('hash mismatch'))).toBe(true);
    });

    it('should warn about empty baselines', async () => {
      const config = {
        ...validConfig,
        policies: {
          ...validConfig.policies,
          baselines: [],
        },
      };
      const unsigned = generateManifest(config);

      const result = await verifyManifest(unsigned);

      expect(result.warnings).toContain('No baselines specified');
    });

    it('should warn about empty ablations', async () => {
      const config = {
        ...validConfig,
        policies: {
          ...validConfig.policies,
          ablations: [],
        },
      };
      const unsigned = generateManifest(config);

      const result = await verifyManifest(unsigned);

      expect(result.warnings).toContain('No ablations specified');
    });

    it('should warn about unusually high gas price', async () => {
      const config = {
        ...validConfig,
        costs: {
          ...validConfig.costs,
          l2GasPrice: '2000000000000000000', // 2000 gwei
        },
      };
      const unsigned = generateManifest(config);

      const result = await verifyManifest(unsigned);

      expect(result.warnings).toContain('L2 gas price seems unusually high');
    });

    it('should detect held-out before calibration end', async () => {
      const config = {
        ...validConfig,
        calibrationWindows: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-02-01'),
            heldOutStart: new Date('2026-01-15'), // Before calibration end
            heldOutEnd: new Date('2026-02-08'),
          },
        ],
      };
      const unsigned = generateManifest(config);

      const result = await verifyManifest(unsigned);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Held-out start must be >='))).toBe(true);
    });
  });

  describe('verifyContentHash', () => {
    it('should return true for valid hash', () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned);

      expect(verifyContentHash(signed)).toBe(true);
    });

    it('should return false for tampered hash', () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned);
      signed.contentHashes.manifest = 'wrong-hash';

      expect(verifyContentHash(signed)).toBe(false);
    });
  });

  describe('verifyDatasetHash', () => {
    it('should return true for valid hash', () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned);

      expect(verifyDatasetHash(signed)).toBe(true);
    });

    it('should return false for tampered hash', () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned);
      signed.contentHashes.dataset = 'wrong-hash';

      expect(verifyDatasetHash(signed)).toBe(false);
    });
  });
});
