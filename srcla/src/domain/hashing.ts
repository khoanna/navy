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

/**
 * §10.2 - the decision content hash covers code commit, policy version, model
 * artifact, configuration digest, snapshot, candidates, target, reserve, costs
 * and reasons. The v1 helper above (`computeDecisionHash`) is retained only
 * for reading legacy rows that were hashed with it; every new decision uses
 * this v2 shape via `policy/decide.ts#decide`.
 */
export function computeDecisionHashV2(parts: {
  codeCommit: string;
  policyVersion: number;
  artifactHash: string;
  configDigest: string;
  snapshotHash: string;
  originSeconds: number;
  admissionReasons: unknown;
  /** The simulated RateCurve[] the optimiser actually searched over - the
   *  "candidates" paper §10.2 requires the hash to cover. `lowerBounds`
   *  alone is not a faithful proxy: it is evaluated at each market's
   *  CURRENT position (a forecast.ts diagnostic choice), not at the
   *  candidate allocations the optimiser explored, so a curve change that
   *  happens not to move target/reserve/costs/reasons would otherwise be
   *  invisible to the hash. */
  curves: unknown;
  lowerBounds: unknown;
  reserve: unknown;
  target: unknown;
  enumeration: unknown;
  costs: unknown;
  reasons: unknown;
}): string {
  return hashData(parts);
}
