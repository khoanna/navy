/**
 * Manifest Verifier
 *
 * Verifies manifest integrity and correctness for reproducibility.
 */
import type { EvaluationManifest } from './types.js';
import { computeContentHash, computeDatasetHash } from './generator.js';

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
 * Verify an evaluation manifest
 *
 * Checks:
 * - Required fields are present
 * - Dates are valid
 * - Calibration windows are sequential and non-overlapping
 * - Held-out windows are valid
 * - Policy requirements are met
 * - Cost parameters are reasonable
 * - Content hashes match
 *
 * @param manifest - The manifest to verify
 * @returns Verification result with any errors or warnings
 *
 * @example
 * ```typescript
 * const result = await verifyManifest(manifest);
 * if (!result.valid) {
 *   console.error('Manifest invalid:', result.errors);
 * }
 * ```
 */
export async function verifyManifest(manifest: EvaluationManifest): Promise<VerificationResult> {
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

  // Compute and verify content hash
  const computedHash = computeContentHash(manifest);
  if (manifest.contentHashes.manifest && manifest.contentHashes.manifest !== computedHash) {
    errors.push('Manifest content hash mismatch - manifest may have been tampered with');
  }

  // Verify dataset hash
  const computedDatasetHash = computeDatasetHash(manifest);
  if (manifest.contentHashes.dataset && manifest.contentHashes.dataset !== computedDatasetHash) {
    errors.push('Dataset hash mismatch');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Verify content hash only (synchronous, for quick checks)
 */
export function verifyContentHash(manifest: EvaluationManifest): boolean {
  const computed = computeContentHash(manifest);
  return manifest.contentHashes.manifest === computed;
}

/**
 * Verify dataset hash only (synchronous, for quick checks)
 */
export function verifyDatasetHash(manifest: EvaluationManifest): boolean {
  const computed = computeDatasetHash(manifest);
  return manifest.contentHashes.dataset === computed;
}
