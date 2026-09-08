import type { DecisionInput, ReserveResult, WithdrawalObservation } from '../types.js';

export interface StressScenario {
  name: string;
  /** Demand as a fraction of total assets, in basis points. */
  demandBps: number;
  /** Haircut applied to each venue's executable exit under this scenario, in bps. */
  liquidityHaircutBps: number;
}

/**
 * Registered stress set (paper §8.1 / Appendix B: "5%, 10%, 25%, 50% of
 * TVL"). The four `demandBps` values are registered — both the paper and
 * SRCLA-REPORT.md (§"Withdrawal success", the release-gate table, and
 * Appendix "Stress demand set") cite exactly 5/10/25/50%.
 *
 * Whole-branch review, MEDIUM 7 (provenance correction): the per-scenario
 * `liquidityHaircutBps` values (0/1000/2500/5000, i.e. graduated 0-50%) are
 * NOT from that source. SRCLA-REPORT.md describes only a single binary
 * "conservative" variant — "assuming the vault's own supplied cash has been
 * borrowed out" — applied uniformly to the whole stress test, not a
 * graduated per-scenario schedule. This graduated schedule (which happens to
 * equal `demandBps` in three of the four rows) is this implementation's own
 * construction, not a measured or registered figure. Treat it as a design
 * choice to be justified or replaced, not as ground truth to cite.
 */
export const STRESS_SCENARIOS: readonly StressScenario[] = [
  { name: 'w5', demandBps: 500, liquidityHaircutBps: 0 },
  { name: 'w10', demandBps: 1000, liquidityHaircutBps: 1000 },
  { name: 'w25', demandBps: 2500, liquidityHaircutBps: 2500 },
  { name: 'w50', demandBps: 5000, liquidityHaircutBps: 5000 },
] as const;

/** Q_beta(W_H): the beta-quantile of rolling H-second withdrawal demand. */
export function demandQuantileBase(
  withdrawals: WithdrawalObservation[],
  originSeconds: number,
  horizonSeconds: number,
  quantile: number
): bigint {
  if (withdrawals.length === 0) return 0n;

  const sorted = [...withdrawals].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const totals: bigint[] = [];

  for (const anchor of sorted) {
    if (anchor.timestampSeconds > originSeconds) continue;
    const windowStart = anchor.timestampSeconds - horizonSeconds;
    let sum = 0n;
    for (const w of sorted) {
      if (w.timestampSeconds > anchor.timestampSeconds) break;
      if (w.timestampSeconds > windowStart) sum += w.assetsBase;
    }
    totals.push(sum);
  }

  if (totals.length === 0) return 0n;
  totals.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const idx = Math.min(totals.length - 1, Math.floor(quantile * totals.length));
  return totals[idx]!;
}

/**
 * P3 — I_req(x) = max( floor,
 *                       Q_beta(W_H) - sum_i min(x_i, e_i^cons),
 *                       max_s { D_s - E_s(x) } )                         (paper §8.1)
 *
 * Both the demand term and the stress term are netted against executable venue
 * exits. Holding idle USDC against demand that deeply liquid venues can already
 * absorb is pure cash drag — that is the entire point of amendment P3, and why
 * this function's result must move when `target` moves.
 *
 * `scenarioFeasible` reports the SEPARATE per-scenario constraint the paper
 * states directly (§8.1):
 *
 *     w_0 * V_t + sum_i min(x_i, e_{i,s}) >= D_s     for every scenario s
 *
 * `w_0 * V_t` is the idle cash left over AFTER the candidate allocation, i.e.
 * `totalAssetsBase - sum_i x_i` (the raw candidate amounts, not haircut/capped —
 * that capping only happens on the *exit* side, `e_{i,s}`). This is NOT the
 * same quantity as `totalAssetsBase - E_s(x)`: `E_s(x) <= sum_i x_i` whenever a
 * venue's stressed exit is capacity-constrained below its target, so substituting
 * `E_s(x)` for `sum_i x_i` overstates idle cash and can vacuously report every
 * scenario feasible. Concretely, with this registered scenario set demand never
 * exceeds 50% of total assets (`demandBps` tops out at 5000), so a feasibility
 * test built on `shortfall <= totalAssetsBase - exitsS` reduces to
 * `demandS <= totalAssetsBase`, which is unconditionally true — no candidate
 * could ever be flagged infeasible, silently defeating the "reject before
 * comparing returns" gate the next task's optimiser relies on.
 */
export interface ReserveOpts {
  quantile: number;
  horizonSeconds: number;
  /**
   * P3 netting of the withdrawal quantile against executable venue exits.
   * Default `true` (the registered policy). Baseline B3 (paper §11.2 — "omit
   * the dependency policy and the P3 netting of the withdrawal quantile")
   * sets this to `false`, which makes the demand term the RAW quantile
   * Q_beta(W_H) in USDC base units rather than `Q_beta(W_H) - sum_i
   * min(x_i, e_i^cons)`. Only the demand term is affected; the stress term
   * keeps netting against `E_s(x)` because §8.1 states it that way
   * independently of P3.
   */
  netting?: boolean;
  /**
   * H4 (paper §11.3 — "remove the dynamic reserve and stress feasibility;
   * admin floor only"). When `true`, `requiredBase` is exactly `floorBase`
   * (max of adminReserve, minIdleBps floor and any activated dynamic
   * reserve), the demand and stress terms are reported as 0 base units, and
   * `scenarioFeasible` is EMPTY — an empty list is what makes optimize.ts's
   * `scenarioFeasible.some(s => !s.feasible)` rejection inert, which is the
   * "no stress feasibility" half of the hypothesis. It is NOT the same as
   * `disable.reserve`, which removes the floor as well (that is B2u).
   */
  floorOnly?: boolean;
}

export function requiredReserve(
  input: DecisionInput,
  target: Map<string, bigint>,
  opts: ReserveOpts
): ReserveResult {
  const { totalAssetsBase, adminReserveBase, dynamicReserveBase, minIdleBps } = input.vault;

  const bpsFloor = (totalAssetsBase * BigInt(minIdleBps)) / 10_000n;
  // Whole-branch review, HIGH 5: the vault enforces `requiredIdle() =
  // max(adminReserve, dynamicReserve)` on-chain (NavyVaultSRCLA.sol) --
  // `dynamicReserveBase` (the reserve an earlier plan already activated,
  // §8.1's "an activated dynamic reserve persists after plan expiry")
  // must be part of this off-chain floor too, or a newly computed reserve
  // that is LOWER than the previous plan's can size a deploy against a
  // floor the on-chain call will reject with InsufficientIdle.
  let floorBase = adminReserveBase > bpsFloor ? adminReserveBase : bpsFloor;
  if (dynamicReserveBase > floorBase) floorBase = dynamicReserveBase;

  /** e_i^cons for the candidate target, optionally haircut for a stress scenario. */
  const executable = (haircutBps: number): bigint => {
    let sum = 0n;
    for (const m of input.markets) {
      const x = target.get(m.marketId) ?? 0n;
      const capacity = m.maxWithdrawableBase < x ? m.maxWithdrawableBase : x;
      sum += (capacity * BigInt(10_000 - haircutBps)) / 10_000n;
    }
    return sum;
  };

  /** sum_i x_i over markets this decision actually knows about — the capital the
   *  candidate takes out of idle, independent of any venue's exit capacity. */
  let allocatedBase = 0n;
  for (const m of input.markets) {
    allocatedBase += target.get(m.marketId) ?? 0n;
  }
  // Guard: an over-allocated (invalid) candidate must not underflow idle to a
  // negative bigint that would silently poison the max() below.
  const idleAfterAllocationBase = totalAssetsBase > allocatedBase ? totalAssetsBase - allocatedBase : 0n;

  const demand = demandQuantileBase(
    input.withdrawals,
    input.origin.timestampSeconds,
    opts.horizonSeconds,
    opts.quantile
  );
  const exec0 = executable(0);
  // Guard: demand netted against executable exits can go negative when a
  // venue can absorb more than currently observed demand.
  // `netting === false` (B3) keeps the raw quantile instead. Both branches
  // are USDC base units (6 dp).
  const netting = opts.netting ?? true;
  const netDemand = netting ? (demand > exec0 ? demand - exec0 : 0n) : demand;

  let stressShortfall = 0n;
  const scenarioFeasible: ReserveResult['scenarioFeasible'] = [];

  for (const s of STRESS_SCENARIOS) {
    const demandS = (totalAssetsBase * BigInt(s.demandBps)) / 10_000n;
    const exitsS = executable(s.liquidityHaircutBps);
    // Guard: D_s - E_s(x) can go negative when the stressed exit alone covers
    // stressed demand.
    const shortfall = demandS > exitsS ? demandS - exitsS : 0n;
    if (shortfall > stressShortfall) stressShortfall = shortfall;

    // Paper §8.1: w_0*V_t + sum_i min(x_i, e_{i,s}) >= D_s. w_0*V_t is idle
    // AFTER the candidate allocation (guarded above), not total assets minus
    // the exit value — see the function-level note for why that substitution
    // is wrong.
    scenarioFeasible.push({
      scenario: s.name,
      feasible: idleAfterAllocationBase + exitsS >= demandS,
      shortfallBase: shortfall,
    });
  }

  if (opts.floorOnly === true) {
    // H4: admin floor only. Every quantity below is USDC base units (6 dp).
    return {
      requiredBase: floorBase,
      floorBase,
      netDemandQuantileBase: 0n,
      stressShortfallBase: 0n,
      scenarioFeasible: [],
    };
  }

  let requiredBase = floorBase;
  if (netDemand > requiredBase) requiredBase = netDemand;
  if (stressShortfall > requiredBase) requiredBase = stressShortfall;

  return {
    requiredBase,
    floorBase,
    netDemandQuantileBase: netDemand,
    stressShortfallBase: stressShortfall,
    scenarioFeasible,
  };
}
