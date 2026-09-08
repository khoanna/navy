/**
 * Manifest Verifier
 *
 * Verifies manifest integrity and correctness for reproducibility
 * (paper §2.2, Appendix C).
 *
 * ABSENCE IS FAILURE. The previous version guarded both hash checks with
 * `if (manifest.contentHashes.manifest && ...)`, and the generator emitted
 * `manifest: ''` — so an unsigned manifest skipped every integrity check and
 * came back `valid: true`. A manifest that pins nothing is not a valid
 * manifest; it is an unverifiable one. The same rule applies to the dataset
 * hash, to the recorded code commit, and to the observation series itself.
 */
import type { EvaluationManifest } from './types.js';
import {
  computeContentHash,
  computeDatasetHash,
  UNKNOWN_CODE_COMMIT,
  type DatasetObservations,
} from './generator.js';

/**
 * Result of manifest verification
 */
export interface VerificationResult {
  /** Whether the manifest is valid */
  valid: boolean;
  /** Errors found during verification */
  errors: string[];
  /** Warnings found during verification */
  warnings: string[];
}

/**
 * Verify an evaluation manifest.
 *
 * Checks:
 * - Required fields are present
 * - Dates are valid
 * - Calibration windows are sequential and non-overlapping
 * - Held-out windows are valid
 * - Policy requirements are met
 * - Cost parameters are reasonable
 * - The manifest is SIGNED, and both hashes match what the content and the
 *   observations recompute to
 * - The code commit was recorded
 *
 * @param manifest - The manifest to verify
 * @param observations - The observation series the manifest claims to pin.
 *   REQUIRED: without it the dataset hash cannot be recomputed, and a check
 *   that cannot be performed must not be reported as a check that passed.
 *
 * @example
 * ```typescript
 * const result = await verifyManifest(manifest, { snapshots: dataset.snapshots });
 * if (!result.valid) {
 *   console.error('Manifest invalid:', result.errors);
 * }
 * ```
 */
export async function verifyManifest(
  manifest: EvaluationManifest,
  observations: DatasetObservations,
): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Verify required fields
  if (!manifest.id) errors.push('Missing manifest id');
  if (!manifest.version) errors.push('Missing version');
  if (!manifest.createdAt) errors.push('Missing createdAt');

  // Verify dates are valid
  const startDate = new Date(manifest.dataset.startDate);
  const endDate = new Date(manifest.dataset.endDate);

  if (isNaN(startDate.getTime())) {
    errors.push('Invalid date format in dataset');
  }
  if (isNaN(endDate.getTime())) {
    errors.push('Invalid date format in dataset');
  }

  // Verify dataset date range
  if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && startDate >= endDate) {
    errors.push('Dataset startDate must be before endDate');
  }

  // Verify calibration windows are sequential and non-overlapping
  const windows = manifest.calibration.windows;
  for (let i = 1; i < windows.length; i++) {
    const prevEnd = new Date(windows[i - 1]!.heldOutEnd);
    const currStart = new Date(windows[i]!.startDate);

    if (currStart < prevEnd) {
      errors.push(`Calibration windows ${i} and ${i + 1} overlap`);
    }
  }

  // Verify no look-ahead between calibration and held-out
  for (const window of windows) {
    const heldOutStart = new Date(window.heldOutStart);
    const heldOutEnd = new Date(window.heldOutEnd);

    if (heldOutStart > heldOutEnd) {
      errors.push('Held-out window has invalid dates');
    }
  }

  // Verify held-out follows calibration end
  for (const window of windows) {
    const endDate = new Date(window.endDate);
    const heldOutStart = new Date(window.heldOutStart);

    if (heldOutStart < endDate) {
      errors.push('Held-out start must be >= calibration end');
    }
  }

  // Verify policy requirements
  if (manifest.policies.baselines.length === 0) {
    warnings.push('No baselines specified');
  }

  if (manifest.policies.ablations.length === 0) {
    warnings.push('No ablations specified');
  }

  // Verify cost parameters are reasonable
  const l2GasPrice = BigInt(manifest.costs.l2GasPrice);
  if (l2GasPrice > 1_000_000_000_000_000_000n) { // > 1000 gwei
    warnings.push('L2 gas price seems unusually high');
  }

  const ethPrice = BigInt(manifest.costs.ethPrice);
  if (ethPrice > 1_000_000_000_000_000_000_000_000n) { // > $10M
    warnings.push('ETH price seems unusually high');
  }

  // The observation series must exist. Verifying a manifest against no data
  // recomputes a dataset hash over emptiness, which would "match" any
  // manifest signed over emptiness — absence agreeing with absence.
  if (observations.snapshots.length === 0) {
    errors.push('No observations supplied: the dataset hash cannot be verified against an empty series');
  }

  // The manifest must be SIGNED. An empty hash is a missing check, not a
  // passing one.
  if (!manifest.contentHashes.manifest) {
    errors.push('Manifest is unsigned: contentHashes.manifest is empty');
  } else if (manifest.contentHashes.manifest !== computeContentHash(manifest)) {
    errors.push('Manifest content hash mismatch - manifest may have been tampered with');
  }

  if (!manifest.contentHashes.dataset) {
    errors.push('Manifest is unsigned: contentHashes.dataset is empty');
  } else if (
    observations.snapshots.length > 0 &&
    manifest.contentHashes.dataset !== computeDatasetHash(manifest, observations)
  ) {
    errors.push('Dataset hash mismatch');
  }

  // §11.1 requires a result to be tied to the code that produced it.
  if (!manifest.contentHashes.codeCommit || manifest.contentHashes.codeCommit === UNKNOWN_CODE_COMMIT) {
    errors.push(`Code commit not recorded (got '${manifest.contentHashes.codeCommit}')`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Verify content hash only (synchronous, for quick checks).
 *
 * An unsigned manifest returns FALSE, not true.
 */
export function verifyContentHash(manifest: EvaluationManifest): boolean {
  if (!manifest.contentHashes.manifest) return false;
  return manifest.contentHashes.manifest === computeContentHash(manifest);
}

/**
 * Verify dataset hash only (synchronous, for quick checks).
 *
 * An unsigned manifest, or one checked against an empty observation series,
 * returns FALSE.
 */
export function verifyDatasetHash(
  manifest: EvaluationManifest,
  observations: DatasetObservations,
): boolean {
  if (!manifest.contentHashes.dataset) return false;
  if (observations.snapshots.length === 0) return false;
  return manifest.contentHashes.dataset === computeDatasetHash(manifest, observations);
}
