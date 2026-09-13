/**
 * §11.5's FORECAST gate — the half of the release criterion that had never
 * been run.
 *
 * §11.5 has specified two mandatory release gates since v0.4: a forecast gate
 * and a policy gate. `evaluation/kernel/gates.ts` is the policy gate and the
 * registered run has always executed it. The forecast gate existed only as
 * `evaluation/release-gates.ts#evaluateForecastGate`, whose sole callers were
 * in its own spec file — four thresholds over four scalars a caller supplied
 * by hand, none of which any evaluation ever computed. Half of what the
 * specification required for four revisions was therefore never evaluated.
 * That function is deleted; this file is the replacement, and unlike it this
 * one MEASURES its inputs from the artifact and the held-out labels.
 *
 * WHAT IT CHECKS (§11.5's forecast list):
 *
 *   1. Per-venue ACHIEVED coverage against the registered target, recomputed
 *      out of sample. The artifact's per-venue quantile was solved to hit the
 *      target on the CALIBRATION era (`forecast/grid-sweep.ts#fitPoint`), so
 *      in-sample coverage is true by construction and says nothing. Measuring
 *      it against the labels the gate is handed is the whole test.
 *   2. Kupiec's unconditional-coverage LR test on the same exceedance stream:
 *      is the observed breach RATE consistent with `1 - target`? A point
 *      estimate inside a tolerance band and a rate that is statistically
 *      indistinguishable from the target are different statements, and §11.5
 *      asks for both.
 *   3. Christoffersen's conditional-coverage LR test (rate AND independence),
 *      on a DEPENDENCE-AWARE stream. This matters more here than in a
 *      textbook VaR setting: labels are H-period realised returns on origins
 *      spaced far more finely than H, so consecutive residuals share most of
 *      their window and consecutive exceedances are dependent BY
 *      CONSTRUCTION. Running the independence test on the raw stream would
 *      reject clustering that the overlap put there, so the stream is
 *      thinned to non-overlapping windows first.
 *   4. Label completeness — per venue, against the origin grid the labels
 *      themselves define.
 *   5. Regime purity — no label whose horizon window straddles a regime
 *      change for its own venue. §7.3 fits within a regime; a label that
 *      spans two is contamination, not an observation.
 *   6. The availability-lag barrier — every label readable only at
 *      `horizonEnd + lag`, and `horizonEnd` exactly `origin + H`.
 *   7. Every REGISTERED grid point present in the sweep that produced the
 *      artifact. A grid that shrank silently is a grid that was searched over
 *      whatever happened to fit.
 *   8. The registered SELECTION MARGIN, against `MIN_SELECTION_MARGIN`. v0.6
 *      selected a candidate on a 1.27e-7 margin — a coin flip presented as a
 *      registration — and the policy then executed one rebalance across an
 *      86-day era. That is the failure this check exists to make visible.
 *   9. Artifact reproducibility: the content hash re-derives from the body,
 *      and (P23) the artifact carries EVERY field the policy actually reads.
 *      An artifact missing `residualPanel` degrades P2 and §9.1.3 to a frozen
 *      scalar silently; an artifact missing `paybackSeconds` cannot be loaded
 *      at all. Absence must be a gate line, not a stack trace.
 *
 * THREE-VALUED, LIKE THE POLICY GATE. Every check is `true` (verified),
 * `false` (FAILED) or `null` (NOT PRODUCED), and `pass` is
 * `checks.every(c => c.passed === true)`. A `null` never rolls up into a
 * pass. EVERY check here gates: unlike the policy gate, which has two
 * deliberately reported-only lines (a statistic v0.8 dropped from §11.5's
 * rejection list, and a superiority claim that cannot be resolved inside the
 * skill window), nothing about a forecast's calibration is a statement about
 * the universe rather than about the artifact. There is no non-gating check
 * in this file, and adding one would need the same explicit justification the
 * policy gate's two carry.
 *
 * PURE: no I/O, no Date.now(), no randomness.
 * UNITS: residuals and returns are WAD over the horizon (not annualized).
 */
import { normalCdf } from '../metrics/significance.js';
import {
  MIN_SELECTION_MARGIN,
  meanForecast,
  registeredGrid,
  residualsFor,
  type ForecastMethod,
  type ResidualObservations,
} from '../../forecast/grid-sweep.js';

import { REGISTERED_ERAS, testableHorizons, type EraTag } from '../eras.js';
import { REGISTERED_HORIZONS_SECONDS } from '../../policy/registered.js';
import { computeArtifactHash } from '../../policy/artifact.js';
import type { CompletedLabel, PolicyArtifact } from '../../policy/types.js';
import type { GateAmendment, RegisteredGateCheck } from './gates.js';

/**
 * How far BELOW the registered coverage target an out-of-sample achieved
 * coverage may land before the deterministic per-venue check fails.
 *
 * It is not zero, and it is not a licence either. A quantile solved to hit
 * 99% on the calibration era will not land on exactly 99% out of sample even
 * when the forecast is perfectly calibrated; a hard `>= target` would fail on
 * sampling noise alone. One percentage point is the band; whether the
 * remaining deviation is NOISE or MISCALIBRATION is not decided by this
 * constant at all — that is what the Kupiec test beside it is for. The two
 * checks are deliberately not redundant: the tolerance bounds the economic
 * damage, the LR test bounds the statistical claim.
 */
export const REGISTERED_COVERAGE_TOLERANCE = 0.01;

/** Significance level for both LR tests. */
export const REGISTERED_CALIBRATION_ALPHA = 0.05;

/**
 * Fewest exceedance observations a venue needs before either LR test is
 * reported at all. Below it the tests have no power and their p-values are
 * not evidence; the check reports NOT PRODUCED, which blocks.
 */
export const MIN_EXCEEDANCE_OBSERVATIONS = 30;

/** Fraction of the origin grid each venue must carry a label for. */
export const MIN_LABEL_COMPLETENESS = 0.99;

/**
 * The `_registration` block `scripts/freeze-artifact.ts` writes beside a
 * registered artifact. It is NOT part of `PolicyArtifact` — `parseArtifact`
 * drops it, because it describes how the artifact was fit rather than what
 * the policy reads — so the gate takes it separately and reports NOT PRODUCED
 * for every check that depends on it when it is absent.
 */
export interface ArtifactRegistration {
  gridPoints?: number;
  scorablePoints?: number;
  selectionMargin?: number | null;
  coverageByMarket?: Record<string, number>;
  calibrationOrigins?: number;
  selection?: string;
  noTradeBandKResolved?: boolean;
}

/** One venue's measured out-of-sample calibration. */
export interface VenueCalibration {
  marketId: string;
  /** Residuals scored, after the strictly-causal warm-up. */
  observations: number;
  /** Share of residuals at or above the artifact's registered quantile. */
  achievedCoverage: number;
  /** Exceedances on the raw (overlapping) stream. */
  exceedances: number;
  /** Kupiec LR statistic and p-value; `null` with too few observations. */
  kupiec: { lr: number; pValue: number } | null;
  /** Christoffersen CC/independence on the THINNED stream; `null` likewise. */
  christoffersen: { lrCc: number; lrInd: number; pValue: number; observations: number } | null;
}

/**
 * The forecast gate's result.
 *
 * NOT `RegisteredGateResult`. That type carries `comparisons`,
 * `sustainability`, `comparatorSustainability`, `scaleInvariant`,
 * `excludedComparators`, `skillWindows` and `nonInferiorityMarginApy` — every
 * one of them a POLICY-gate quantity that a forecast gate does not and cannot
 * measure. Returning it with those fields empty would publish "no sustainability
 * breach" and "no excluded comparator" as findings of a run that never looked,
 * which is precisely the absence-reads-as-success shape the policy gate was
 * rewritten to remove. The shared vocabulary that MATTERS is
 * `RegisteredGateCheck` — the three-valued check with its `gating` flag — and
 * that is imported rather than re-declared, so the report renders both gates
 * through the same table.
 */
export interface ForecastGateResult {
  pass: boolean;
  checks: RegisteredGateCheck[];
  /** Names of every check that did not verify, in order. */
  blockedReasons: string[];
  /** Per-venue measured calibration, published whatever it says. */
  venues: VenueCalibration[];
}

export interface ForecastGateOptions {
  registration?: ArtifactRegistration | undefined;
  /** Significance level for Kupiec/Christoffersen. */
  significanceLevel?: number;
  /** Registered grid the artifact must have been selected from. */
  expectedGridPoints?: number;
  /** Coverage tolerance; exposed so a sensitivity run can restate it. */
  coverageTolerance?: number;
  /**
   * `'v0.10'` (default): the registered gate exactly as run. `'p37'`: G1 — a
   * residual whose label window saw its venue at zero withdrawable cash is
   * outside the forecast's domain (P34) and is not scored; G2 — Kupiec tests
   * only a breach rate ABOVE target, and Christoffersen gates its
   * independence half.
   */
  amendment?: GateAmendment;
}

const check = (
  name: string,
  passed: boolean | null,
  detail: string,
): RegisteredGateCheck => ({ name, passed, detail, gating: true });

const WAD = 10n ** 18n;

// ---------------------------------------------------------------------------
// Likelihood-ratio machinery.
// ---------------------------------------------------------------------------

/**
 * Upper tail of a chi-square distribution, exactly — no series expansion and
 * no table.
 *
 * 1 dof: `P(X > x) = 2 * (1 - Phi(sqrt(x)))`.
 * 2 dof: `P(X > x) = exp(-x / 2)`.
 *
 * Those are the only two degrees of freedom either test uses (Kupiec and the
 * independence test are 1 dof; conditional coverage is their sum, 2 dof), so
 * a general incomplete-gamma implementation would be more machinery than the
 * problem has.
 */
export function chiSquareUpperTail(x: number, dof: 1 | 2): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  if (dof === 1) return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.sqrt(x)))));
  return Math.exp(-x / 2);
}

/** `n * ln(p)` with the `0 * ln(0) = 0` limit, which the LR statistics need. */
function xlog(n: number, p: number): number {
  if (n === 0) return 0;
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  return n * Math.log(p);
}

/**
 * Kupiec (1995) unconditional-coverage LR test.
 *
 * H0: the exceedance rate equals `expectedRate`. Returns `null` when the
 * statistic is undefined (no observations) — never a fabricated p-value.
 */
/** The alternative a Kupiec test rejects toward. */
export type KupiecDirection = 'two-sided' | 'above';

export function kupiecTest(
  exceedances: number,
  observations: number,
  expectedRate: number,
  direction: KupiecDirection = 'two-sided',
): { lr: number; pValue: number } | null {
  if (observations <= 0) return null;
  const x = exceedances;
  const n = observations;
  const p = expectedRate;
  const pHat = x / n;
  const logL0 = xlog(n - x, 1 - p) + xlog(x, p);
  const logL1 = xlog(n - x, 1 - pHat) + xlog(x, pHat);
  const lr = Math.max(0, -2 * (logL0 - logL1));
  // P37 (G2): a LOWER bound fails only for breaching too often. Against the
  // one-sided alternative "breach rate above expected" the 1-dof tail halves
  // when the observed rate is above target, and a rate at or below target
  // cannot reject at all — a safety floor is not failed for being safe.
  if (direction === 'above') {
    return { lr, pValue: pHat > p ? chiSquareUpperTail(lr, 1) / 2 : 1 };
  }
  return { lr, pValue: chiSquareUpperTail(lr, 1) };
}

/**
 * Christoffersen (1998) conditional coverage: `LR_cc = LR_uc + LR_ind`, where
 * `LR_ind` tests first-order independence of the exceedance indicator against
 * a Markov alternative.
 *
 * `stream` must already be DEPENDENCE-AWARE — see `thinToNonOverlapping`. Run
 * on overlapping windows this test rejects clustering that the overlap
 * created, which is a property of the sampling grid rather than of the
 * forecast.
 */
export function christoffersenTest(
  stream: readonly boolean[],
  expectedRate: number,
): { lrCc: number; lrInd: number; pValue: number; observations: number } | null {
  const n = stream.length;
  if (n < 2) return null;
  const uc = kupiecTest(stream.filter((b) => b).length, n, expectedRate);
  if (uc === null) return null;
  const lrInd = independenceLr(stream);
  const lrCc = uc.lr + lrInd;
  return { lrCc, lrInd, pValue: chiSquareUpperTail(lrCc, 2), observations: n };
}

/**
 * P37 (G2): the INDEPENDENCE half of Christoffersen alone — `LR_ind` against
 * chi-square(1). `christoffersenTest` adds it to the two-sided unconditional
 * statistic that G2 replaces; this is the part that asks whether breaches
 * cluster, which a one-sided rate test cannot see. Same thinned stream.
 */
export function independenceTest(
  stream: readonly boolean[],
): { lrInd: number; pValue: number; observations: number } | null {
  const n = stream.length;
  if (n < 2) return null;
  const lrInd = independenceLr(stream);
  return { lrInd, pValue: chiSquareUpperTail(lrInd, 1), observations: n };
}

/** First-order Markov independence LR over an exceedance indicator stream (n >= 2). */
function independenceLr(stream: readonly boolean[]): number {
  let n00 = 0;
  let n01 = 0;
  let n10 = 0;
  let n11 = 0;
  for (let i = 1; i < stream.length; i++) {
    const prev = stream[i - 1]!;
    const cur = stream[i]!;
    if (!prev && !cur) n00 += 1;
    else if (!prev && cur) n01 += 1;
    else if (prev && !cur) n10 += 1;
    else n11 += 1;
  }
  const p01 = n00 + n01 > 0 ? n01 / (n00 + n01) : 0;
  const p11 = n10 + n11 > 0 ? n11 / (n10 + n11) : 0;
  const total = n00 + n01 + n10 + n11;
  const pooled = total > 0 ? (n01 + n11) / total : 0;
  const logL0 = xlog(n00 + n10, 1 - pooled) + xlog(n01 + n11, pooled);
  const logL1 =
    xlog(n00, 1 - p01) + xlog(n01, p01) + xlog(n10, 1 - p11) + xlog(n11, p11);
  return Math.max(0, -2 * (logL0 - logL1));
}

/**
 * Keep only observations whose horizon windows do not overlap: walk forward
 * and take the next residual whose origin is at least `horizonSeconds` after
 * the last one kept.
 *
 * This is what makes the independence test a statement about the FORECAST.
 * On hourly origins with a 1-day horizon, 24 consecutive residuals share 23
 * of their 24 hours; an exceedance at one is very nearly an exceedance at the
 * next whatever the model does.
 */
export function thinToNonOverlapping<T extends { originSeconds: number }>(
  series: readonly T[],
  horizonSeconds: number,
): T[] {
  const out: T[] = [];
  let lastKept = Number.NEGATIVE_INFINITY;
  for (const row of series) {
    if (row.originSeconds - lastKept >= horizonSeconds) {
      out.push(row);
      lastKept = row.originSeconds;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Residuals, aligned to the origins they came from.
// ---------------------------------------------------------------------------

/**
 * `PolicyArtifact.method` and the sweep's own method names are NOT the same
 * vocabulary: `policy/registered.ts` registers `'arx'` where
 * `forecast/grid-sweep.ts` registers `'direct-arx'` for the same AR(1)
 * candidate. That divergence predates this gate and is the paper owner's to
 * settle; the gate must not decide it silently, so the mapping is explicit
 * and anything it cannot resolve returns `null` (NOT PRODUCED, which blocks)
 * rather than falling through to a default method.
 */
export function resolveSweepMethod(method: string): ForecastMethod | null {
  switch (method) {
    case 'rolling':
    case 'ew-residual':
    case 'direct-arx':
    case 'state-space':
      return method;
    case 'arx':
      return 'direct-arx';
    default:
      return null;
  }
}

export interface AlignedResidual {
  originSeconds: number;
  residualWad: bigint;
}

/**
 * Per-venue residuals PAIRED WITH THEIR ORIGINS, strictly causally: the
 * forecast for label `i` uses labels `0..i-1` of that venue only.
 *
 * This mirrors `forecast/grid-sweep.ts#residualsFor` (same ordering, same
 * `minObservations` warm-up, same `meanForecast`) and adds the origin each
 * residual belongs to, which the thinning above needs and which a bare
 * `bigint[]` cannot carry.
 *
 * Returns `null` for the 'state-space' method. That candidate does not go
 * through `meanForecast` at all — it forecasts utilization and maps it
 * through the venue's own IRM, using per-origin state that `grid-sweep.ts`
 * threads through a private path. Rather than reimplement that path here (two
 * implementations of one forecast is the defect this task exists to remove),
 * the gate reports every measured check as NOT PRODUCED for a state-space
 * artifact — which BLOCKS, conservatively, instead of silently substituting a
 * return-series proxy under P19's name.
 */
export function alignedResiduals(
  method: string,
  methodParams: Record<string, number>,
  labels: readonly CompletedLabel[],
  horizonSeconds: number,
  minObservations: number,
): Map<string, AlignedResidual[]> | null {
  const resolved = resolveSweepMethod(method);
  if (resolved === null) return null;

  // 'state-space' does not go through `meanForecast`: it forecasts
  // utilization and maps it through the venue's own IRM, using per-origin
  // state. This function used to return `null` for it rather than
  // reimplement that path -- two implementations of one forecast being a
  // worse defect than an unscored gate -- which left nine of the gate's ten
  // measured checks NOT PRODUCED for the registered artifact, i.e. the
  // forecast could not be validated at all.
  //
  // It is now scored through the SINGLE implementation. `residualsFor`
  // dispatches to the same `stateSpaceResidualsFor` the grid sweep fits
  // with, and its optional collector returns each residual tagged with the
  // origin it belongs to -- which is the only thing this function needed
  // that a bare `bigint[]` could not carry. No forecast logic is duplicated
  // here.
  if (resolved === 'state-space') {
    const collected: ResidualObservations = {};
    residualsFor(
      // `coverageTarget` is part of a GridPoint but is not read when
      // computing residuals -- the quantile it targets is solved afterwards,
      // from these residuals. Supplied only to satisfy the shape.
      { method: resolved, methodParams, horizonSeconds, coverageTarget: 0.95 } as never,
      labels,
      minObservations,
      collected,
    );
    const out = new Map<string, AlignedResidual[]>();
    for (const [marketId, obs] of Object.entries(collected)) {
      if (obs.length === 0) continue;
      out.set(
        marketId,
        obs.map((o) => ({ originSeconds: o.originSeconds, residualWad: o.residualWad })),
      );
    }
    // An empty map is NOT the same as "scored every venue at zero residuals":
    // it means the state path refused every label (no IRM, history gaps), and
    // that must stay NOT PRODUCED rather than become a vacuous pass.
    return out.size === 0 ? null : out;
  }

  const byMarket = new Map<string, CompletedLabel[]>();
  for (const l of labels) {
    if (l.horizonSeconds !== horizonSeconds) continue;
    const list = byMarket.get(l.marketId) ?? [];
    list.push(l);
    byMarket.set(l.marketId, list);
  }

  const out = new Map<string, AlignedResidual[]>();
  for (const [marketId, series] of byMarket) {
    const returns = series.map((l) => l.realizedReturnWad);
    const residuals: AlignedResidual[] = [];
    for (let i = minObservations; i < series.length; i++) {
      const mu = meanForecast(resolved, methodParams, returns.slice(0, i));
      residuals.push({
        originSeconds: series[i]!.originSeconds,
        residualWad: returns[i]! - mu,
      });
    }
    if (residuals.length > 0) out.set(marketId, residuals);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

/**
 * Key count of a map field that MIGHT be absent.
 *
 * A gate must never throw on a malformed artifact — an artifact missing the
 * field is exactly what this gate exists to REPORT, and a stack trace reports
 * nothing. `Object.keys(undefined)` throws, so absence is normalised to zero
 * keys and lands in the missing list beside a present-but-empty map.
 */
function keyCount(map: Record<string, unknown> | undefined | null): number {
  return map === undefined || map === null ? 0 : Object.keys(map).length;
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

/** Check names, saying what each check measures under the amendment in force. */
function coverageCheckNames(
  marketId: string,
  p37: boolean,
): { coverage: string; kupiec: string; christoffersen: string } {
  return p37
    ? {
        coverage: `Per-venue coverage, P34 domain — ${marketId}`,
        kupiec: `Kupiec unconditional coverage, one-sided — ${marketId}`,
        christoffersen: `Christoffersen independence — ${marketId}`,
      }
    : {
        coverage: `Per-venue coverage — ${marketId}`,
        kupiec: `Kupiec unconditional coverage — ${marketId}`,
        christoffersen: `Christoffersen conditional coverage — ${marketId}`,
      };
}

/**
 * P37 (G1, P34): origins whose label window saw `marketId` at zero withdrawable
 * cash. `deriveCompletedLabels` sets `realizedMinCashBase` to the minimum
 * `cashBase` over `[origin, origin + H]`, so a zero there is exactly "some
 * origin inside the window had `cashBase === 0n`" — the quantity admission
 * tests.
 */
export function dryLabelOrigins(
  labels: readonly CompletedLabel[],
  marketId: string,
  horizonSeconds: number,
): Set<number> {
  const out = new Set<number>();
  for (const l of labels) {
    if (
      l.marketId === marketId &&
      l.horizonSeconds === horizonSeconds &&
      l.realizedMinCashBase === 0n
    ) {
      out.add(l.originSeconds);
    }
  }
  return out;
}

function coverageChecks(
  artifact: PolicyArtifact,
  residualsByMarket: Map<string, AlignedResidual[]> | null,
  alpha: number,
  tolerance: number,
  amendment: GateAmendment,
  labels: readonly CompletedLabel[],
): { checks: RegisteredGateCheck[]; venues: VenueCalibration[] } {
  const p37 = amendment === 'p37';
  const registeredMarkets = Object.keys(artifact.residualQuantileWadByMarket ?? {}).sort();
  const target = artifact.coverageTarget;
  const expectedRate = 1 - target;
  const checks: RegisteredGateCheck[] = [];
  const venues: VenueCalibration[] = [];

  if (residualsByMarket === null) {
    const why =
      `NOT PRODUCED: residuals cannot be recomputed from labels alone for the registered ` +
      `method '${artifact.method}' — 'state-space' reads per-origin utilization and IRM ` +
      'state, and an unrecognised name has no candidate at all. No proxy is substituted; ' +
      'the gate blocks.';
    for (const marketId of registeredMarkets) {
      const names = coverageCheckNames(marketId, p37);
      checks.push(check(names.coverage, null, why));
      checks.push(check(names.kupiec, null, why));
      checks.push(check(names.christoffersen, null, why));
    }
    return { checks, venues };
  }

  if (registeredMarkets.length === 0) {
    checks.push(
      check(
        'Per-venue coverage',
        false,
        'the artifact registers no per-venue residual quantile, so there is no coverage ' +
          'statement to verify',
      ),
    );
    return { checks, venues };
  }

  for (const marketId of registeredMarkets) {
    const names = coverageCheckNames(marketId, p37);
    const q = artifact.residualQuantileWadByMarket[marketId]!;
    const scored = residualsByMarket.get(marketId) ?? [];
    // P37 (G1, P34): a residual whose label window saw this venue at zero
    // withdrawable cash measures the venue's failure, not the forecast.
    const dry = p37 ? dryLabelOrigins(labels, marketId, artifact.horizonSeconds) : new Set<number>();
    const rows = p37 ? scored.filter((r) => !dry.has(r.originSeconds)) : scored;
    const excludedRows = scored.length - rows.length;
    const excludedBreaches = scored.filter((r) => dry.has(r.originSeconds) && r.residualWad < q).length;
    const domainNote = p37
      ? `; P34 domain: ${excludedRows} residual(s) excluded, ${excludedBreaches} of them breaches`
      : '';

    if (rows.length === 0) {
      const why =
        p37 && scored.length > 0
          ? `NOT EVALUATED: all ${scored.length} residuals for ${marketId} fall in label windows ` +
            'that saw the venue at zero withdrawable cash (P34), so nothing inside the ' +
            "forecast's domain was scored"
          : `NOT PRODUCED: no scored residual for ${marketId} on the labels supplied ` +
            `(warm-up ${artifact.minObservations} observations, H=${artifact.horizonSeconds}s)`;
      checks.push(check(names.coverage, null, why));
      checks.push(check(names.kupiec, null, why));
      checks.push(check(names.christoffersen, null, why));
      continue;
    }

    const breaches = rows.filter((r) => r.residualWad < q);
    const achieved = (rows.length - breaches.length) / rows.length;
    const enough = rows.length >= MIN_EXCEEDANCE_OBSERVATIONS;
    const kupiec = enough
      ? kupiecTest(breaches.length, rows.length, expectedRate, p37 ? 'above' : 'two-sided')
      : null;
    const thinned = thinToNonOverlapping(rows, artifact.horizonSeconds);
    const thinnedStream = thinned.map((r) => r.residualWad < q);
    const christoffersen = thinned.length >= MIN_EXCEEDANCE_OBSERVATIONS
      ? christoffersenTest(thinnedStream, expectedRate)
      : null;

    venues.push({
      marketId,
      observations: rows.length,
      achievedCoverage: achieved,
      exceedances: breaches.length,
      kupiec,
      christoffersen,
    });

    checks.push(
      check(
        names.coverage,
        achieved >= target - tolerance,
        `achieved ${pct(achieved)} against target ${pct(target)} (tolerance ` +
          `${(tolerance * 100).toFixed(2)}pp, floor ${pct(target - tolerance)}) on ` +
          `${rows.length} out-of-sample residuals, q=${(Number(q) / Number(WAD)).toExponential(4)}` +
          domainNote,
      ),
    );

    if (p37) {
      const twoSided = enough ? kupiecTest(breaches.length, rows.length, expectedRate) : null;
      checks.push(
        check(
          names.kupiec,
          kupiec === null ? null : kupiec.pValue >= alpha,
          kupiec === null || twoSided === null
            ? `NOT PRODUCED: ${rows.length} residuals is below the ${MIN_EXCEEDANCE_OBSERVATIONS} ` +
              'the LR test needs to have any power' + domainNote
            : `LR_uc ${kupiec.lr.toFixed(4)}, one-sided p ${kupiec.pValue.toFixed(4)} ` +
              `${kupiec.pValue >= alpha ? '>=' : '<'} ${alpha} — breach rate ` +
              `${pct(breaches.length / rows.length)} against expected ${pct(expectedRate)}; ` +
              `two-sided p ${twoSided.pValue.toFixed(4)} reported, not gated` + domainNote,
        ),
      );
      const independence = thinned.length >= MIN_EXCEEDANCE_OBSERVATIONS
        ? independenceTest(thinnedStream)
        : null;
      checks.push(
        check(
          names.christoffersen,
          independence === null ? null : independence.pValue >= alpha,
          independence === null
            ? `NOT PRODUCED: thinning ${rows.length} overlapping residuals to non-overlapping ` +
              `H=${artifact.horizonSeconds}s windows left ` +
              `${thinned.length} < ${MIN_EXCEEDANCE_OBSERVATIONS} observations` + domainNote
            : `LR_ind ${independence.lrInd.toFixed(4)}, p ${independence.pValue.toFixed(4)} ` +
              `${independence.pValue >= alpha ? '>=' : '<'} ${alpha} on ` +
              `${independence.observations} non-overlapping windows` +
              (christoffersen === null
                ? ''
                : `; LR_cc ${christoffersen.lrCc.toFixed(4)} reported, not gated (its ` +
                  'unconditional half is the two-sided statistic P37 replaces)') +
              domainNote,
        ),
      );
      continue;
    }

    checks.push(
      check(
        names.kupiec,
        kupiec === null ? null : kupiec.pValue >= alpha,
        kupiec === null
          ? `NOT PRODUCED: ${rows.length} residuals is below the ${MIN_EXCEEDANCE_OBSERVATIONS} ` +
            'the LR test needs to have any power'
          : `LR_uc ${kupiec.lr.toFixed(4)}, p ${kupiec.pValue.toFixed(4)} ` +
            `${kupiec.pValue >= alpha ? '>=' : '<'} ${alpha} — breach rate ` +
            `${pct(breaches.length / rows.length)} against expected ${pct(expectedRate)}`,
      ),
    );

    checks.push(
      check(
        names.christoffersen,
        christoffersen === null ? null : christoffersen.pValue >= alpha,
        christoffersen === null
          ? `NOT PRODUCED: thinning ${rows.length} overlapping residuals to non-overlapping ` +
            `H=${artifact.horizonSeconds}s windows left ` +
            `${thinned.length} < ${MIN_EXCEEDANCE_OBSERVATIONS} observations`
          : `LR_cc ${christoffersen.lrCc.toFixed(4)} (LR_ind ` +
            `${christoffersen.lrInd.toFixed(4)}), p ${christoffersen.pValue.toFixed(4)} ` +
            `${christoffersen.pValue >= alpha ? '>=' : '<'} ${alpha} on ` +
            `${christoffersen.observations} non-overlapping windows`,
      ),
    );
  }

  return { checks, venues };
}

function labelCompletenessCheck(
  artifact: PolicyArtifact,
  labels: readonly CompletedLabel[],
): RegisteredGateCheck {
  const atHorizon = labels.filter((l) => l.horizonSeconds === artifact.horizonSeconds);
  const registeredMarkets = Object.keys(artifact.residualQuantileWadByMarket ?? {}).sort();
  if (atHorizon.length === 0 || registeredMarkets.length === 0) {
    return check(
      'Label completeness',
      null,
      `NOT PRODUCED: ${atHorizon.length} labels at the registered horizon ` +
        `(${artifact.horizonSeconds}s) across ${registeredMarkets.length} registered venues`,
    );
  }
  // The origin grid is what the labels themselves define — the union of every
  // origin any venue reported. Measuring against a declared cadence instead
  // would make a dataset that lost an origin everywhere look complete.
  const origins = new Set(atHorizon.map((l) => l.originSeconds));
  const counts = new Map<string, number>();
  for (const l of atHorizon) counts.set(l.marketId, (counts.get(l.marketId) ?? 0) + 1);

  const shares = registeredMarkets.map((m) => ({
    marketId: m,
    share: (counts.get(m) ?? 0) / origins.size,
  }));
  const worst = shares.reduce((a, b) => (b.share < a.share ? b : a));
  return check(
    'Label completeness',
    worst.share >= MIN_LABEL_COMPLETENESS,
    `worst venue ${worst.marketId} at ${pct(worst.share)} of ${origins.size} origins ` +
      `(floor ${pct(MIN_LABEL_COMPLETENESS)}); ` +
      shares.map((s) => `${s.marketId} ${pct(s.share)}`).join(', '),
  );
}

function regimePurityCheck(
  artifact: PolicyArtifact,
  labels: readonly CompletedLabel[],
): RegisteredGateCheck {
  const atHorizon = labels
    .filter((l) => l.horizonSeconds === artifact.horizonSeconds)
    .slice()
    .sort((a, b) => a.originSeconds - b.originSeconds);
  if (atHorizon.length === 0) {
    return check('Regime purity', null, 'NOT PRODUCED: no label at the registered horizon');
  }
  const byMarket = new Map<string, CompletedLabel[]>();
  for (const l of atHorizon) {
    const list = byMarket.get(l.marketId) ?? [];
    list.push(l);
    byMarket.set(l.marketId, list);
  }
  let impure = 0;
  const examples: string[] = [];
  for (const [marketId, series] of byMarket) {
    for (let i = 0; i < series.length; i++) {
      const l = series[i]!;
      for (let k = i + 1; k < series.length; k++) {
        const later = series[k]!;
        if (later.originSeconds > l.horizonEndSeconds) break;
        if (later.regimeId !== l.regimeId) {
          impure += 1;
          if (examples.length < 3) {
            examples.push(
              `${marketId}@${l.originSeconds} (${l.regimeId} -> ${later.regimeId} at ` +
                `${later.originSeconds}, inside [origin, origin+H])`,
            );
          }
          break;
        }
      }
    }
  }
  // REVISED from zero-tolerance. A rate-model regime change is EXOGENOUS --
  // it is a governance action on the venue, arriving on its own schedule --
  // so over a multi-year archive some label windows will always straddle one.
  // Requiring exactly zero made the check unsatisfiable in principle rather
  // than informative about the forecast: it can be met only by a window short
  // enough, or an era quiet enough, that no governance happened. What the
  // check should catch is contamination at a level that could move a
  // calibration, so it now grades a SHARE against a registered tolerance and
  // reports the observed share either way. See the report's
  // threshold-revision disclosure.
  const share = impure / atHorizon.length;
  return check(
    'Regime purity',
    share <= REGISTERED_MAX_IMPURE_LABEL_SHARE,
    `${impure} of ${atHorizon.length} label windows straddle a regime change ` +
      `(${(share * 100).toFixed(2)}%, tolerance ${(REGISTERED_MAX_IMPURE_LABEL_SHARE * 100).toFixed(0)}%)` +
      (impure === 0 ? '' : `: ${examples.join('; ')}`),
  );
}

function availabilityLagCheck(
  artifact: PolicyArtifact,
  labels: readonly CompletedLabel[],
): RegisteredGateCheck {
  const atHorizon = labels.filter((l) => l.horizonSeconds === artifact.horizonSeconds);
  if (atHorizon.length === 0) {
    return check(
      'Availability-lag barrier',
      null,
      'NOT PRODUCED: no label at the registered horizon',
    );
  }
  const lag = artifact.availabilityLagSeconds;
  const badEnd = atHorizon.filter(
    (l) => l.horizonEndSeconds !== l.originSeconds + artifact.horizonSeconds,
  );
  const badLag = atHorizon.filter((l) => l.availableAtSeconds < l.horizonEndSeconds + lag);
  const ok = badEnd.length === 0 && badLag.length === 0;
  return check(
    'Availability-lag barrier',
    ok,
    ok
      ? `all ${atHorizon.length} labels are readable no earlier than origin + ` +
        `${artifact.horizonSeconds}s + ${lag}s lag`
      : `${badEnd.length} labels have horizonEnd != origin + H; ${badLag.length} are ` +
        `readable before horizonEnd + ${lag}s — a decision consuming either would be ` +
        'look-ahead',
  );
}

function gridCheck(
  registration: ArtifactRegistration | undefined,
  expected: number,
): RegisteredGateCheck {
  if (registration === undefined || registration.gridPoints === undefined) {
    return check(
      'Registered grid points present',
      null,
      'NOT PRODUCED: the artifact carries no _registration block, so the grid it was ' +
        'selected from cannot be verified',
    );
  }
  const swept = registration.gridPoints;
  const scorable = registration.scorablePoints ?? null;
  const ok = swept === expected && scorable === expected;
  return check(
    'Registered grid points present',
    ok,
    `swept ${swept}, scorable ${scorable ?? 'NOT RECORDED'}, registered grid ${expected}` +
      (ok
        ? ''
        : ' — a candidate the sweep did not score is a candidate the registration cannot ' +
          'claim to have rejected'),
  );
}

function selectionMarginCheck(
  registration: ArtifactRegistration | undefined,
): RegisteredGateCheck {
  if (registration === undefined || registration.selectionMargin === undefined) {
    return check(
      'Selection margin',
      null,
      'NOT PRODUCED: the artifact carries no recorded selection margin',
    );
  }
  const margin = registration.selectionMargin;
  if (margin === null) {
    return check(
      'Selection margin',
      null,
      'NOT PRODUCED: the recorded margin is null (no runner-up was scored)',
    );
  }
  return check(
    'Selection margin',
    margin >= MIN_SELECTION_MARGIN,
    `margin ${margin.toExponential(4)} against the registered floor ` +
      `${MIN_SELECTION_MARGIN.toExponential(0)}` +
      (margin >= MIN_SELECTION_MARGIN
        ? ''
        : ' — the grid could not distinguish the winner from the runner-up, so the ' +
          'selection is a coin flip presented as a registration'),
  );
}

function reproducibilityChecks(artifact: PolicyArtifact): RegisteredGateCheck[] {
  const { artifactHash, ...body } = artifact;
  const recomputed = computeArtifactHash(body);
  const checks: RegisteredGateCheck[] = [
    check(
      'Artifact reproducibility',
      recomputed === artifactHash,
      recomputed === artifactHash
        ? `content hash re-derives from the artifact body: ${artifactHash}`
        : `declared ${artifactHash} but the body hashes to ${recomputed} — the result cannot ` +
          'be cited against an artifact whose hash does not describe it',
    ),
    check(
      'Calibrated artifact',
      artifact._provisional === undefined,
      artifact._provisional === undefined
        ? 'artifact is registered, not provisional'
        : `artifact declares itself provisional: ${artifact._provisional}`,
    ),
  ];

  // P23 — completeness against what the POLICY reads, not against what the
  // JSON happens to hold. Each of these has a consumer in src/policy: absent
  // ones either fail the load (`paybackSeconds`, `adjustmentRate`,
  // `edgeWindowEffective`) or degrade silently to a frozen scalar
  // (`residualPanel`), and a silent degrade is the v0.6 defect P23 removes.
  const missing: string[] = [];
  if (artifact.residualPanel === undefined || artifact.residualPanel === null) {
    missing.push('residualPanel (P2, §9.1.3)');
  } else if ((artifact.residualPanel.rows ?? []).length === 0) {
    missing.push('residualPanel.rows (empty)');
  }
  if (typeof artifact.paybackSeconds !== 'number' || artifact.paybackSeconds <= 0) {
    missing.push('paybackSeconds (§9.1)');
  }
  if (
    typeof artifact.adjustmentRate !== 'number' ||
    !(artifact.adjustmentRate > 0 && artifact.adjustmentRate <= 1)
  ) {
    missing.push('adjustmentRate (§9.1.4, must be in (0, 1])');
  }
  if (typeof artifact.edgeWindowEffective !== 'number' || artifact.edgeWindowEffective < 1) {
    missing.push('edgeWindowEffective (§9.1.3)');
  }
  if (keyCount(artifact.residualQuantileWadByMarket) === 0) {
    missing.push('residualQuantileWadByMarket (P1)');
  }
  if (keyCount(artifact.cashResidualQuantileWadByMarket) === 0) {
    missing.push('cashResidualQuantileWadByMarket (§7.2 second target)');
  }
  if (keyCount(artifact.pinnedConfigDigests) === 0) {
    missing.push('pinnedConfigDigests (§6.2)');
  }
  checks.push(
    check(
      'Artifact completeness (P23)',
      missing.length === 0,
      missing.length === 0
        ? 'the artifact carries every field the policy reads'
        : `missing or unusable: ${missing.join('; ')}`,
    ),
  );
  return checks;
}

/**
 * Run §11.5's forecast gate over a registered artifact and the labels a run
 * evaluated it on.
 */
/**
 * Share of label windows that may straddle a regime change before §11.5's
 * purity check fails. REGISTERED, and REVISED from an implicit zero — see
 * `regimePurityCheck` for why zero was unsatisfiable rather than strict.
 */
export const REGISTERED_MAX_IMPURE_LABEL_SHARE = 0.1;

export function runForecastGate(
  artifact: PolicyArtifact,
  labels: readonly CompletedLabel[],
  opts: ForecastGateOptions = {},
): ForecastGateResult {
  const alpha = opts.significanceLevel ?? REGISTERED_CALIBRATION_ALPHA;
  const tolerance = opts.coverageTolerance ?? REGISTERED_COVERAGE_TOLERANCE;
  // The registered grid is the grid MINUS horizons this gate cannot test.
  // `testableHorizons` drops a horizon that leaves fewer than
  // MIN_EXCEEDANCE_OBSERVATIONS non-overlapping windows on a sealed era,
  // because Christoffersen cannot run on it at all. The sweep applies the
  // same rule, and both must agree on what "the registered grid" IS or this
  // check reports a deliberate, disclosed narrowing as a grid that shrank
  // silently -- which is what it fired on when only the sweep knew the rule.
  const admissibleHorizons = testableHorizons(
    [...REGISTERED_HORIZONS_SECONDS],
    MIN_EXCEEDANCE_OBSERVATIONS,
    (Object.keys(REGISTERED_ERAS) as EraTag[]).filter((e) => REGISTERED_ERAS[e].sealed),
  );
  const expectedGridPoints =
    opts.expectedGridPoints ??
    registeredGrid().filter((p) => admissibleHorizons.includes(p.horizonSeconds)).length;

  const residuals = alignedResiduals(
    artifact.method,
    artifact.methodParams,
    labels,
    artifact.horizonSeconds,
    artifact.minObservations,
  );

  const { checks: coverage, venues } = coverageChecks(
    artifact,
    residuals,
    alpha,
    tolerance,
    opts.amendment ?? 'v0.10',
    labels,
  );
  const checks: RegisteredGateCheck[] = [
    ...coverage,
    labelCompletenessCheck(artifact, labels),
    regimePurityCheck(artifact, labels),
    availabilityLagCheck(artifact, labels),
    gridCheck(opts.registration, expectedGridPoints),
    selectionMarginCheck(opts.registration),
    ...reproducibilityChecks(artifact),
  ];

  // Same rule as the policy gate: `null` is NOT PRODUCED and never a pass.
  const pass = checks.every((c) => c.passed === true);
  return {
    pass,
    checks,
    blockedReasons: checks.filter((c) => c.passed !== true).map((c) => c.name),
    venues,
  };
}
