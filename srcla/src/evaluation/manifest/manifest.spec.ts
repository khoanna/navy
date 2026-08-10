import { createManifest, validateManifest, freezeManifest, thawManifest } from './types.js';

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

  describe('createManifest', () => {
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

  describe('validateManifest', () => {
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

  describe('freeze/thaw', () => {
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
});
