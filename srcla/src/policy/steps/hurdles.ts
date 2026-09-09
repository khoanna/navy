/**
 * §9.1's two movement hurdles, both in ANNUALISED rate units (WAD).
 *
 * v0.4-v0.6 compared a horizon-return gain against `max(C_move, k*sigma)`.
 * That made the economic threshold a function of the forecast horizon:
 * measured dispersion is near-flat in H while expected horizon return is
 * linear, so the implied hurdle ran 7.74% APY at H=1d and 0.66% at H=14d.
 * It also charged forecast dispersion twice - once in the objective's lower
 * bound and again as the band - and it treated deploying idle cash as though
 * it were a round trip. P13, P15 and P16 fix all three.
 *
 * PURE: no I/O, no clock, no randomness.
 * UNITS: rates WAD (18 dp); money bigint USDC base units (6 dp).
 */
import { movementCostBase, type CostParams, type Move } from './cost.js';
import { rateAt } from './simulate.js';
import type { DecisionInput, PolicyArtifact, RateCurve } from '../types.js';

const WAD = 10n ** 18n;
/** 365 days. Matches steps/forecast.ts, NOT protocols/math.ts's 365.25. */
const SECONDS_PER_YEAR = 31_536_000n;

export interface LegVerdict {
  /**
   * `deploy` = idle -> venue (§9.1.2), `rotate` = venue -> venue (§9.1.3).
   * `divest` = venue -> idle: NOT produced by this module, because §9.1
   * states no hurdle for taking exposure off; `steps/legs.ts` emits it for an
   * unpaired reduction so the executed vector can shrink without an economic
   * threshold it has no definition for.
   */
  kind: 'deploy' | 'rotate' | 'divest';
  marketId: string;
  fromMarketId: string | null;
  amountBase: bigint;
  clears: boolean;
  /** annualised: the bound for a deploy, the differential for a rotation */
  edgeWad: bigint;
  hurdleWad: bigint;
  costHurdleWad: bigint;
  significanceWad: bigint;
  reason: string;
}

/**
 * §7's conservative bound expressed as an ANNUAL rate. The artifact's
 * quantile is a horizon-return quantile, so annualising it is what makes the
 * hurdle horizon-free: a bound that subtracts a near-constant from a linearly
 * growing quantity is not comparable across horizons until both are annual.
 */
export function annualLowerBound(
  curve: RateCurve,
  artifact: PolicyArtifact,
  marketId: string,
  xBase: bigint,
): bigint {
  const q = artifact.residualQuantileWadByMarket[marketId] ?? 0n;
  if (q > 0n) throw new Error(`residual quantile for ${marketId} must be <= 0, got ${q}`);
  const annualQ = (q * SECONDS_PER_YEAR) / BigInt(artifact.horizonSeconds);
  return rateAt(curve, xBase) + annualQ;
}

/** Sample standard deviation of one venue's residual column, in WAD. */
function columnSigma(artifact: PolicyArtifact, marketId: string): bigint {
  const panel = artifact.residualPanel;
  if (panel === undefined) return 0n;
  const k = panel.marketIds.indexOf(marketId);
  if (k < 0 || panel.rows.length < 2) return 0n;
  const col = panel.rows.map((r) => r[k] ?? 0n);
  const n = BigInt(col.length);
  const mean = col.reduce((s, v) => s + v, 0n) / n;
  let acc = 0n;
  for (const v of col) acc += ((v - mean) * (v - mean)) / WAD;
  return isqrt((acc / (n - 1n)) * WAD);
}

/**
 * Pearson correlation of two residual columns, in WAD, clamped to
 * `[-WAD, WAD]`.
 *
 * The unclamped ratio can land a few parts in 1e12 outside that range on
 * bigint rounding alone (measured up to `WAD + 234999n` across 400 random
 * columns, and identical columns alone can overshoot by `~2e4`) - fixed-point
 * covariance/variance division is not exact. An overshoot past +WAD makes
 * `varDiff` in `edgeStandardErrorWad` go negative before its own `> 0n`
 * clamp, which is a correctness bug (a negative "variance"), not merely an
 * ugly number - clamp at the source instead of downstream.
 */
function columnCorr(artifact: PolicyArtifact, i: string, j: string): bigint {
  const panel = artifact.residualPanel;
  if (panel === undefined) return 0n;
  const a = panel.marketIds.indexOf(i);
  const b = panel.marketIds.indexOf(j);
  if (a < 0 || b < 0 || panel.rows.length < 2) return 0n;
  const ca = panel.rows.map((r) => r[a] ?? 0n);
  const cb = panel.rows.map((r) => r[b] ?? 0n);
  const n = BigInt(ca.length);
  const ma = ca.reduce((s, v) => s + v, 0n) / n;
  const mb = cb.reduce((s, v) => s + v, 0n) / n;
  let cov = 0n, va = 0n, vb = 0n;
  for (let t = 0; t < ca.length; t++) {
    cov += ((ca[t]! - ma) * (cb[t]! - mb)) / WAD;
    va += ((ca[t]! - ma) * (ca[t]! - ma)) / WAD;
    vb += ((cb[t]! - mb) * (cb[t]! - mb)) / WAD;
  }
  const denom = isqrt(va * WAD) * isqrt(vb * WAD);
  if (denom === 0n) return 0n;
  const rho = (cov * WAD * WAD) / denom;
  if (rho > WAD) return WAD;
  if (rho < -WAD) return -WAD;
  return rho;
}

/** Integer square root for non-negative bigints (Newton). */
function isqrt(v: bigint): bigint {
  if (v <= 0n) return 0n;
  let x = v, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + v / x) / 2n; }
  return x;
}

/**
 * Whether the artifact's residual panel actually covers both venues, i.e.
 * whether `edgeStandardErrorWad(artifact, i, j)` reflects a real estimate
 * rather than degenerating to zero for want of data.
 *
 * `columnSigma`/`columnCorr` already return `0n` when the panel is absent or
 * a market id is missing from it - the right conservative fallback for a
 * VALUE - but `0n` is indistinguishable from "these two venues are
 * genuinely uncorrelated with identical zero dispersion", so a caller must
 * check coverage separately to tell the two apart (IMPORTANT 3).
 */
function panelCoversBoth(artifact: PolicyArtifact, i: string, j: string): boolean {
  const panel = artifact.residualPanel;
  return panel !== undefined
    && panel.rows.length >= 2
    && panel.marketIds.includes(i)
    && panel.marketIds.includes(j);
}

/**
 * §9.1.3's SE[dl_ij], annualised. This is the sampling error of an ESTIMATED
 * DIFFERENCE, not the predictive quantile of one horizon outcome - the two
 * answer different questions and v0.6 used the second where the first belongs.
 *
 * Returns `0n` (not a throw) when the panel does not cover both venues -
 * see `panelCoversBoth`; callers that need to distinguish that from a
 * genuine zero-dispersion estimate must check it themselves, which
 * `rotateClears` below does.
 */
export function edgeStandardErrorWad(artifact: PolicyArtifact, i: string, j: string): bigint {
  const si = columnSigma(artifact, i);
  const sj = columnSigma(artifact, j);
  const rho = columnCorr(artifact, i, j);
  const varDiff = (si * si) / WAD + (sj * sj) / WAD - (2n * rho * si * sj) / (WAD * WAD);
  const w = BigInt(Math.max(1, Math.round(artifact.edgeWindowEffective)));
  const horizonSe = isqrt(((varDiff > 0n ? varDiff : 0n) / w) * WAD);
  return (horizonSe * SECONDS_PER_YEAR) / BigInt(artifact.horizonSeconds);
}

function lendingCost(input: DecisionInput, moves: Move[], p: CostParams): bigint {
  return movementCostBase(input, moves, p).totalBase;
}

/**
 * §9.1's amortised movement cost, annualised over the registered payback
 * period, in WAD.
 *
 * IMPORTANT 2: `artifact.paybackSeconds` is `0` on the provisional/bootstrap
 * path (`artifact.ts`'s `need()` ladder does not require it, and
 * `config/bootstrap-artifact.json` does not set it), which would otherwise
 * divide by zero the moment a caller reaches this with amountBase > 0n -
 * `RangeError: Division by zero` rather than a diagnosable error. Fail with
 * a named, attributable error instead.
 */
function costHurdleWad(cost: bigint, amountBase: bigint, artifact: PolicyArtifact): bigint {
  if (amountBase === 0n) return 0n;
  if (artifact.paybackSeconds <= 0) {
    throw new Error(
      `hurdles: artifact.paybackSeconds must be > 0 to price a movement hurdle, got ` +
      `${artifact.paybackSeconds}. A registered artifact sets this jointly with noTradeBandK ` +
      `and adjustmentRate (P15/P18); the provisional/bootstrap artifact does not.`
    );
  }
  return (cost * WAD * SECONDS_PER_YEAR) / (amountBase * BigInt(artifact.paybackSeconds));
}

/**
 * §9.1.2 - idle capital deploys when its conservative bound repays the
 * movement cost within the registered payback period. NO dispersion term:
 * the bound already carries it, and the counterfactual (idle) is certain.
 *
 * IMPORTANT 4: decides and reports off the SAME annualised comparison
 * (`ell` vs `costHurdleWad`) rather than an independently-truncated
 * base-unit comparison (`gain` vs `cost`) whose disagreement band with the
 * annualised fields was ~1.2e7 WAD wide near the boundary - exactly where a
 * caller reading `clears` alongside `edgeWad`/`hurdleWad` most needs them to
 * agree.
 */
export function deployClears(
  input: DecisionInput,
  artifact: PolicyArtifact,
  curve: RateCurve,
  marketId: string,
  amountBase: bigint,
  p: CostParams,
): LegVerdict {
  const ell = annualLowerBound(curve, artifact, marketId, amountBase);
  const cost = lendingCost(input, [{ adapter: marketId, amountBase, kind: 'deploy' }], p);
  const hurdleWad = costHurdleWad(cost, amountBase, artifact);
  const clears = ell > hurdleWad;
  return {
    kind: 'deploy', marketId, fromMarketId: null, amountBase, clears,
    edgeWad: ell, hurdleWad, costHurdleWad: hurdleWad, significanceWad: 0n,
    reason: clears ? 'DEPLOY_CLEARS' : `DEPLOY_BLOCKED: bound ${ell} <= hurdle ${hurdleWad}`,
  };
}

/**
 * §9.1.3 - a rotation clears when the annualised differential exceeds the
 * amortised round-trip cost plus k standard errors of the estimated edge.
 *
 * IMPORTANT 3: when the artifact's residual panel does not cover BOTH
 * venues (absent panel, or either id missing from `marketIds`), the
 * significance term silently reads `0n` and the rotation hurdle collapses
 * to cost-only - unconstrained churn with no signal that it happened. The
 * live service boots from `config/bootstrap-artifact.json`, which carries
 * no panel, so this is not a hypothetical. This never throws (the
 * provisional path must still load) but the returned `reason` always names
 * the degeneracy with a `; SIGNIFICANCE_UNAVAILABLE` suffix so it is
 * visible in a census rather than indistinguishable from a genuine
 * zero-dispersion estimate.
 */
export function rotateClears(
  input: DecisionInput,
  artifact: PolicyArtifact,
  curveTo: RateCurve,
  curveFrom: RateCurve,
  toId: string,
  fromId: string,
  amountBase: bigint,
  p: CostParams,
): LegVerdict {
  const edge = annualLowerBound(curveTo, artifact, toId, amountBase)
    - annualLowerBound(curveFrom, artifact, fromId, 0n);
  const cost = lendingCost(input, [
    { adapter: fromId, amountBase, kind: 'divest' },
    { adapter: toId, amountBase, kind: 'deploy' },
  ], p);
  const costHurdle = costHurdleWad(cost, amountBase, artifact);
  const kFixed = BigInt(Math.round(artifact.noTradeBandK * 1_000_000));
  const significanceWad = (edgeStandardErrorWad(artifact, toId, fromId) * kFixed) / 1_000_000n;
  const hurdleWad = costHurdle + significanceWad;
  const clears = edge > hurdleWad;
  const coverageSuffix = panelCoversBoth(artifact, toId, fromId) ? '' : '; SIGNIFICANCE_UNAVAILABLE';
  return {
    kind: 'rotate', marketId: toId, fromMarketId: fromId, amountBase, clears,
    edgeWad: edge, hurdleWad, costHurdleWad: costHurdle, significanceWad,
    reason: (clears ? 'ROTATE_CLEARS' : `ROTATE_BLOCKED: edge ${edge} <= hurdle ${hurdleWad}`) + coverageSuffix,
  };
}
