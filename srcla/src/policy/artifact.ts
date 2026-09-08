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
 *
 * Whole-branch review, MEDIUM 7 (provenance correction): pinning digests is
 * NOT the only reason nothing admits end to end today — fixing it alone will
 * not make the kernel deploy. Two other, independent blockers exist:
 *   1. `forecast/forecast-label.ts`'s `persistForecastLabel`/
 *      `persistForecastLabels` have no caller anywhere in `src/` (verified
 *      by grep) and never write `horizonEndsAt`/`regimeId`, so
 *      `buildRawOriginFromCollector`'s `where: { horizonEndsAt: { not: null } }`
 *      filter (runtime/decision-driver.ts) always returns zero rows —
 *      `input.history` is permanently empty in production, so
 *      `admit.ts`'s REGIME_MIN_HISTORY rule (`minObservations: 30` here)
 *      can never pass either, regardless of pinning.
 *   2. `collector/snapshot-collector.ts`'s `collectStrategy` hardcodes
 *      `supplyRate`/`utilization`/`cash` to `0n` for every market ("Would
 *      need protocol-specific calls"), which `admit.ts`'s NO_MARKET_DATA
 *      rule now rejects independently of both of the above.
 * All three must be fixed (or the artifact test-only) before this kernel can
 * genuinely admit and deploy against a live vault.
 */
export function loadBootstrapArtifact(): PolicyArtifact {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  cached = parseArtifact(JSON.parse(readFileSync(join(here, '../../config/bootstrap-artifact.json'), 'utf8')));
  return cached;
}

/**
 * The validation half of `loadBootstrapArtifact`, split out so it can be
 * exercised against a MALFORMED artifact. While this lived inline, the file
 * it reads was the only input any test could give it, and a mutant that
 * replaced a required field with a silent default survived the whole suite —
 * the artifact happens to ship an empty map for that field, so "required"
 * and "defaulted to empty" were indistinguishable from outside.
 *
 * Every field here is REQUIRED. An artifact is the frozen record a result is
 * cited against (§7.3); a field that quietly defaults is a field the hash
 * cannot testify to.
 */
export function parseArtifact(raw: Record<string, unknown>): PolicyArtifact {
  const provisional = need(raw['_provisional'] as string | undefined, '_provisional');
  if (typeof provisional !== 'string' || provisional.trim() === '') {
    throw new Error("bootstrap-artifact.json field '_provisional' must be a non-empty string");
  }

  const quantileMap = (field: string): Record<string, bigint> => {
    const out: Record<string, bigint> = {};
    for (const [k, v] of Object.entries(need(raw[field], field) as Record<string, string>)) {
      if (typeof v !== 'string' || v.trim() === '') {
        throw new Error(`bootstrap-artifact.json ${field}['${k}'] must be a non-empty numeric string, got ${JSON.stringify(v)}`);
      }
      out[k] = BigInt(v);
    }
    return out;
  };

  const body: Omit<PolicyArtifact, 'artifactHash'> = {
    policyVersion: need(raw['policyVersion'], 'policyVersion') as number,
    horizonSeconds: need(raw['horizonSeconds'], 'horizonSeconds') as PolicyArtifact['horizonSeconds'],
    coverageTarget: need(raw['coverageTarget'], 'coverageTarget') as PolicyArtifact['coverageTarget'],
    method: need(raw['method'], 'method') as PolicyArtifact['method'],
    methodParams: need(raw['methodParams'], 'methodParams') as Record<string, number>,
    residualQuantileWadByMarket: quantileMap('residualQuantileWadByMarket'),
    portfolioResidualQuantileWad: needBigInt(raw['portfolioResidualQuantileWad'], 'portfolioResidualQuantileWad'),
    // §7.2's second registered target. Required, not defaulted: a missing map
    // would silently mean "no cash forecast" and send `e_i^cons` and phi back
    // to the spot reading that audit NEW-11 is about.
    cashResidualQuantileWadByMarket: quantileMap('cashResidualQuantileWadByMarket'),
    cashLowerBoundQuantileWad: needBigInt(raw['cashLowerBoundQuantileWad'], 'cashLowerBoundQuantileWad'),
    minObservations: need(raw['minObservations'], 'minObservations') as number,
    availabilityLagSeconds: need(raw['availabilityLagSeconds'], 'availabilityLagSeconds') as number,
    noTradeBandK: need(raw['noTradeBandK'], 'noTradeBandK') as number,
    pinnedConfigDigests: need(raw['pinnedConfigDigests'], 'pinnedConfigDigests') as Record<string, string>,
    configDigest: need(raw['configDigest'], 'configDigest') as string,
    _provisional: provisional,
  };

  return { ...body, artifactHash: computeArtifactHash(body) };
}
