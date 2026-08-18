/**
 * Manifest Generator
 *
 * Generates evaluation manifests from configuration for reproducibility.
 */
import { createHash } from 'crypto';
import type { EvaluationManifest, ManifestConfig } from './types.js';

/**
 * Generate a manifest ID
 */
function generateManifestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `manifest-${timestamp}-${random}`;
}

/**
 * Generate an evaluation manifest from configuration
 *
 * @param config - Configuration for the manifest
 * @returns A complete evaluation manifest
 *
 * @example
 * ```typescript
 * const manifest = generateManifest({
 *   version: '1.0.0',
 *   dataset: {
 *     startDate: new Date('2026-01-01'),
 *     endDate: new Date('2026-08-01'),
 *     snapshotCadenceMinutes: 15,
 *     marketIds: ['aave', 'compound'],
 *   },
 *   calibrationWindows: [...],
 *   vaultTiers: ['10000', '100000'],
 *   markets: { ... },
 *   costs: { ... },
 *   baselines: ['b0', 'b1', 'b2'],
 *   ablations: ['h1', 'h2'],
 *   srclaEnabled: true,
 * });
 * ```
 */
export function generateManifest(config: ManifestConfig): EvaluationManifest {
  const now = new Date();

  return {
    id: generateManifestId(),
    version: config.version,
    createdAt: now.toISOString(),

    dataset: {
      startDate: config.dataset.startDate.toISOString(),
      endDate: config.dataset.endDate.toISOString(),
      snapshotCadenceMinutes: config.dataset.snapshotCadenceMinutes,
      marketIds: config.dataset.marketIds,
    },

    calibration: {
      windows: config.calibrationWindows.map(w => ({
        startDate: w.startDate.toISOString(),
        endDate: w.endDate.toISOString(),
        heldOutStart: w.heldOutStart.toISOString(),
        heldOutEnd: w.heldOutEnd.toISOString(),
      })),
    },

    vaultTiers: config.vaultTiers,

    policies: config.policies,

    markets: config.markets,

    costs: {
      l2GasPrice: config.costs.l2GasPrice.toString(),
      l1GasPrice: config.costs.l1GasPrice.toString(),
      ethPrice: config.costs.ethPrice.toString(),
      slippageBps: config.costs.slippageBps,
      mevBps: config.costs.mevBps,
    },

    contentHashes: {
      manifest: '', // Computed after
      dataset: '',
      codeCommit: config.codeCommit ?? 'unknown',
    },
  };
}

/**
 * Compute content hash for a manifest
 *
 * Computes SHA-256 hash of the canonical manifest content for
 * tamper detection and reproducibility verification.
 *
 * @param manifest - The manifest to hash
 * @returns SHA-256 hex string
 */
export function computeContentHash(manifest: EvaluationManifest): string {
  const content = JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    dataset: manifest.dataset,
    calibration: manifest.calibration,
    vaultTiers: manifest.vaultTiers,
    policies: manifest.policies,
    markets: manifest.markets,
    costs: manifest.costs,
  });

  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute dataset hash from date range and market IDs
 */
export function computeDatasetHash(manifest: EvaluationManifest): string {
  const content = JSON.stringify({
    startDate: manifest.dataset.startDate,
    endDate: manifest.dataset.endDate,
    marketIds: manifest.dataset.marketIds,
    snapshotCadenceMinutes: manifest.dataset.snapshotCadenceMinutes,
  });

  return createHash('sha256').update(content).digest('hex');
}

/**
 * Fill in content hashes for a manifest
 *
 * @param manifest - The manifest to sign
 * @returns Manifest with filled content hashes
 */
export function signManifest(manifest: EvaluationManifest): EvaluationManifest {
  const datasetHash = computeDatasetHash(manifest);
  const manifestHash = computeContentHash(manifest);

  return {
    ...manifest,
    contentHashes: {
      manifest: manifestHash,
      dataset: datasetHash,
      codeCommit: manifest.contentHashes.codeCommit,
    },
  };
}
