import { createHash } from 'crypto';

/**
 * Create canonical JSON string for hashing
 */
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean' || typeof obj === 'number' || typeof obj === 'bigint') return String(obj);
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map((k) => `"${k}":${canonicalize((obj as Record<string, unknown>)[k])}`);
    return '{' + pairs.join(',') + '}';
  }
  throw new Error(`Cannot canonicalize type: ${typeof obj}`);
}

/**
 * Compute SHA-256 hash of canonical JSON
 */
export function hashData(obj: unknown): string {
  const canonical = canonicalize(obj);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute decision hash from inputs
 */
export function computeDecisionHash(inputs: {
  policyVersion: string;
  snapshotHash: string;
  timestamp: Date;
  admissions: unknown[];
  forecasts: unknown[];
  allocation: unknown;
}): string {
  return hashData({ ...inputs, timestamp: inputs.timestamp.toISOString() });
}

/**
 * Compute snapshot hash
 */
export function computeSnapshotHash(snapshot: {
  marketId: string;
  blockHash: string;
  timestamp: Date;
  totalAssetsBase: string;
  supplyRateE18: string;
  utilizationE18: string;
}): string {
  return hashData({ ...snapshot, timestamp: snapshot.timestamp.toISOString() });
}
