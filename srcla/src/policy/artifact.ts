import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashData } from '../domain/hashing.js';
import type { PolicyArtifact } from './types.js';

/**
 * §7.3 — the selected parameter artifact and its content hash are immutable for
 * held-out evaluation. Any change to a calibrated value changes the hash, so a
 * result can always be tied to the exact artifact that produced it.
 *
 * `hashData` canonicalises via `canonicalize` (src/domain/hashing.ts), which
 * sorts object keys before hashing, so this is stable under key reordering of
 * the input and only moves when a value itself changes.
 */
export function computeArtifactHash(a: Omit<PolicyArtifact, 'artifactHash'>): string {
  return hashData(a);
}

function need<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) {
    throw new Error(`bootstrap-artifact.json is missing required field '${field}'`);
  }
  return value;
}

function needBigInt(raw: unknown, field: string): bigint {
  const v = need(raw as string | undefined, field);
  // BigInt(undefined) throws "Cannot convert undefined to a BigInt", but a
  // JSON value that parsed to `null` or an empty string would otherwise slip
  // through as 0n — reject both explicitly so a malformed field fails loudly
  // instead of silently becoming zero.
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`bootstrap-artifact.json field '${field}' must be a non-empty numeric string, got ${JSON.stringify(v)}`);
  }
  return BigInt(v);
}

let cached: PolicyArtifact | null = null;

/**
 * PROVISIONAL. Phase 1 needs an artifact to run end to end; Phase 4's grid
 * sweep produces the real one. Results from this artifact are not citable —
 * `raw._provisional` carries that warning and is preserved on the returned
 * artifact rather than being dropped by the field-by-field JSON->PolicyArtifact
 * conversion below.
 *
 * KNOWN INTEGRATION GAP: this bootstrap ships `pinnedConfigDigests: {}`
 * (empty). `steps/admit.ts`'s CONFIG_DIGEST_UNPINNED rule rejects any market
 * whose id is absent from that map, so with this artifact as-is every market
 * is inadmissible and the kernel produces an empty eligible set end to end.
 * That is correct-by-design for a placeholder (the real digests are only
 * knowable against a live deployment) but it means a later end-to-end task
 * MUST populate `pinnedConfigDigests` from chain before this artifact — or
 * its Phase 4 replacement — can admit anything. Do not weaken the admission
 * rule or invent digests to paper over this here.
 */
export function loadBootstrapArtifact(): PolicyArtifact {
  if (cached) return cached;

  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, '../../config/bootstrap-artifact.json'), 'utf8'));

  const provisional = need(raw._provisional as string | undefined, '_provisional');
  if (typeof provisional !== 'string' || provisional.trim() === '') {
    throw new Error("bootstrap-artifact.json field '_provisional' must be a non-empty string");
  }

  const residualQuantileWadByMarket: Record<string, bigint> = {};
  for (const [k, v] of Object.entries(need(raw.residualQuantileWadByMarket, 'residualQuantileWadByMarket') as Record<string, string>)) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`bootstrap-artifact.json residualQuantileWadByMarket['${k}'] must be a non-empty numeric string, got ${JSON.stringify(v)}`);
    }
    residualQuantileWadByMarket[k] = BigInt(v);
  }

  const body: Omit<PolicyArtifact, 'artifactHash'> = {
    policyVersion: need(raw.policyVersion, 'policyVersion'),
    horizonSeconds: need(raw.horizonSeconds, 'horizonSeconds'),
    coverageTarget: need(raw.coverageTarget, 'coverageTarget'),
    method: need(raw.method, 'method'),
    methodParams: need(raw.methodParams, 'methodParams'),
    residualQuantileWadByMarket,
    portfolioResidualQuantileWad: needBigInt(raw.portfolioResidualQuantileWad, 'portfolioResidualQuantileWad'),
    minObservations: need(raw.minObservations, 'minObservations'),
    availabilityLagSeconds: need(raw.availabilityLagSeconds, 'availabilityLagSeconds'),
    noTradeBandK: need(raw.noTradeBandK, 'noTradeBandK'),
    pinnedConfigDigests: need(raw.pinnedConfigDigests, 'pinnedConfigDigests'),
    configDigest: need(raw.configDigest, 'configDigest'),
    _provisional: provisional,
  };

  cached = { ...body, artifactHash: computeArtifactHash(body) };
  return cached;
}
