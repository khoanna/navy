/**
 * The registered policy set of paper §11.2 (B0-B5 + B2u) and §11.3 (H1-H7),
 * expressed ENTIRELY as switch settings on the one kernel in
 * `src/policy/decide.ts`.
 *
 * There is deliberately no allocator, cost model, forecaster or reserve rule
 * in this file. The two harnesses this replaces each carried their own —
 * `evaluation-v2/evaluate.mjs` had its own allocator and cost model and
 * imported nothing from `src/`, and `src/evaluation/srcla-policy.ts` imported
 * exactly one production symbol — so an "SRCLA vs B*" delta from either was
 * not a measurement of the policy. Every row below runs the same `decide`
 * over the same `DecisionInput`.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates are WAD annualized.
 */
import { decide, type DecideOpts } from '../../policy/decide.js';
import { admit } from '../../policy/steps/admit.js';
import { requiredReserve } from '../../policy/steps/reserve.js';
import type { PolicyAblations } from '../../policy/steps/optimize.js';
import type { DecisionInput, PolicyArtifact } from '../../policy/types.js';
import type { BaselineAction } from '../replay/replay.js';

/** How a registered policy departs from running the plain kernel. */
export type PolicyShape =
  /** Runs `decide` with `disable`. */
  | 'kernel'
  /** Takes no action ever (B0). */
  | 'idle'
  /** One equal-weight allocation over the first eligible set, then frozen (B4). */
  | 'frozen-equal-weight'
  /** `decide` over rates replaced by their realized outcome (B5). */
  | 'hindsight';

export interface RegisteredPolicy {
  id: string;
  name: string;
  /** The paper's own wording, so a drifted implementation is visible here. */
  paperDefinition: string;
  section: '11.2' | '11.3';
  /** §11.2: B5 "cannot establish deployability" and is excluded from the
   *  deployable outperformance comparison. */
  deployable: boolean;
  shape: PolicyShape;
  disable: PolicyAblations;
}

/**
 * Reading of §11.2, clause by clause:
 *
 *  - B1 "highest currently displayed eligible rate": no post-deposit
 *    simulation (displayed rate), no uncertainty, no movement-cost threshold
 *    (B3 is the one that ADDS it, so B1 and B2 have none), no dynamic
 *    reserve, and none of the SRCLA amendments (P4 phi, P5 liquidity cap,
 *    dependency policy). The hard per-venue caps and the admin floor stay:
 *    §11.1 gives every policy "the applicable non-negotiable safety envelope".
 *  - B2 "post-deposit capacity curves without uncertainty treatment, holding
 *    the same reserve as SRCLA": capacity curves back on, full reserve back
 *    on, and — because B3 is defined as B2 minus the dependency policy — the
 *    dependency policy is on in B2. Still no uncertainty, no cost gate, no
 *    P4/P5.
 *  - B2u "B2 without any reserve": `reserve`, which removes the floor too.
 *    This is the switch P7 exists to distinguish from B2; the harness this
 *    replaces had B2 itself un-reserved and no B2u at all.
 *  - B3 "add a movement-cost threshold to B2 but omit the dependency policy
 *    and the P3 netting of the withdrawal quantile".
 *  - B4 "one frozen robust allocation over the eligible market set".
 *  - B5 "bounded hindsight as a non-deployable diagnostic upper bound".
 */
export const REGISTERED_BASELINES: readonly RegisteredPolicy[] = [
  {
    id: 'b0',
    name: 'Idle',
    paperDefinition: 'Hold native USDC idle.',
    section: '11.2',
    deployable: true,
    shape: 'idle',
    disable: {},
  },
  {
    id: 'b1',
    name: 'Highest displayed rate',
    paperDefinition: 'Select the highest currently displayed eligible rate.',
    section: '11.2',
    deployable: true,
    shape: 'kernel',
    disable: {
      capacityCurves: true,
      uncertainty: true,
      costGate: true,
      dynamicReserve: true,
      dependencyCaps: true,
      liquidityCap: true,
      exitableWeight: true,
    },
  },
  {
    id: 'b2',
    name: 'Capacity curves, reserve-matched',
    paperDefinition:
      'Use post-deposit capacity curves without uncertainty treatment, holding the same reserve as SRCLA.',
    section: '11.2',
    deployable: true,
    shape: 'kernel',
    disable: { uncertainty: true, costGate: true, liquidityCap: true, exitableWeight: true },
  },
  {
    id: 'b2u',
    name: 'Capacity curves, unreserved',
    paperDefinition:
      'B2 without any reserve. Retained as a labelled diagnostic; not a deployable comparator.',
    section: '11.2',
    deployable: false,
    shape: 'kernel',
    disable: {
      uncertainty: true,
      costGate: true,
      liquidityCap: true,
      exitableWeight: true,
      reserve: true,
    },
  },
  {
    id: 'b3',
    name: 'Capacity curves + cost threshold',
    paperDefinition:
      'Add a movement-cost threshold to B2 but omit the dependency policy and the P3 netting of the withdrawal quantile.',
    section: '11.2',
    deployable: true,
    shape: 'kernel',
    disable: {
      uncertainty: true,
      liquidityCap: true,
      exitableWeight: true,
      dependencyCaps: true,
      netting: true,
    },
  },
  {
    id: 'b4',
    name: 'Frozen robust allocation',
    paperDefinition: 'Use one frozen robust allocation over the eligible market set.',
    section: '11.2',
    deployable: true,
    shape: 'frozen-equal-weight',
    disable: {},
  },
  {
    id: 'b5',
    name: 'Bounded hindsight',
    paperDefinition: 'Use bounded hindsight as a non-deployable diagnostic upper bound.',
    section: '11.2',
    deployable: false,
    shape: 'hindsight',
    // Hindsight enters through the CURVE, because RateCurve is derived from
    // IRM state (cash/borrows), not from the observed rate — substituting
    // `supplyRateWad` alone would change nothing and B5 would silently
    // degrade to SRCLA, which is exactly the defect the old b5-hindsight.ts
    // had. So B5 ranks on flat curves at the REALIZED rate.
    disable: { capacityCurves: true },
  },
] as const;

/** §11.3, verbatim. Each row removes exactly one named component. */
export const REGISTERED_ABLATIONS: readonly RegisteredPolicy[] = [
  {
    id: 'h1',
    name: 'H1 capacity',
    paperDefinition: 'remove post-deposit simulation; rank on displayed rate.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { capacityCurves: true },
  },
  {
    id: 'h2',
    name: 'H2 uncertainty',
    paperDefinition: 'remove calibrated lower bounds; use the point forecast.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { uncertainty: true },
  },
  {
    id: 'h3',
    name: 'H3 cost',
    paperDefinition: 'remove the complete-cost gate and the no-trade band.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { costGate: true },
  },
  {
    id: 'h4',
    name: 'H4 liquidity',
    paperDefinition: 'remove the dynamic reserve and stress feasibility; admin floor only.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { dynamicReserve: true },
  },
  {
    id: 'h5',
    name: 'H5 dependency',
    paperDefinition: 'remove shared-dependency caps.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { dependencyCaps: true },
  },
  {
    id: 'h6',
    name: 'H6 structural liquidity cap',
    paperDefinition: 'remove c_i^liquidity.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { liquidityCap: true },
  },
  {
    id: 'h7',
    name: 'H7 liquidity-adjusted objective',
    paperDefinition: 'remove the phi_i weighting.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { exitableWeight: true },
  },
] as const;

export const SRCLA_POLICY: RegisteredPolicy = {
  id: 'srcla',
  name: 'SRCLA',
  paperDefinition: 'The registered runtime policy (Appendix B).',
  section: '11.3',
  deployable: true,
  shape: 'kernel',
  disable: {},
};

export const REGISTERED_POLICIES: readonly RegisteredPolicy[] = [
  SRCLA_POLICY,
  ...REGISTERED_BASELINES,
  ...REGISTERED_ABLATIONS,
];

/** Every id the policy gate must see a result for (§11.5 fails on a
 *  missing baseline/ablation). */
export const REQUIRED_POLICY_IDS: readonly string[] = REGISTERED_POLICIES.map((p) => p.id);

/**
 * Turn a `DecisionOutput.target` into replay actions.
 *
 * Divests are emitted before deploys (§9.5's divest-before-deploy ordering),
 * and markets are visited in sorted id order so the action list is
 * deterministic. A market absent from `target` (it lost eligibility this
 * origin) keeps its position: unwinding it is §12's bounded-unwind path, not
 * a rebalance, and the kernel does not emit one today.
 */
export function targetToActions(
  target: Map<string, bigint>,
  positions: Map<string, bigint>,
): BaselineAction[] {
  const divests: BaselineAction[] = [];
  const deploys: BaselineAction[] = [];

  for (const marketId of [...target.keys()].sort()) {
    const want = target.get(marketId) ?? 0n;
    const have = positions.get(marketId) ?? 0n;
    if (want < have) divests.push({ kind: 'divest', adapter: marketId, amount: have - want });
    else if (want > have) deploys.push({ kind: 'deploy', adapter: marketId, amount: want - have });
  }

  return [...divests, ...deploys];
}

/**
 * §11.2's B4: one equal-weight allocation over the eligible market set,
 * chosen at the first origin that admits anything and then held.
 *
 * Eligibility and the reserve floor come from the kernel's own `admit` and
 * `requiredReserve` (floor only — a frozen allocation cannot respond to a
 * moving dynamic reserve, which is the point of the baseline), so B4 sees
 * the same admission decisions every other policy does. The old
 * `b4-fixed-robust.ts` re-sorted by live rate on every call, which was
 * neither fixed nor robust.
 */
export function frozenEqualWeightTarget(
  input: DecisionInput,
  artifact: PolicyArtifact,
  frozen: Map<string, bigint> | null,
  reserveOpts: { quantile: number; horizonSeconds: number },
): Map<string, bigint> | null {
  if (frozen !== null) return frozen;

  const admission = admit(input, artifact);
  if (admission.eligible.length === 0) return null;

  const floor = requiredReserve(input, artifact, new Map(), { ...reserveOpts, floorOnly: true }).floorBase;
  const deployable = input.vault.totalAssetsBase > floor ? input.vault.totalAssetsBase - floor : 0n;
  if (deployable === 0n) return null;

  const ids = [...admission.eligible].sort();
  const share = deployable / BigInt(ids.length);

  const target = new Map<string, bigint>();
  for (const id of ids) {
    const m = input.markets.find((x) => x.marketId === id)!;
    const cap = (input.vault.totalAssetsBase * BigInt(m.capBps)) / 10_000n;
    const capped = share < cap ? share : cap;
    target.set(id, capped < m.absoluteCapBase ? capped : m.absoluteCapBase);
  }
  return target;
}

export interface KernelPolicyContext {
  artifact: PolicyArtifact;
  opts: Omit<DecideOpts, 'disable'>;
}

/** Run the kernel for one origin under one registered policy's switches. */
export function runKernel(
  policy: RegisteredPolicy,
  input: DecisionInput,
  ctx: KernelPolicyContext,
): ReturnType<typeof decide> {
  return decide(input, ctx.artifact, { ...ctx.opts, disable: policy.disable });
}
