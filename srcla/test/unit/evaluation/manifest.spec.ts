/**
 * Manifest System Tests — paper §2.2, §7.3, §11.1, Appendix C.
 *
 * These cover the three integrity defects the 2026-09-08 readiness audit
 * found in NEW-21, so each is written so that reverting the production fix
 * makes it fail:
 *
 *  - the manifest id (and therefore the content hash) was clock- and
 *    RNG-derived, so no two runs over the same configuration agreed;
 *  - the dataset hash never touched a snapshot, so swapping the whole
 *    observation series left it unchanged;
 *  - an EMPTY hash skipped the check and verified clean.
 */
import {
  generateManifest,
  generateManifestId,
  computeContentHash,
  computeDatasetHash,
  computeObservationDigest,
  signManifest,
  UNKNOWN_CODE_COMMIT,
  type DatasetObservations,
} from '../../../src/evaluation/manifest/generator.js';
import {
  verifyManifest,
  verifyContentHash,
  verifyDatasetHash,
} from '../../../src/evaluation/manifest/verifier.js';
import type { TimeOrderedSnapshot } from '../../../src/evaluation/dataset.js';
import type { MarketSnapshot } from '../../../src/domain/snapshots.js';

function market(marketId: string, timestamp: Date, supplyRateE18: bigint): MarketSnapshot {
  return {
    marketId,
    blockHash: '0x' + 'b'.repeat(64),
    timestamp,
    totalAssetsBase: 1_000_000_000_000n,
    idleBase: 100_000_000_000n,
    supplyRateE18,
    utilizationE18: 800_000_000_000_000_000n,
    cashBase: 200_000_000_000n,
    borrowsBase: 800_000_000_000n,
    reservesBase: 10_000_000_000n,
    capBps: 5000,
    paused: false,
    configDigest: '0x' + 'a'.repeat(64),
  };
}

/** Two origins, two markets each; `rate` shifts every observation. */
function observations(rate = 50_000_000_000_000_000n): DatasetObservations {
  const snapshots: TimeOrderedSnapshot[] = [0, 1].map((i) => {
    const timestamp = new Date(Date.UTC(2026, 0, 1 + i));
    return {
      index: i,
      timestamp,
      blockHash: '0x' + i.toString(16).padStart(64, '0'),
      snapshots: [
        market('aave', timestamp, rate + BigInt(i)),
        market('compound', timestamp, rate + BigInt(i) + 1n),
      ],
    };
  });
  return { snapshots, withdrawals: [{ timestampSeconds: 1_767_225_600, assetsBase: 5_000_000n }] };
}

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

  /** One calibration window, so the sequencing rules are satisfied. */
  const singleWindowConfig = {
    ...validConfig,
    calibrationWindows: [validConfig.calibrationWindows[0]!],
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

      expect(manifest.contentHashes.codeCommit).toBe(UNKNOWN_CODE_COMMIT);
    });

    it('leaves the manifest UNSIGNED', () => {
      const manifest = generateManifest(validConfig);

      expect(manifest.contentHashes.manifest).toBe('');
      expect(manifest.contentHashes.dataset).toBe('');
    });
  });

  describe('generateManifestId', () => {
    // §7.3: the registered artifact and its hash are immutable. The id used
    // to be `manifest-${Date.now()}-${Math.random()}` and it is COVERED by
    // computeContentHash, so no two runs over identical configuration could
    // ever agree on a hash.
    it('is derived from the configuration, not from the clock or an RNG', () => {
      expect(generateManifestId(validConfig)).toBe(generateManifestId(validConfig));
    });

    it('differs when any configured value differs', () => {
      const other = { ...validConfig, vaultTiers: ['10000', '100000', '1000000'] };
      expect(generateManifestId(other)).not.toBe(generateManifestId(validConfig));
    });

    it('differs when only the code commit differs', () => {
      const other = { ...validConfig, codeCommit: 'def456' };
      expect(generateManifestId(other)).not.toBe(generateManifestId(validConfig));
    });
  });

  describe('computeObservationDigest', () => {
    it('changes when a single observed value changes', () => {
      const a = observations();
      const b = observations();
      b.snapshots[1]!.snapshots[0]!.supplyRateE18 += 1n;

      expect(computeObservationDigest(b)).not.toBe(computeObservationDigest(a));
    });

    it('changes when a withdrawal changes', () => {
      const a = observations();
      const b: DatasetObservations = {
        snapshots: observations().snapshots,
        withdrawals: [{ timestampSeconds: 1_767_225_600, assetsBase: 5_000_001n }],
      };

      expect(computeObservationDigest(b)).not.toBe(computeObservationDigest(a));
    });

    it('is independent of the order markets came back in within one snapshot', () => {
      const a = observations();
      const b = observations();
      b.snapshots[0]!.snapshots.reverse();

      expect(computeObservationDigest(b)).toBe(computeObservationDigest(a));
    });

    it('is NOT independent of time order across snapshots', () => {
      const a = observations();
      const b: DatasetObservations = { ...a, snapshots: [...observations().snapshots].reverse() };

      expect(computeObservationDigest(b)).not.toBe(computeObservationDigest(a));
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

    // Two SEPARATELY GENERATED manifests, not the same object twice: this is
    // what a reproducibility claim actually needs, and what the RNG-derived
    // id made impossible.
    it('agrees across two independent generations of the same configuration', () => {
      expect(computeContentHash(generateManifest(validConfig))).toBe(
        computeContentHash(generateManifest(validConfig)),
      );
    });

    it('should produce different hash for different content', () => {
      const manifest1 = generateManifest(validConfig);
      const manifest2 = generateManifest({
        ...validConfig,
        dataset: { ...validConfig.dataset, startDate: new Date('2026-02-01') },
      });

      expect(computeContentHash(manifest1)).not.toBe(computeContentHash(manifest2));
    });

    it('covers the dataset hash, so a re-signed manifest over other data hashes differently', () => {
      const base = generateManifest(singleWindowConfig);
      const one = signManifest(base, observations());
      const two = signManifest(base, observations(60_000_000_000_000_000n));

      expect(computeContentHash(one)).not.toBe(computeContentHash(two));
    });
  });

  describe('computeDatasetHash', () => {
    it('should compute hash from dataset window and observations', () => {
      const manifest = generateManifest(validConfig);
      const hash = computeDatasetHash(manifest, observations());

      expect(hash).toHaveLength(64);
    });

    it('should produce same hash for same window and same observations', () => {
      expect(computeDatasetHash(generateManifest(validConfig), observations())).toBe(
        computeDatasetHash(generateManifest(validConfig), observations()),
      );
    });

    it('should produce different hash for different date ranges', () => {
      const manifest1 = generateManifest(validConfig);
      const manifest2 = generateManifest({
        ...validConfig,
        dataset: { ...validConfig.dataset, endDate: new Date('2026-07-01') },
      });

      expect(computeDatasetHash(manifest1, observations())).not.toBe(
        computeDatasetHash(manifest2, observations()),
      );
    });

    // THE NEW-21 defect: the old implementation hashed only the window
    // metadata, so the entire observation series could be replaced and the
    // hash would not move.
    it('changes when the observation series changes under an identical window', () => {
      const manifest = generateManifest(validConfig);

      expect(computeDatasetHash(manifest, observations(60_000_000_000_000_000n))).not.toBe(
        computeDatasetHash(manifest, observations()),
      );
    });
  });

  describe('signManifest', () => {
    it('should fill in content hashes', () => {
      const unsigned = generateManifest(validConfig);
      const signed = signManifest(unsigned, observations());

      expect(signed.contentHashes.manifest).toHaveLength(64);
      expect(signed.contentHashes.dataset).toHaveLength(64);
    });

    it('should preserve code commit', () => {
      const signed = signManifest(generateManifest(validConfig), observations());

      expect(signed.contentHashes.codeCommit).toBe('abc123');
    });

    it('signs the dataset hash from the observations it was given', () => {
      const unsigned = generateManifest(validConfig);

      expect(signManifest(unsigned, observations()).contentHashes.dataset).toBe(
        computeDatasetHash(unsigned, observations()),
      );
    });

    // Absence must fail: a hash over an empty series certifies nothing but
    // looks exactly like a hash over real data.
    it('refuses to sign over an empty observation series', () => {
      expect(() => signManifest(generateManifest(validConfig), { snapshots: [] })).toThrow(
        /empty observation series/,
      );
    });
  });

  describe('verifyManifest', () => {
    it('should verify a signed manifest against the data it pinned', async () => {
      const signed = signManifest(generateManifest(singleWindowConfig), observations());
      const result = await verifyManifest(signed, observations());

      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);
    });

    // THE absence-reads-as-success defect: `if (manifest.contentHashes.manifest && ...)`
    // skipped both checks on an unsigned manifest and returned valid: true.
    it('FAILS an unsigned manifest instead of skipping the check', async () => {
      const unsigned = generateManifest(singleWindowConfig);
      const result = await verifyManifest(unsigned, observations());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Manifest is unsigned: contentHashes.manifest is empty');
      expect(result.errors).toContain('Manifest is unsigned: contentHashes.dataset is empty');
    });

    it('FAILS when only the dataset hash is missing', async () => {
      const signed = signManifest(generateManifest(singleWindowConfig), observations());
      signed.contentHashes.dataset = '';

      const result = await verifyManifest(signed, observations());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Manifest is unsigned: contentHashes.dataset is empty');
    });

    it('FAILS when verification is attempted against no observations', async () => {
      const signed = signManifest(generateManifest(singleWindowConfig), observations());
      const result = await verifyManifest(signed, { snapshots: [] });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('No observations supplied'))).toBe(true);
    });

    // The point of hashing the data: a different series over the same window
    // must be detected.
    it('detects a swapped observation series over an identical window', async () => {
      const signed = signManifest(generateManifest(singleWindowConfig), observations());
      const result = await verifyManifest(signed, observations(60_000_000_000_000_000n));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Dataset hash mismatch');
    });

    it('detects a single changed observed value', async () => {
      const pinned = observations();
      const signed = signManifest(generateManifest(singleWindowConfig), pinned);

      const tampered = observations();
      tampered.snapshots[0]!.snapshots[1]!.cashBase += 1n;

      const result = await verifyManifest(signed, tampered);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Dataset hash mismatch');
    });

    it('FAILS when the code commit was never recorded', async () => {
      const noCommit = { ...singleWindowConfig };
      delete (noCommit as { codeCommit?: string }).codeCommit;
      const signed = signManifest(generateManifest(noCommit), observations());

      const result = await verifyManifest(signed, observations());

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Code commit not recorded'))).toBe(true);
    });

    it('should detect missing manifest id', async () => {
      const signed = signManifest(generateManifest(singleWindowConfig), observations());
      signed.id = '';

      const result = await verifyManifest(signed, observations());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing manifest id');
    });

    it('should detect missing version', async () => {
      const signed = signManifest(generateManifest({ ...singleWindowConfig, version: '' }), observations());

      const result = await verifyManifest(signed, observations());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing version');
    });

    it('should detect invalid date format', async () => {
      const unsigned = generateManifest(singleWindowConfig);
      unsigned.dataset.startDate = 'invalid-date';

      const result = await verifyManifest(unsigned, observations());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid date format in dataset');
    });

    it('should detect startDate >= endDate', async () => {
      const unsigned = generateManifest({
        ...singleWindowConfig,
        dataset: {
          ...singleWindowConfig.dataset,
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-01-01'),
        },
      });

      const result = await verifyManifest(unsigned, observations());

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Dataset startDate must be before endDate');
    });

    it('should detect overlapping calibration windows', async () => {
      const unsigned = generateManifest({
        ...validConfig,
        calibrationWindows: [
          validConfig.calibrationWindows[0]!,
          {
            startDate: new Date('2026-02-05'), // Overlaps with previous held-out
            endDate: new Date('2026-03-01'),
            heldOutStart: new Date('2026-03-01'),
            heldOutEnd: new Date('2026-03-08'),
          },
        ],
      });

      const result = await verifyManifest(unsigned, observations());

      expect(result.errors.some(e => e.includes('overlap'))).toBe(true);
    });

    it('should detect invalid held-out window', async () => {
      const unsigned = generateManifest({
        ...validConfig,
        calibrationWindows: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-02-01'),
            heldOutStart: new Date('2026-02-08'),
            heldOutEnd: new Date('2026-02-01'), // Invalid: end before start
          },
        ],
      });

      const result = await verifyManifest(unsigned, observations());

      expect(result.errors.some(e => e.includes('Held-out window'))).toBe(true);
    });

    it('should detect tampered content hash', async () => {
      const signed = signManifest(generateManifest(singleWindowConfig), observations());
      signed.contentHashes.manifest = 'tampered-hash';

      const result = await verifyManifest(signed, observations());

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('hash mismatch'))).toBe(true);
    });

    it('should warn about empty baselines', async () => {
      const unsigned = generateManifest({
        ...validConfig,
        policies: { ...validConfig.policies, baselines: [] },
      });

      const result = await verifyManifest(unsigned, observations());

      expect(result.warnings).toContain('No baselines specified');
    });

    it('should warn about empty ablations', async () => {
      const unsigned = generateManifest({
        ...validConfig,
        policies: { ...validConfig.policies, ablations: [] },
      });

      const result = await verifyManifest(unsigned, observations());

      expect(result.warnings).toContain('No ablations specified');
    });

    it('should warn about unusually high gas price', async () => {
      const unsigned = generateManifest({
        ...validConfig,
        costs: { ...validConfig.costs, l2GasPrice: '2000000000000000000' }, // 2000 gwei
      });

      const result = await verifyManifest(unsigned, observations());

      expect(result.warnings).toContain('L2 gas price seems unusually high');
    });

    it('should detect held-out before calibration end', async () => {
      const unsigned = generateManifest({
        ...validConfig,
        calibrationWindows: [
          {
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-02-01'),
            heldOutStart: new Date('2026-01-15'), // Before calibration end
            heldOutEnd: new Date('2026-02-08'),
          },
        ],
      });

      const result = await verifyManifest(unsigned, observations());

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Held-out start must be >='))).toBe(true);
    });
  });

  describe('verifyContentHash', () => {
    it('should return true for valid hash', () => {
      expect(verifyContentHash(signManifest(generateManifest(validConfig), observations()))).toBe(true);
    });

    it('should return false for tampered hash', () => {
      const signed = signManifest(generateManifest(validConfig), observations());
      signed.contentHashes.manifest = 'wrong-hash';

      expect(verifyContentHash(signed)).toBe(false);
    });

    it('should return FALSE for an unsigned manifest', () => {
      expect(verifyContentHash(generateManifest(validConfig))).toBe(false);
    });
  });

  describe('verifyDatasetHash', () => {
    it('should return true for valid hash against the pinned data', () => {
      const signed = signManifest(generateManifest(validConfig), observations());

      expect(verifyDatasetHash(signed, observations())).toBe(true);
    });

    it('should return false for tampered hash', () => {
      const signed = signManifest(generateManifest(validConfig), observations());
      signed.contentHashes.dataset = 'wrong-hash';

      expect(verifyDatasetHash(signed, observations())).toBe(false);
    });

    it('should return false against a different observation series', () => {
      const signed = signManifest(generateManifest(validConfig), observations());

      expect(verifyDatasetHash(signed, observations(60_000_000_000_000_000n))).toBe(false);
    });

    it('should return FALSE for an unsigned manifest', () => {
      expect(verifyDatasetHash(generateManifest(validConfig), observations())).toBe(false);
    });

    it('should return FALSE when checked against no observations', () => {
      const signed = signManifest(generateManifest(validConfig), observations());

      expect(verifyDatasetHash(signed, { snapshots: [] })).toBe(false);
    });
  });
});
