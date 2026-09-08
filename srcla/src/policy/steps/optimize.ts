import { rateAt } from './simulate.js';
import { lowerBoundAt, exitableFraction, withdrawableLowerBoundBase } from './forecast.js';
import { requiredReserve } from './reserve.js';
import { portfolioResidualQuantileFor } from './portfolio-quantile.js';
import type { DecisionInput, PolicyArtifact, RateCurve } from '../types.js';

const WAD = 10n ** 18n;
/** Matches forecast.ts's horizon-conversion convention exactly (365-day year,
 *  not the 365.25-day constant `protocols/math.ts` uses internally for
 *  per-second simulator math) so the ablated (`disable.portfolioBound`) and
 *  non-ablated branches of `portfolioLowerBound` stay on the same horizon
 *  scale as `lowerBoundAt`. */
const SECONDS_PER_YEAR = 31_536_000n;
/** Utilisation at which the structural liquidity cap begins to bind. */
const LIQUIDITY_KINK_WAD = (WAD * 80n) / 100n;

/**
 * §8.2's enumeration budget: the largest number of allocation quanta the
 * exhaustive check will walk. For a three-venue universe the search visits
 * every `(k_1, k_2, k_3)` with `sum k_i <= steps`, i.e. `C(steps+3, 3)`
 * candidates — 47,905 at 64. This is the same ceiling `verifyExhaustively`
 * already enforced; what changed is that the quantum now ADAPTS to it
 * instead of the check silently switching itself off.
 */
export const ENUMERATION_MAX_STEPS = 64;

/** Smallest value of the form {1,2,5} x 10^k that is >= `v`. */
function roundUpToGrid(v: bigint): bigint {
  if (v <= 1n) return 1n;
  let p = 1n;
  while (p * 10n <= v) p *= 10n;
  for (const m of [1n, 2n, 5n, 10n]) {
    if (m * p >= v) return m * p;
  }
  /* istanbul ignore next -- 10*p >= v always holds by construction of p. */
  return p * 10n;
}

/**
 * §8.2 - the allocation quantum, scaled so exhaustive enumeration stays
 * reachable at every vault size.
 *
 * WHY THIS EXISTS. `verifyExhaustively` returned `null` whenever
 * `totalAssets / quantumBase > 64`, and the production quantum is a FIXED
 * 1,000 USDC (`decide.ts`), which caps enumeration at a 64,000 USDC vault.
 * Three of the four registered tiers (100k, 1M, 10M) were therefore never
 * checked against enumeration at all, and the harness's own
 * `decideOptsForTier` made it worse by asking for 100 steps per tier.
 * §8.2's check was unreachable everywhere it mattered. (Audit NEW-18.)
 *
 * WHAT WAS CHOSEN, AND WHY. The quantum scales with the vault rather than
 * the enumeration running at a coarser grid than the greedy solver, because
 * §8.2 requires the check to be "at the SAME quantum" — a regret measured on
 * a different grid is not a bound on this solver's approximation error. So
 * `decide()` resolves ONE quantum and hands it to `simulateCurves`, the
 * greedy loop and the enumerator alike.
 *
 * The resolved quantum is rounded UP to the next {1,2,5} x 10^k so the grid
 * is legible and stable: 100k -> 2,000 USDC, 1M -> 20,000 USDC,
 * 10M -> 200,000 USDC, all at 50 steps, while a 10k vault keeps the
 * requested 1,000 USDC at 10 steps. The cost is resolution: at the 10M tier
 * the optimiser now allocates in 2%-of-TVL increments. That is the price of
 * §8.2's check being real, and it is the trade the paper asks for.
 *
 * The requested quantum is never LOWERED — a caller that deliberately asks
 * for a coarse grid keeps it.
 */
export function resolveQuantumBase(
  totalAssetsBase: bigint,
  requestedQuantumBase: bigint,
  maxSteps: number = ENUMERATION_MAX_STEPS
): bigint {
  if (requestedQuantumBase <= 0n) {
    throw new Error(`quantumBase must be positive, got ${requestedQuantumBase}`);
  }
  if (totalAssetsBase <= 0n) return requestedQuantumBase;
  if (totalAssetsBase / requestedQuantumBase <= BigInt(maxSteps)) return requestedQuantumBase;

  const steps = BigInt(maxSteps);
  // Ceiling division: `steps` quanta must cover the whole vault.
  const raw = (totalAssetsBase + steps - 1n) / steps;
  // No max() against the requested quantum here, and it is not an omission.
  // Reaching this line requires `floor(total/requested) > maxSteps`, i.e.
  // `total >= (maxSteps+1) * requested`, which makes
  // `raw = ceil(total/maxSteps) >= requested + ceil(requested/maxSteps) >
  // requested`. The result is strictly coarser than what was asked for by
  // construction, so a `rounded > requested ? rounded : requested` guard is
  // dead code - it was written, and a mutation that deleted it survived the
  // suite because no input can reach it. The "never lowers a deliberately
  // coarse quantum" property is carried entirely by the early return above.
  return roundUpToGrid(raw);
}

/**
 * The registered ablation/baseline switch set. Each key removes EXACTLY the
 * one named component; every other constraint stays live (paper §11.3: "Each
 * hypothesis removes only its named component while holding other
 * information, delays, costs, and rules fixed").
 *
 * Paper mapping — the evaluation harness must drive H1-H7 through these and
 * nothing else:
 *
 *   H1 capacity            -> capacityCurves   (decide.ts: flat displayed-rate curves)
 *   H2 uncertainty         -> uncertainty      (drop the calibrated residual quantile)
 *   H3 cost                -> costGate         (decide.ts: skip the gate AND the band)
 *   H4 liquidity           -> dynamicReserve   (reserve.ts floorOnly: admin floor only)
 *   H5 dependency          -> dependencyCaps
 *   H6 structural liq. cap -> liquidityCap
 *   H7 phi weighting       -> exitableWeight
 *
 * Two further keys are NOT hypotheses; they exist because §11.2's baselines
 * need them:
 *   reserve        -> B2u ("B2 without any reserve"): removes the floor too.
 *   netting        -> B3 ("omit ... the P3 netting of the withdrawal quantile").
 * And one is a diagnostic on P2's aggregation, not an H:
 *   portfolioBound -> sum per-venue lower bounds instead of one portfolio bound.
 */
export type PolicyAblation =
  | 'capacityCurves'
  | 'uncertainty'
  | 'costGate'
  | 'dynamicReserve'
  | 'dependencyCaps'
  | 'liquidityCap'
  | 'exitableWeight'
  | 'reserve'
  | 'netting'
  | 'portfolioBound';

export type PolicyAblations = Partial<Record<PolicyAblation, boolean>>;

export interface OptimizeOpts {
  quantumBase: bigint;
  reserveQuantile: number;
  reserveHorizonSeconds: number;
  /** Disable individual components for the H1-H7 ablations. Each switch
   *  removes ONLY its named component; every other constraint stays live. */
  disable?: PolicyAblations;
}

/** The reserve-shaping half of the switch set, in the shape reserve.ts takes.
 *  Kept here so decide.ts and optimize.ts cannot derive it differently — a
 *  candidate scored against one reserve rule and then executed against
 *  another is exactly the divergence §11.1's equal-information requirement
 *  forbids. */
export function reserveOptsFrom(
  disable: PolicyAblations,
  opts: { reserveQuantile: number; reserveHorizonSeconds: number }
): import('./reserve.js').ReserveOpts {
  return {
    quantile: opts.reserveQuantile,
    horizonSeconds: opts.reserveHorizonSeconds,
    netting: disable.netting !== true,
    floorOnly: disable.dynamicReserve === true,
  };
}

/**
 * P5 - a deterministic cap that decreases toward zero as a venue approaches its
 * kink. Requires no forecast. On 2026-07-21 Moonwell quoted 86.26% APR at
 * 100.04% utilisation holding $6,163 of cash; this cap is what excludes it -
 * not a zero-cash check, since real incidents like that one hold non-trivial
 * residual cash right up to (and past) 100% utilisation.
 */
export function liquidityCapBase(m: import('../types.js').MarketObservation): bigint {
  if (m.utilizationWad >= WAD) return 0n;
  if (m.cash <= 0n) return 0n;
  if (m.utilizationWad <= LIQUIDITY_KINK_WAD) return m.cash;

  // Linear decay from full cash at the kink to zero at 100% utilisation.
  const span = WAD - LIQUIDITY_KINK_WAD;
  const remaining = WAD - m.utilizationWad;
  return (m.cash * remaining) / span;
}

/** §6.1 - effective limit is the minimum of every applicable bound (P5 amends
 *  in the structural liquidity cap alongside the pre-existing percentage,
 *  absolute and protocol-headroom bounds). */
export function effectiveCapBase(
  m: import('../types.js').MarketObservation,
  totalAssetsBase: bigint,
  disableLiquidityCap = false
): bigint {
  const pct = (totalAssetsBase * BigInt(m.capBps)) / 10_000n;
  let cap = pct;
  if (m.absoluteCapBase < cap) cap = m.absoluteCapBase;
  const headroom = m.positionBase + m.maxDeployableBase;
  if (headroom < cap) cap = headroom;
  if (!disableLiquidityCap) {
    const liq = m.positionBase + liquidityCapBase(m);
    if (liq < cap) cap = liq;
  }
  return cap < 0n ? 0n : cap;
}

/** Point forecast mu_hat_i,t,H(x): the annualised curve rate at cumulative
 *  allocation x, converted to the horizon. Delegates all curve lookup/
 *  interpolation to `rateAt` (simulate.ts) - this module never re-derives
 *  that arithmetic. */
function pointForecastAt(curve: RateCurve, xBase: bigint, horizonSeconds: number): bigint {
  return (rateAt(curve, xBase) * BigInt(horizonSeconds)) / SECONDS_PER_YEAR;
}

/**
 * P2 + P4 - the objective. mu_p is the exitable-weighted sum of per-venue
 * horizon means; the portfolio residual quantile is applied once to the
 * portfolio's combined notional, not summed per venue (which is why it is
 * added once, outside the per-curve loop, scaled by total notional rather
 * than inside the loop scaled by each x_i - those are NOT interchangeable
 * when per-venue quantiles differ, which is exactly what the
 * `disable.portfolioBound` (H2) branch below exercises).
 *
 * `disable.portfolioBound` reproduces the H2 marginal-sum baseline: each
 * venue's OWN calibrated per-venue lower bound (`lowerBoundAt`, carrying its
 * own quantile from `residualQuantileWadByMarket`) is summed instead of a
 * single portfolio-level quantile applied once.
 */
export function portfolioLowerBound(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  target: Map<string, bigint>,
  disable: OptimizeOpts['disable'] = {}
): bigint {
  let mu = 0n;

  for (const c of curves) {
    const x = target.get(c.marketId) ?? 0n;
    if (x === 0n) continue;
    const m = input.markets.find((k) => k.marketId === c.marketId)!;

    // H2 (`disable.uncertainty`) removes the calibrated lower bound entirely
    // and scores on the point forecast — including inside the
    // `portfolioBound` branch, whose per-venue `lowerBoundAt` IS a
    // calibrated bound. Rate units: WAD, already converted to the horizon.
    const perVenue =
      disable.portfolioBound && disable.uncertainty !== true
        ? lowerBoundAt(c, artifact, c.marketId, x, artifact.horizonSeconds)
        : pointForecastAt(c, x, artifact.horizonSeconds);

    // §7.2's second forecast target supplies phi's denominator, not the spot
    // `maxWithdrawableBase` reading (audit NEW-11).
    const phi = disable.exitableWeight ? 1 : exitableFraction(x, withdrawableLowerBoundBase(m, artifact));
    mu += (perVenue * x * BigInt(Math.round(phi * 1_000_000))) / (WAD * 1_000_000n);
  }

  // H2: no residual quantile at any level — the objective is the raw
  // exitable-weighted point forecast (USDC base units over the horizon).
  if (disable.uncertainty === true) return mu;
  if (disable.portfolioBound) return mu;
  const notional = [...target.values()].reduce((s, v) => s + v, 0n);
  // q^p_alpha(w): a lower quantile of the PORTFOLIO residual series under
  // THIS candidate's weights, not a frozen scalar. Applied once to total
  // notional (the aggregation was already right); what changed is that the
  // quantile now depends on the mix, so two candidates deploying the same
  // total in different proportions no longer receive an identical term and
  // P2 can actually change a ranking. See steps/portfolio-quantile.ts.
  return mu + (portfolioResidualQuantileFor(artifact, target) * notional) / WAD;
}

/**
 * §8.2 - greedy fill at the allocation quantum over conservative curves, then
 * exhaustive verification at the same quantum for small universes, returning
 * the approximation regret as part of this function's result (`enumeration`
 * below). Whole-branch review, MEDIUM 7: nothing in `src/` actually persists
 * that regret anywhere durable today -- `DecisionOutput.enumeration` is
 * written into the in-memory decision only; `persistDecisionOutput`
 * (runtime/decision-driver.ts) writes admissions/forecasts/reserve/
 * allocation/actionDecision into the `Decision` row but not `enumeration`,
 * and the `EnumerationResult` Prisma model (prisma/schema.prisma) has no
 * writer anywhere in `src/` (verified by grep). §10.2's storage requirement
 * for this value is not yet met; a future task must either write it there or
 * this comment must be corrected again once it does. A candidate that fails
 * any stress scenario is rejected BEFORE returns are compared (§8.1) -
 * `feasible` below always runs the reserve/scenario check ahead of any
 * objective comparison.
 *
 * PURE: no I/O, no Date.now(), no randomness. The tie-break is total: markets
 * are visited in sorted id order and only a strictly-greater objective value
 * displaces the incumbent choice, so an equal-value alternative never wins.
 */
export function optimize(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  opts: OptimizeOpts
): { target: Map<string, bigint>; enumeration: { regretBps: bigint; enumerated: number; passed: boolean } | null } {
  const disable = opts.disable ?? {};
  const { totalAssetsBase } = input.vault;
  // Idempotent: `decide()` has already resolved this, so the curves the
  // objective reads and the grid the search walks share one quantum. Applied
  // again here so a caller that reaches `optimize` directly cannot end up
  // with an unenumerable grid.
  const q = resolveQuantumBase(totalAssetsBase, opts.quantumBase);

  const caps = new Map<string, bigint>();
  for (const c of curves) {
    const m = input.markets.find((k) => k.marketId === c.marketId)!;
    caps.set(c.marketId, effectiveCapBase(m, totalAssetsBase, disable.liquidityCap));
  }

  const groupCap = (groupId: string): bigint => {
    const g = input.dependencyGroups.find((x) => x.id === groupId)!;
    const pct = (totalAssetsBase * BigInt(g.capBps)) / 10_000n;
    return pct < g.absoluteCapBase ? pct : g.absoluteCapBase;
  };

  const feasible = (candidate: Map<string, bigint>): boolean => {
    const deployed = [...candidate.values()].reduce((s, v) => s + v, 0n);
    if (deployed > totalAssetsBase) return false;

    for (const [id, x] of candidate) {
      if (x > (caps.get(id) ?? 0n)) return false;
    }

    if (!disable.dependencyCaps) {
      for (const g of input.dependencyGroups) {
        let sum = 0n;
        for (const member of g.members) sum += candidate.get(member) ?? 0n;
        if (sum > groupCap(g.id)) return false;
      }
    }

    if (!disable.reserve) {
      const r = requiredReserve(input, artifact, candidate, reserveOptsFrom(disable, opts));
      // Guard: deployed can equal totalAssetsBase exactly (idle 0), never
      // exceed it (checked above), so this subtraction cannot underflow.
      if (totalAssetsBase - deployed < r.requiredBase) return false;
      // §8.1 - a target that fails ANY stress scenario is rejected before
      // returns are compared, not scored-and-penalised.
      if (r.scenarioFeasible.some((s) => !s.feasible)) return false;
    }

    return true;
  };

  // Greedy: repeatedly add one quantum wherever it raises the objective most.
  const target = new Map<string, bigint>(curves.map((c) => [c.marketId, 0n]));
  const steps = Number(totalAssetsBase / q);

  for (let step = 0; step < steps; step++) {
    let bestId: string | null = null;
    let bestValue = portfolioLowerBound(input, curves, artifact, target, disable);

    // Deterministic tie-break: markets are visited in sorted id order, and
    // only a strictly-greater value displaces the incumbent - an equal-value
    // alternative discovered later in the sort never wins.
    const ids = [...target.keys()].sort();
    for (const id of ids) {
      const trial = new Map(target);
      trial.set(id, (trial.get(id) ?? 0n) + q);
      if (!feasible(trial)) continue;
      const value = portfolioLowerBound(input, curves, artifact, trial, disable);
      if (value > bestValue) {
        bestValue = value;
        bestId = id;
      }
    }

    if (bestId === null) break;
    target.set(bestId, (target.get(bestId) ?? 0n) + q);
  }

  const enumeration = verifyExhaustively(input, curves, artifact, opts, target, feasible);
  return { target, enumeration };
}

/** §8.2 - real enumeration for a small universe; regret is measured against
 *  the actual best feasible candidate found by brute force, never assumed or
 *  hardcoded. Returns null (not a guess) when the universe is too large to
 *  enumerate at this quantum - the check exists to validate the greedy
 *  solver, never to replace or dominate it. */
function verifyExhaustively(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  opts: OptimizeOpts,
  greedy: Map<string, bigint>,
  feasible: (c: Map<string, bigint>) => boolean
): { regretBps: bigint; enumerated: number; passed: boolean } | null {
  const n = curves.length;
  if (n === 0 || n > 3) return null;

  const q = resolveQuantumBase(input.vault.totalAssetsBase, opts.quantumBase);
  const steps = Number(input.vault.totalAssetsBase / q);
  // Retained as a hard ceiling on the walk, not as the reason enumeration is
  // skipped: `resolveQuantumBase` keeps `steps` at or under the budget for
  // ANY vault size, so this can only fire if a caller overrides the budget.
  if (steps > ENUMERATION_MAX_STEPS) return null;

  const disable = opts.disable;
  const greedyValue = portfolioLowerBound(input, curves, artifact, greedy, disable);
  let best = greedyValue;
  let enumerated = 0;

  const ids = curves.map((c) => c.marketId).sort();
  const walk = (i: number, remaining: number, acc: Map<string, bigint>): void => {
    if (i === ids.length) {
      enumerated++;
      if (!feasible(acc)) return;
      const v = portfolioLowerBound(input, curves, artifact, acc, disable);
      if (v > best) best = v;
      return;
    }
    for (let k = 0; k <= remaining; k++) {
      const next = new Map(acc);
      next.set(ids[i]!, q * BigInt(k));
      walk(i + 1, remaining - k, next);
    }
  };
  walk(0, steps, new Map());

  // best is measured from the actual enumerated feasible candidates (and
  // seeded with the greedy value so best >= greedyValue always) - never a
  // hardcoded constant. regretBps is only defined when best is strictly
  // positive; a non-positive best (no profitable allocation exists) reports
  // zero regret rather than dividing by a non-positive denominator.
  const regretBps = best > 0n ? ((best - greedyValue) * 10_000n) / best : 0n;

  return { regretBps, enumerated, passed: regretBps >= 0n && regretBps <= 100n };
}
