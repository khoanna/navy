import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashData } from '../domain/hashing.js';
import type { PolicyArtifact, ResidualPanel } from './types.js';

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

/**
 * P23: a registered artifact must carry the panel P2 and P8 actually read; a
 * silent absence let the run degrade to a frozen scalar without saying so.
 */
function parsePanel(raw: unknown, required: boolean): ResidualPanel | undefined {
  if (raw === undefined || raw === null) {
    if (required) {
      throw new Error(
        'registered artifact is missing residualPanel: P2 and P9.1.3 both read it, and a ' +
        'silent fallback to portfolioResidualQuantileWad is the v0.6 defect P23 removes',
      );
    }
    return undefined;
  }
  const p = raw as { marketIds: string[]; originsSeconds: number[]; rows: string[][] };
  return {
    marketIds: p.marketIds,
    originsSeconds: p.originsSeconds,
    rows: p.rows.map((r) => r.map((v) => BigInt(v))),
  };
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
 * Load a REGISTERED (calibrated) artifact — the one `scripts/freeze-artifact.ts`
 * writes from the grid sweep over the calibration era.
 *
 * It must NOT carry `_provisional`; see `parseArtifact`. Unlike the bootstrap
 * this is not cached, because a run may legitimately load more than one
 * registered artifact (held-out A and held-out B are separate runs against
 * the same one, but a re-registration produces a different file).
 */
export function loadRegisteredArtifact(path: string): PolicyArtifact {
  return parseArtifact(
    JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>,
    { requireProvisional: false },
  );
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
export function parseArtifact(
  raw: Record<string, unknown>,
  opts: { requireProvisional?: boolean } = {},
): PolicyArtifact {
  const requireProvisional = opts.requireProvisional ?? true;

  // A PROVISIONAL artifact must SAY SO, and a REGISTERED one must not.
  //
  // `_provisional` is what `kernel/gates.ts` reads to block the "Calibrated
  // artifact" check, so its presence is the difference between a citable
  // result and a non-citable one. A bootstrap that could omit the field would
  // silently pass that gate; a registered artifact that could carry it would
  // silently fail. Both directions are enforced.
  const rawProvisional = raw['_provisional'] as string | undefined;
  if (requireProvisional) {
    const provisional = need(rawProvisional, '_provisional');
    if (typeof provisional !== 'string' || provisional.trim() === '') {
      throw new Error("bootstrap-artifact.json field '_provisional' must be a non-empty string");
    }
  } else if (rawProvisional !== undefined) {
    throw new Error(
      "a REGISTERED artifact must not carry '_provisional'. It is the flag §11.5's " +
        "'Calibrated artifact' check blocks on, so an artifact produced by the grid sweep " +
        'that still declares itself provisional would fail the gate it was built to pass. ' +
        'Remove the field, or load this file as a bootstrap artifact.',
    );
  }
  const provisional = rawProvisional;

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
    // OPTIONAL by design: an artifact frozen before P1 gained its relative
    // form carries only the absolute map, and `lowerBoundAt` must keep using
    // that rather than be handed a fabricated relative quantile.
    ...(raw['relativeResidualQuantileWadByMarket'] === undefined
      ? {}
      : { relativeResidualQuantileWadByMarket: quantileMap('relativeResidualQuantileWadByMarket') }),
    portfolioResidualQuantileWad: needBigInt(raw['portfolioResidualQuantileWad'], 'portfolioResidualQuantileWad'),
    // §7.2's second registered target. Required, not defaulted: a missing map
    // would silently mean "no cash forecast" and send `e_i^cons` and phi back
    // to the spot reading that audit NEW-11 is about.
    cashResidualQuantileWadByMarket: quantileMap('cashResidualQuantileWadByMarket'),
    cashLowerBoundQuantileWad: needBigInt(raw['cashLowerBoundQuantileWad'], 'cashLowerBoundQuantileWad'),
    minObservations: need(raw['minObservations'], 'minObservations') as number,
    availabilityLagSeconds: need(raw['availabilityLagSeconds'], 'availabilityLagSeconds') as number,
    noTradeBandK: need(raw['noTradeBandK'], 'noTradeBandK') as number,
    ...(requireProvisional
      ? {
          paybackSeconds: (raw['paybackSeconds'] as number) ?? 0,
          adjustmentRate: (raw['adjustmentRate'] as number) ?? 1,
          edgeWindowEffective: (raw['edgeWindowEffective'] as number) ?? 1,
        }
      : {
          paybackSeconds: need(raw['paybackSeconds'], 'paybackSeconds') as number,
          adjustmentRate: need(raw['adjustmentRate'], 'adjustmentRate') as number,
          edgeWindowEffective: need(raw['edgeWindowEffective'], 'edgeWindowEffective') as number,
        }),
    // Ruling R3: parse once into a local, then spread from it — the brief's
    // draft called parsePanel twice (once in the condition, once in the
    // value), which would double-evaluate it.
    ...(() => {
      const panel = parsePanel(raw['residualPanel'], !requireProvisional);
      return panel !== undefined ? { residualPanel: panel } : {};
    })(),
    // OPTIONAL, and NOT required even for a registered artifact: one frozen
    // before P2 gained its relative model-residual form carries only the
    // absolute panel, and `portfolioLowerBound` must keep applying that one
    // additively rather than be handed a haircut in units it was not
    // calibrated in.
    ...(() => {
      const rel = parsePanel(raw['relativeResidualPanel'], false);
      return rel !== undefined ? { relativeResidualPanel: { ...rel, relative: true } } : {};
    })(),
    pinnedConfigDigests: need(raw['pinnedConfigDigests'], 'pinnedConfigDigests') as Record<string, string>,
    configDigest: need(raw['configDigest'], 'configDigest') as string,
    ...(provisional !== undefined ? { _provisional: provisional } : {}),
  };

  return { ...body, artifactHash: computeArtifactHash(body) };
}
