/**
 * §9.3 - the event-driven harvest gate.
 *
 * "There is no weekly or fixed-period harvest transaction. The off-chain
 * collector observes rewards every 15 minutes without paying gas. SRCLA
 * attempts a harvest when claimable value is material and
 *
 *     conservative USDC output
 *       > C_claim + C_approve/reset + C_swap + C_L1data + C_impact
 *         + C_slippage/MEV + C_buffer."
 *
 * WHY THIS IS NOT A STEP INSIDE `decide()`. Harvest is triggered by reward
 * state, not by the allocation cycle, so it is a parallel pure function on the
 * same snapshot path. Folding it into `decide()` would couple a harvest to a
 * rebalance decision that §9.3 explicitly decouples it from.
 *
 * PURE, on the same terms as `decide()`: no I/O, no `Date.now()`, no
 * randomness. Time and prices arrive through `DecisionInput` and each
 * `RewardObservation`.
 *
 * UNITS. Money is bigint USDC base units (6 dp) throughout. Reward amounts are
 * raw token units and are converted in `reward-admission.ts`; nothing in this
 * file touches raw token units.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNWIRED, AND DELIBERATELY KEPT (readiness audit NEW-26's adjudication).
 * `evaluateHarvest` is referenced only by its own unit test.
 *
 * It is the ONLY §9.3-conformant implementation in the repo, and it is not a
 * duplicate of anything live — `src/rewards/reward-processor.ts` carried a
 * weaker rival rule (`(estimatedOutput - costs) > minValueThreshold` with a
 * hardcoded 5% haircut, no admission conjunction, no eleven-term cost model)
 * and was deleted for that reason, not this one.
 *
 * WHAT IS MISSING TO WIRE IT: a reward-observation collector. `HarvestParams`
 * needs `rewards: RewardObservation[]` and per-token `policies`, and nothing
 * in `src/` produces either — see `rewards/chainlink-oracle.ts`'s header for
 * the field-by-field list of what has a source and what does not. A harvest
 * SUBMISSION path is missing too: `NavyVaultSRCLA` routes a Harvest action
 * through `executeHarvestAction` with a `HarvestRequest` the caller supplies
 * (a generic `executeNextActionWithProof` on kind 2 reverts by design), and
 * `execution/keeper-executor.ts` has no such call.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { movementCostBase, type CostParams, type Move } from './steps/cost.js';
import {
  admitReward,
  recognizedRewardValueBase,
  unadmittedPolicy,
  type RewardObservation,
  type RewardTokenPolicy,
} from './steps/reward-admission.js';
import type { DecisionInput, PolicyArtifact } from './types.js';

export interface HarvestParams {
  /**
   * The same eleven-term cost parameterisation `decide()` uses, though a
   * caller may legitimately pass higher `impactBps`/`slippageBps`/`mevBps`
   * here: a reward-token -> USDC swap runs through a far thinner pool than a
   * USDC venue move.
   */
  cost: CostParams;
  /**
   * §9.3's "claimable value is material" threshold, USDC base units, compared
   * against the GROSS recognised value. Below it no harvest is attempted even
   * if it would clear cost - the point is to avoid a stream of dust harvests
   * that each individually pencil out.
   */
  materialThresholdBase: bigint;
  /**
   * The rewards observed on this snapshot. These live here rather than on
   * `DecisionInput` because the harvest path is parallel to the allocation
   * path and must not change the decision input the allocation kernel hashes.
   */
  rewards: RewardObservation[];
  /** Admin reward-token policies, keyed by LOWERCASE token address. */
  policies: Record<string, RewardTokenPolicy>;
}

export interface HarvestDecision {
  /** Adapter holding the reward. */
  adapter: string;
  /** Reward token address, as observed. */
  token: string;
  /**
   * §9.2 recognised gross value of claimable + held, USDC base units. Exactly
   * zero when the reward fails admission - a stale, expired, underfunded or
   * unpriceable reward contributes nothing, and in particular cannot raise it.
   */
  claimableBase: bigint;
  /** `claimableBase` after the token haircut and the absolute contribution cap. */
  conservativeOutBase: bigint;
  /** The full cost this harvest is charged, USDC base units. See COST NOTE. */
  costBase: bigint;
  /** Per-term breakdown, keyed by `MOVE_COST_TERMS`. */
  terms: Record<string, bigint>;
  fire: boolean;
  /** Why - always attributed to a single named rule, never left implicit. */
  reason: string;
}

/**
 * COST NOTE - what `costBase` contains and why it is a superset of §9.3's list.
 *
 * `movementCostBase` is reused verbatim rather than recomputed. Duplicating the
 * cost model is how the two drift: this project has already shipped a
 * pre-EIP-4844 calldata formula that overstated the L1 term by ~259x, and an
 * `l2` term that was an exact duplicate of `exit + entry + claim`.
 *
 * For a single `kind: 'harvest'` move, `movementCostBase` yields:
 *
 *   claim, approveReset, swap, l1Data, impact, slippageMev, buffer
 *       - exactly §9.3's seven terms.
 *   exit, entry
 *       - structurally 0: a harvest moves nothing between venues.
 *   l2, failure
 *       - two terms §9.3's prose does not enumerate but which are genuinely
 *         paid: `l2` is the plan-submission + `executeAction` dispatch
 *         overhead a harvest action incurs on this vault, and `failure` is the
 *         expected cost of a reverted attempt still burning gas. Including
 *         them makes the gate strictly MORE conservative than the paper's
 *         literal sum, which is the safe direction - the failure mode this
 *         gate exists to prevent is harvesting at a loss.
 *
 * The cost is charged against `grossBase`, not `conservativeOutBase`: the swap
 * moves the whole claimable position regardless of what the accounting cap lets
 * the vault recognise, so the notional-scaled terms must be sized to the real
 * trade.
 */
function costForHarvest(
  input: DecisionInput,
  adapter: string,
  notionalBase: bigint,
  cost: CostParams
): { totalBase: bigint; terms: Record<string, bigint> } {
  const move: Move = { adapter, amountBase: notionalBase, kind: 'harvest' };
  return movementCostBase(input, [move], cost);
}

/**
 * Evaluates every observed reward independently and returns one decision each.
 *
 * `_artifact` is accepted for signature conformance with the rest of the policy
 * layer (every other step takes the frozen artifact) and is deliberately not
 * read: §9.3's rule references no calibrated quantity - the gate is priced
 * entirely off the live gas/oracle observation and the admin token policy. It
 * is named with a leading underscore because `tsconfig.json` sets
 * `noUnusedParameters`.
 */
export function evaluateHarvest(
  input: DecisionInput,
  _artifact: PolicyArtifact,
  params: HarvestParams
): HarvestDecision[] {
  return params.rewards.map((o) => {
    const policy = params.policies[o.token.toLowerCase()] ?? unadmittedPolicy(o.token);
    const admission = admitReward(o, policy);
    const { grossBase, conservativeBase } = recognizedRewardValueBase(o, policy);
    const { totalBase, terms } = costForHarvest(input, o.adapter, grossBase, params.cost);

    const base = {
      adapter: o.adapter,
      token: o.token,
      claimableBase: grossBase,
      conservativeOutBase: conservativeBase,
      costBase: totalBase,
      terms,
    };

    if (!admission.admitted) {
      const failing = admission.reasons.filter((r) => !r.passed);
      const detail = failing.map((r) => `${r.code}(${r.detail})`).join('; ');
      return { ...base, fire: false, reason: `NOT_ADMITTED: ${detail}` };
    }

    if (grossBase < params.materialThresholdBase) {
      return {
        ...base,
        fire: false,
        reason: `IMMATERIAL: claimable ${grossBase} < threshold ${params.materialThresholdBase}`,
      };
    }

    if (conservativeBase <= totalBase) {
      return {
        ...base,
        fire: false,
        reason: `COST_EXCEEDS_OUTPUT: conservative out ${conservativeBase} <= cost ${totalBase}`,
      };
    }

    return {
      ...base,
      fire: true,
      reason: `OUTPUT_EXCEEDS_COST: conservative out ${conservativeBase} > cost ${totalBase}`,
    };
  });
}
