/**
 * Manifest Generator
 *
 * Generates evaluation manifests from configuration for reproducibility
 * (paper §2.2, §7.3, §11.1, Appendix C).
 *
 * Three properties this file did not previously have:
 *
 *  1. **The manifest id is content-derived.** It used to be
 *     `manifest-${Date.now()}-${Math.random()}`, and `computeContentHash`
 *     hashes the id — so two manifests generated from byte-identical
 *     configuration had different content hashes, and the hash could not
 *     certify anything about the configuration. §7.3 requires the registered
 *     artifact and its hash to be immutable; a clock- and RNG-derived hash is
 *     the opposite of that.
 *
 *  2. **The dataset hash hashes the dataset.** It used to hash only
 *     `{startDate, endDate, marketIds, snapshotCadenceMinutes}` — the window
 *     METADATA — so the entire observation series could be swapped for
 *     different numbers over the same window and the hash would not move.
 *     `computeDatasetHash` now requires the observations and folds a digest
 *     of every field of every snapshot into the result.
 *
 *  3. **Nothing here can produce an empty hash and call it signed.**
 *     `signManifest` requires the observations, and the verifier treats an
 *     empty hash as a failure rather than as a check to skip.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates are WAD.
 */
import { createHash } from 'crypto';
import { hashData } from '../../domain/hashing.js';
import type { TimeOrderedSnapshot } from '../dataset.js';
import type { WithdrawalObservation } from '../../policy/types.js';
import type { EvaluationManifest, ManifestConfig } from './types.js';

/**
 * The observation series a manifest claims to pin. This is the DATA, not the
 * window it was drawn from.
 */
export interface DatasetObservations {
  snapshots: readonly TimeOrderedSnapshot[];
  withdrawals?: readonly WithdrawalObservation[];
}

/** Marker for a manifest whose code commit was never recorded. Rejected by
 *  the verifier: an unrecorded commit means the result cannot be reproduced,
 *  which is a failure, not a default. */
export const UNKNOWN_CODE_COMMIT = 'unknown';

/**
 * SHA-256 over every field of every observation, in time order, with the
 * markets inside one snapshot sorted by id.
 *
 * Sorting within a snapshot makes the digest independent of the order the
 * database happened to return rows in — the same data always digests the
 * same — while any change to any VALUE moves the digest. Snapshot order
 * across time is content, so it is not sorted away.
 */
export function computeObservationDigest(observations: DatasetObservations): string {
  const byId = (a: { marketId: string }, b: { marketId: string }): number =>
    a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0;

  return hashData({
    snapshots: observations.snapshots.map((s) => ({
      timestamp: s.timestamp.toISOString(),
      blockHash: s.blockHash,
      markets: [...s.snapshots].sort(byId).map((m) => ({
        marketId: m.marketId,
        blockHash: m.blockHash,
        timestamp: m.timestamp.toISOString(),
        totalAssetsBase: m.totalAssetsBase.toString(),
        idleBase: m.idleBase.toString(),
        supplyRateE18: m.supplyRateE18.toString(),
        utilizationE18: m.utilizationE18.toString(),
        cashBase: m.cashBase.toString(),
        borrowsBase: m.borrowsBase.toString(),
        reservesBase: m.reservesBase.toString(),
        capBps: m.capBps,
        paused: m.paused,
        configDigest: m.configDigest,
      })),
    })),
    withdrawals: (observations.withdrawals ?? []).map((w) => ({
      timestampSeconds: w.timestampSeconds,
      assetsBase: w.assetsBase.toString(),
    })),
  });
}

/**
 * Manifest id, derived from the configuration itself.
 *
 * DETERMINISTIC by construction: the same registered configuration always
 * yields the same id, so `computeContentHash` (which covers the id) is
 * reproducible across runs and machines.
 */
export function generateManifestId(config: ManifestConfig): string {
  const digest = hashData({
    version: config.version,
    evaluationId: config.evaluationId ?? null,
    dataset: {
      startDate: config.dataset.startDate.toISOString(),
      endDate: config.dataset.endDate.toISOString(),
      snapshotCadenceMinutes: config.dataset.snapshotCadenceMinutes,
      marketIds: config.dataset.marketIds,
    },
    calibrationWindows: config.calibrationWindows.map((w) => ({
      startDate: w.startDate.toISOString(),
      endDate: w.endDate.toISOString(),
      heldOutStart: w.heldOutStart.toISOString(),
      heldOutEnd: w.heldOutEnd.toISOString(),
    })),
    vaultTiers: config.vaultTiers,
    policies: config.policies,
    markets: config.markets,
    costs: config.costs,
    codeCommit: config.codeCommit ?? UNKNOWN_CODE_COMMIT,
  });
  return `manifest-${digest.slice(0, 32)}`;
}

/**
 * Generate an evaluation manifest from configuration.
 *
 * The returned manifest is UNSIGNED: both content hashes are empty strings.
 * `verifyManifest` fails an unsigned manifest — call `signManifest` with the
 * observations before treating it as evidence of anything.
 *
 * @example
 * ```typescript
 * const manifest = signManifest(generateManifest(config), { snapshots, withdrawals });
 * ```
 */
export function generateManifest(config: ManifestConfig): EvaluationManifest {
  return {
    id: generateManifestId(config),
    version: config.version,
    createdAt: new Date().toISOString(),

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
      manifest: '', // filled by signManifest
      dataset: '',  // filled by signManifest, from the observations
      codeCommit: config.codeCommit ?? UNKNOWN_CODE_COMMIT,
    },
  };
}

/**
 * Compute content hash for a manifest.
 *
 * Covers `createdAt` deliberately NOT at all: a wall-clock stamp would make
 * the hash differ between two runs over the same registered configuration.
 * The id it does cover is content-derived (see `generateManifestId`).
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
    codeCommit: manifest.contentHashes.codeCommit,
    dataset_hash: manifest.contentHashes.dataset,
  });

  return createHash('sha256').update(content).digest('hex');
}

/**
 * Hash of the dataset a manifest pins: the declared window AND the actual
 * observation series drawn from it.
 *
 * `observations` is REQUIRED. The previous signature took only the manifest
 * and hashed four metadata fields, so swapping the entire series left the
 * hash unchanged and the manifest could not detect a dataset mismatch —
 * which is the one thing a dataset hash exists to do.
 */
export function computeDatasetHash(
  manifest: EvaluationManifest,
  observations: DatasetObservations,
): string {
  const content = JSON.stringify({
    startDate: manifest.dataset.startDate,
    endDate: manifest.dataset.endDate,
    marketIds: manifest.dataset.marketIds,
    snapshotCadenceMinutes: manifest.dataset.snapshotCadenceMinutes,
    observations: computeObservationDigest(observations),
  });

  return createHash('sha256').update(content).digest('hex');
}

/**
 * Fill in content hashes for a manifest.
 *
 * The dataset hash is computed FROM THE OBSERVATIONS, so a signed manifest
 * commits to the data and not merely to the window. The manifest hash is
 * computed last, over a body that already carries the dataset hash, so
 * tampering with either is detectable.
 *
 * @throws if `observations.snapshots` is empty — signing a manifest over no
 *   data would produce a hash that certifies nothing while looking valid.
 */
export function signManifest(
  manifest: EvaluationManifest,
  observations: DatasetObservations,
): EvaluationManifest {
  if (observations.snapshots.length === 0) {
    throw new Error(
      'signManifest: refusing to sign a manifest over an empty observation series. ' +
        'An empty dataset hash certifies nothing; collect a dataset first.',
    );
  }

  const withDataset: EvaluationManifest = {
    ...manifest,
    contentHashes: {
      manifest: '',
      dataset: computeDatasetHash(manifest, observations),
      codeCommit: manifest.contentHashes.codeCommit,
    },
  };

  return {
    ...withDataset,
    contentHashes: {
      ...withDataset.contentHashes,
      manifest: computeContentHash(withDataset),
    },
  };
}
