/**
 * §7.3's two decision-focused loss terms, computed by running the REGISTERED
 * DECISION RULE over the calibration era under a candidate artifact.
 *
 * This is what couples the forecast to its consumer. v0.6 selected a horizon
 * on forecast accuracy alone and the winning horizon left the movement rule
 * unable to act; no accuracy statistic can see that. §7.3 has always named
 * seven terms and the implementation carried five, so the two that price the
 * consequence of a forecast were structurally absent from the selection.
 *
 * DETERMINISTIC: the subsample is every Nth origin in time order, never a
 * random draw, and `everyNth` is recorded in the artifact's registration.
 *
 * PURE: no I/O, no Date.now(), no randomness. `decide` is itself pure, so two
 * runs over the same origins under the same artifact return identical scores.
 */
import { decide } from '../policy/decide.js';
import type { DecideOpts } from '../policy/decide.js';
import type { DecisionInput, PolicyArtifact } from '../policy/types.js';

export interface DecisionScore {
  /**
   * Total notional moved, as a multiple of vault NAV, SUMMED over every
   * scored origin (not averaged) -- so it is comparable across candidates
   * only at a fixed `originsScored`, which the grid holds constant.
   */
  turnover: number;
  /**
   * Return foregone by hurdle rejections: at each origin, the annualised
   * conservative gain of the target the optimiser wanted minus that of the
   * position actually held, accumulated over the era and expressed as APY.
   * Averaged per scored origin, and clamped at zero per leg -- see the loop
   * below for why the clamp is load-bearing rather than cosmetic.
   */
  sacrificedReturn: number;
  /** Origins at which `decide` returned `action: 'rebalance'`. */
  rebalances: number;
  /** Origins actually visited, i.e. after the stride. */
  originsScored: number;
}

export function scoreCandidateDecisions(
  origins: readonly DecisionInput[],
  artifact: PolicyArtifact,
  opts: DecideOpts,
  subsample: { everyNth: number },
): DecisionScore {
  const n = Math.max(1, Math.round(subsample.everyNth));
  let turnover = 0, sacrificed = 0, rebalances = 0, scored = 0;

  for (let i = 0; i < origins.length; i += n) {
    const input = origins[i]!;
    const out = decide(input, artifact, opts);
    scored += 1;
    const nav = Number(input.vault.totalAssetsBase);
    if (nav <= 0) continue;

    if (out.action === 'rebalance') {
      rebalances += 1;
      let moved = 0n;
      for (const leg of out.costGate.legs ?? []) if (leg.clears) moved += leg.amountBase;
      turnover += Number(moved) / nav;
    }

    // Sacrificed return: what the blocked legs would have added, at the
    // conservative bound, annualised. A candidate whose hurdle never opens
    // accumulates the whole available edge here.
    //
    // THE EDGE IS CLAMPED AT ZERO, and that clamp is load-bearing. A blocked
    // leg whose conservative bound is NEGATIVE forgoes nothing -- refusing it
    // is the hurdle working, not a sacrifice -- and on the real calibration
    // grid most blocked legs are exactly that: at a 1-day horizon the
    // annualised residual quantile alone is around -18%, so the bound sits
    // well below zero and every blocked leg would contribute a large NEGATIVE
    // number. Summed signed, the term is minimised (and `LOSS_WEIGHTS` treats
    // lower as better) by the candidate whose bounds are most negative, i.e.
    // the one LEAST able to trade. That is an exact inversion of what §7.3
    // asks this term for and would re-create, with a weight of 3.0 behind it,
    // the over-conservatism P18 exists to detect. Only a positive forgone
    // bound is a forgone return.
    for (const leg of out.costGate.legs ?? []) {
      if (leg.clears) continue;
      const edge = Number(leg.edgeWad) / 1e18;
      if (edge <= 0) continue;
      sacrificed += edge * (Number(leg.amountBase) / nav);
    }
  }

  return {
    turnover,
    sacrificedReturn: scored === 0 ? 0 : sacrificed / scored,
    rebalances,
    originsScored: scored,
  };
}
