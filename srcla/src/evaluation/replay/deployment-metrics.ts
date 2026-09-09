/**
 * §11.4's deployment metrics. The v0.6 run record reported a policy that never
 * deployed as though its only defect were a low return; no metric separated
 * "allocated badly" from "did not allocate". PURE.
 *
 * Two census functions, because the two things they read are shaped
 * differently:
 *
 *  - `accumulateCensus` reads `LegVerdict[]` — the per-leg reasoning from
 *    `steps/hurdles.ts`/`steps/legs.ts` (§9.1.2/§9.1.3's deploy/rotate
 *    hurdles, plus the unconditional divest-to-idle legs).
 *  - `accumulateGateCensus` reads one `CostGateResult` — the AGGREGATE
 *    outcome (`decide.ts`'s brakes in `steps/cost.ts#applyBrakes`, or the
 *    per-origin bypass/hold reasons), which is not expressed as a leg at
 *    all. In particular, a churn brake fires on the FINAL executed vector —
 *    which may already be `chooseExecuted`'s divest-only backoff — so its
 *    `reason` string alone (`'REVERSAL_ALLOWANCE: ...'`, say) cannot tell "a
 *    brake blocked the full move" from "a brake blocked the move that had
 *    ALREADY backed off to the risk-reducing subset". `CostGateResult
 *    .backedOff` carries that distinction; this function is what turns it
 *    into a separate census key rather than leaving it to be re-derived by
 *    parsing prose.
 *
 * Both accumulate into the SAME `into` record (callers merge freely), because
 * a reader wants one table of "what happened, and how often" per run.
 */
import type { LegVerdict } from '../../policy/steps/hurdles.js';
import type { CostGateResult } from '../../policy/types.js';

/**
 * Reason-code prefix -> count, from one origin's leg verdicts.
 *
 * A leg that CLEARED is not a block and is skipped for the block count — but
 * `; SIGNIFICANCE_UNAVAILABLE` is tracked regardless of `clears`
 * (`hurdles.ts#rotateClears` appends it whether or not the rotation cleared):
 * it names a degeneracy in how the edge was priced, not a blocked leg, so it
 * would be invisible to a census that only ever looked at blocks.
 */
export function accumulateCensus(
  verdicts: readonly LegVerdict[],
  into: Record<string, number> = {},
): Record<string, number> {
  for (const v of verdicts) {
    if (v.reason.endsWith('SIGNIFICANCE_UNAVAILABLE')) {
      into['SIGNIFICANCE_UNAVAILABLE'] = (into['SIGNIFICANCE_UNAVAILABLE'] ?? 0) + 1;
    }
    if (v.clears) continue;
    const code = v.reason.split(':')[0]!.trim();
    into[code] = (into[code] ?? 0) + 1;
  }
  return into;
}

/**
 * Reason-code prefix -> count, from one origin's AGGREGATE gate outcome.
 *
 * Only a refusal (`!passed`) is a block. When it fired on the divest-only
 * backoff (`backedOff === true`), the code is prefixed `BACKOFF_THEN_` so it
 * is never conflated with the same brake firing on the full target — the two
 * call for different fixes (the first says the risk-reducing fallback is
 * itself over-constrained; the second says the ordinary path is).
 */
export function accumulateGateCensus(
  gate: CostGateResult,
  into: Record<string, number> = {},
): Record<string, number> {
  if (gate.passed) return into;
  const code = gate.reason.split(':')[0]!.trim();
  const key = gate.backedOff ? `BACKOFF_THEN_${code}` : code;
  into[key] = (into[key] ?? 0) + 1;
  return into;
}

/**
 * Time-averaged fraction of NAV actually deployed, over a run's snapshot
 * series. 0 for an all-idle run, 1 for a fully deployed one.
 */
export function capitalAtWork(
  series: ReadonlyArray<{ idleBase: bigint; deployedBase: bigint }>,
): number {
  if (series.length === 0) return 0;
  let num = 0;
  for (const s of series) {
    const total = s.idleBase + s.deployedBase;
    num += total === 0n ? 0 : Number((s.deployedBase * 1_000_000n) / total) / 1_000_000;
  }
  return num / series.length;
}

/** Origins elapsed before the first admitted deployment; null if never. */
export function deploymentLatency(
  series: ReadonlyArray<{ deployedBase: bigint }>,
): number | null {
  const i = series.findIndex((s) => s.deployedBase > 0n);
  return i < 0 ? null : i;
}
