import { computeDecisionHashV2, hashData } from '../domain/hashing.js';
import { admit } from './steps/admit.js';
import { simulateCurves, flatDisplayedRateCurves } from './steps/simulate.js';
import { forecastMarkets } from './steps/forecast.js';
import { requiredReserve } from './steps/reserve.js';
import { optimize, reserveOptsFrom, type PolicyAblations } from './steps/optimize.js';
import { costGate, type CostParams } from './steps/cost.js';
import { buildPlan, type BuildPlanOpts } from './steps/plan.js';
import { safetyUnwind } from './steps/unwind.js';
import type { DecisionInput, DecisionOutput, PolicyArtifact } from './types.js';

export interface DecideOpts {
  codeCommit: string;
  quantumBase: bigint;
  maxCurvePoints: number;
  reserveQuantile: number;
  reserveHorizonSeconds: number;
  cost: CostParams;
  plan: Omit<BuildPlanOpts, 'snapshotHash' | 'emergencyExitAdapters'>;
  /**
   * §9.1's bounded safety unwind: at most this many basis points of total
   * assets may leave venues in one safety plan. See steps/unwind.ts.
   */
  safetyUnwindMaxBps: number;
  /**
   * The registered baseline/ablation switch set (optimize.ts's
   * `PolicyAblations`). This is the ONLY sanctioned way to express B0-B5,
   * B2u and H1-H7: every policy in the evaluation runs this same `decide`
   * with a different `disable` (and, for H2/B*, a different artifact), so
   * §11.1's equal-information requirement holds structurally rather than by
   * two code paths agreeing to agree.
   */
  disable?: PolicyAblations;
}

export const DEFAULT_DECIDE_OPTS: DecideOpts = {
  codeCommit: 'dev',
  quantumBase: 1_000_000_000n,
  maxCurvePoints: 16,
  reserveQuantile: 0.95,
  reserveHorizonSeconds: 86_400,
  cost: {
    cooldownSeconds: 3600,
    minTurnoverBps: 10,
    maxTurnoverBps: 5000,
    // The rolling window MAX_TURNOVER's 50%-of-TVL bound is measured over.
    // One day: decisions run hourly (runtime/scheduler.ts) while the
    // forecast horizon is days, so a window shorter than the cadence would
    // measure nothing and one longer than the horizon would still be
    // rejecting a move on turnover incurred before the current forecast.
    turnoverWindowSeconds: 86_400,
    // §9.1's reversal allowance. Round-trip churn (see reversalChurnBase)
    // of at most 2% of TVL per day: enough to unwind and re-enter a single
    // meaningful position once, not enough to do it repeatedly.
    //
    // NOT CALIBRATED. Like `noTradeBandK`, this is a registered-by-default
    // value, not one swept on held-out data; §9.1 does not fix a number for
    // it. Sweeping it needs the same turnover-vs-return dataset k does.
    reversalWindowSeconds: 86_400,
    reversalAllowanceBps: 200,
    slippageBps: 5,
    mevBps: 1,
    impactBps: 2,
    failureRateBps: 50,
    bufferBps: 100,
    // Per-protocol-call gas (exit/entry/claim only - see cost.ts's FINDING 1
    // comment for why this must NOT also drive l2).
    gasPerAction: 250_000n,
    // submitPlan writes ~12 storage words for the PlanHeader plus a
    // PlanSubmitted event; EIP-2929 cold SSTORE (~20k/word) plus the 21k
    // base tx cost puts a full submission in the 150k-250k gas range.
    // Matches test/unit/policy/cost.spec.ts's PARAMS.
    planGasOverhead: 150_000n,
    // executeAction's own dispatch overhead (Merkle proof verification at
    // <=3-hash depth + next-index bookkeeping + ActionExecuted event),
    // EXCLUDING the protocol call the action performs.
    actionDispatchGas: 15_000n,
    approveResetGas: 50_000n,
    swapGas: 180_000n,
    // Sized to one executeAction call (selector + fixed args + a small
    // proof array), not a whole plan submission - see cost.ts's derivation
    // comment and cost.spec.ts's PARAMS (400n, not the much larger
    // calldata-priced figure a pre-blob model would use).
    l1BytesPerAction: 400n,
  },
  // §9.1's bounded safety unwind. 25% of TVL per plan: an incident affecting
  // one of a three-venue universe fits in a single plan, while a
  // simultaneous multi-venue failure is staged across cycles rather than
  // dumped into thin markets at once. NOT CALIBRATED - §9.1 says "bounded"
  // and fixes no number.
  safetyUnwindMaxBps: 2500,
  plan: {
    chainId: 8453,
    vaultAddress: '0x0000000000000000000000000000000000000001',
    assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    policyVersion: 5n,
    expirySeconds: 1800,
    maxLossBps: 50,
    turnoverLimitBase: 10n ** 13n,
  },
};

/**
 * §10.1 - the snapshot hash covers the canonical raw-integer snapshot: full
 * vault state, every market observation (cash/borrows/reserves/rate/
 * utilisation/position/caps/...), dependency groups and the gas/oracle
 * observation. The implementation this replaces hashed only `totalAssets`
 * (stuffed into a `marketId` field) with rate and utilisation hardcoded to
 * `'0'`, so two decisions over distinct market states could collide on the
 * same snapshot hash. This covers the full raw state instead.
 */
export function computeCanonicalSnapshotHash(input: DecisionInput): string {
  return hashData({
    blockNumber: input.origin.blockNumber,
    blockHash: input.origin.blockHash,
    timestampSeconds: input.origin.timestampSeconds,
    vault: input.vault,
    markets: input.markets,
    dependencyGroups: input.dependencyGroups,
    gas: input.gas,
  });
}

/**
 * The single SRCLA decision. Pure: no I/O, no wall clock, no randomness -
 * every timestamp comes from `input.origin.timestampSeconds`. The live
 * service and offline evaluation both call this one function, which is what
 * makes the paper's §11.1 equal-information requirement structurally true
 * rather than a promise two separate code paths could quietly diverge from.
 */
export function decide(input: DecisionInput, artifact: PolicyArtifact, opts: DecideOpts): DecisionOutput {
  const reasons: string[] = [];
  const snapshotHash = computeCanonicalSnapshotHash(input);

  const current = new Map<string, bigint>(input.markets.map((m) => [m.marketId, m.positionBase]));

  const finish = (partial: Partial<DecisionOutput>): DecisionOutput => {
    const base: DecisionOutput = {
      snapshotHash,
      decisionHash: '',
      admission: partial.admission ?? { eligible: [], reasons: [] },
      curves: partial.curves ?? [],
      lowerBounds: partial.lowerBounds ?? [],
      reserve: partial.reserve ?? {
        requiredBase: 0n,
        floorBase: 0n,
        netDemandQuantileBase: 0n,
        stressShortfallBase: 0n,
        scenarioFeasible: [],
      },
      target: partial.target ?? current,
      enumeration: partial.enumeration ?? null,
      costGate: partial.costGate ?? {
        passed: false,
        reason: 'NOT_EVALUATED',
        gainBase: 0n,
        moveCostBase: 0n,
        bandBase: 0n,
        terms: {},
      },
      plan: partial.plan ?? null,
      action: partial.action ?? 'hold',
      reasons,
    };
    base.decisionHash = computeDecisionHashV2({
      codeCommit: opts.codeCommit,
      policyVersion: artifact.policyVersion,
      artifactHash: artifact.artifactHash,
      configDigest: artifact.configDigest,
      snapshotHash,
      originSeconds: input.origin.timestampSeconds,
      admissionReasons: base.admission.reasons,
      curves: base.curves,
      lowerBounds: base.lowerBounds,
      reserve: base.reserve,
      target: [...base.target.entries()].sort(),
      enumeration: base.enumeration,
      costs: base.costGate.terms,
      reasons: base.reasons,
    });
    return base;
  };

  if (input.vault.paused) {
    reasons.push('VAULT_PAUSED');
    return finish({});
  }

  const admission = admit(input, artifact);

  // §9.1 - "A market that becomes ineligible invokes a bounded safety unwind
  // and BYPASSES THE ECONOMIC GATE." This must run BEFORE the
  // ADMISSION_EMPTY return below: a universe in which every market has
  // failed admission is exactly the case that most needs an unwind, and
  // returning early there produced a HOLD over a stranded position.
  //
  // The unwind is emitted as its own plan - divests only, no deploys, no
  // unrelated rebalancing. A safety exit must not be able to carry an
  // economic move through the gate with it, and an economic move must not
  // be able to ride out on a safety exit's bypass. Ordinary rebalancing
  // resumes on the next cycle.
  const unwind = safetyUnwind(input, admission, { maxBps: opts.safetyUnwindMaxBps });
  if (unwind.exits.length > 0) {
    const unwindTarget = new Map(current);
    for (const e of unwind.exits) unwindTarget.set(e.marketId, 0n);

    reasons.push(
      `SAFETY_UNWIND: exiting ${unwind.exits.map((e) => `${e.marketId}[${e.codes.join('+')}]`).join(', ')} ` +
        `(${unwind.notionalBase} of a ${unwind.boundBase} bound)` +
        (unwind.deferred.length > 0 ? `; deferred to a later cycle: ${unwind.deferred.join(', ')}` : '')
    );

    const unwindReserve = requiredReserve(
      input,
      unwindTarget,
      reserveOptsFrom(opts.disable ?? {}, {
        reserveQuantile: opts.reserveQuantile,
        reserveHorizonSeconds: opts.reserveHorizonSeconds,
      })
    );

    // Reported, never evaluated. A caller reading `costGate.passed === true`
    // must be able to tell "the gate cleared this" from "the gate was
    // bypassed", so the reason is explicit and every amount is zero rather
    // than a fabricated gain.
    const bypassed = {
      passed: true,
      reason: 'SAFETY_UNWIND_BYPASS',
      gainBase: 0n,
      moveCostBase: 0n,
      bandBase: 0n,
      terms: {},
    };

    const emergencyExitAdapters = new Set(unwind.exits.map((e) => e.adapter));
    const planOpts = { ...opts.plan, emergencyExitAdapters, snapshotHash: `0x${snapshotHash}` };
    const placeholder = '0x' + '00'.repeat(31) + '01';
    const draft = buildPlan(input, unwindTarget, unwindReserve.requiredBase, placeholder, planOpts);
    if (draft === null) {
      // Unreachable in practice (every exit carries a strictly positive
      // position, so at least one action exists) but never assumed.
      reasons.push('NO_ACTIONS');
      return finish({ admission, reserve: unwindReserve, target: unwindTarget, costGate: bypassed });
    }

    const out = finish({
      admission,
      reserve: unwindReserve,
      target: unwindTarget,
      costGate: bypassed,
      plan: draft,
      action: 'rebalance',
    });
    out.plan = buildPlan(input, unwindTarget, unwindReserve.requiredBase, `0x${out.decisionHash}`, planOpts);
    return out;
  }

  if (admission.eligible.length === 0) {
    reasons.push('ADMISSION_EMPTY');
    // Whole-branch review, Critical 3: distinguish "the pipeline has no
    // usable market data at all" from a legitimate, data-dependent empty
    // admission (e.g. REGIME_MIN_HISTORY on a fresh database). If every
    // market observation failed the NO_MARKET_DATA rule (admit.ts), this
    // is not a considered HOLD -- it means the collector could not read
    // rate/liquidity data for anything, so the kernel decided on nothing.
    // Callers (and scripts/phase1-fork-check.ts) must be able to tell the
    // two apart rather than treat both as "expected: true".
    const noDataMarketIds = new Set(
      admission.reasons.filter((r) => r.code === 'NO_MARKET_DATA' && !r.passed).map((r) => r.marketId)
    );
    if (input.markets.length > 0 && noDataMarketIds.size === input.markets.length) {
      reasons.push('NO_MARKET_DATA');
    }
    return finish({ admission });
  }

  const disable: PolicyAblations = opts.disable ?? {};

  // H1: rank on the displayed rate instead of the post-deposit curve. Same
  // curve shape and same WAD-annualized rate unit either way (see
  // flatDisplayedRateCurves) so no consumer needs an H1 branch.
  const curves =
    disable.capacityCurves === true
      ? flatDisplayedRateCurves(input, admission.eligible, opts.quantumBase, opts.maxCurvePoints)
      : simulateCurves(input, admission.eligible, opts.quantumBase, opts.maxCurvePoints);
  const lowerBounds = forecastMarkets(input, curves, artifact);

  const { target, enumeration } = optimize(input, curves, artifact, {
    quantumBase: opts.quantumBase,
    reserveQuantile: opts.reserveQuantile,
    reserveHorizonSeconds: opts.reserveHorizonSeconds,
    disable,
  });

  // Same derivation the optimiser scored candidates with (reserveOptsFrom),
  // so the reported reserve cannot disagree with the one the search obeyed.
  const reserve = requiredReserve(
    input,
    target,
    reserveOptsFrom(disable, {
      reserveQuantile: opts.reserveQuantile,
      reserveHorizonSeconds: opts.reserveHorizonSeconds,
    })
  );

  // H3: remove the complete-cost gate AND the no-trade band. The gate is
  // reported as passed with an explicit reason so a result can never be read
  // as "the gate was evaluated and cleared"; every amount below is USDC base
  // units (6 dp).
  const gate =
    disable.costGate === true
      ? {
          passed: true,
          reason: 'COST_GATE_ABLATED',
          gainBase: 0n,
          moveCostBase: 0n,
          bandBase: 0n,
          terms: {},
        }
      : costGate(input, curves, artifact, current, target, opts.cost);
  if (!gate.passed) {
    reasons.push(`COST_GATE: ${gate.reason}`);
    return finish({ admission, curves, lowerBounds, reserve, target, enumeration, costGate: gate });
  }

  // buildPlan's header embeds decisionHash (it becomes the derived planId
  // too), but the decision hash itself is computed from reasons/target/
  // reserve/costs that do not depend on the plan draft - so a placeholder,
  // guaranteed-non-zero decisionHash is used only to check whether any
  // action would actually be emitted (plan === null means NO_ACTIONS).
  const placeholderHash = '0x' + '00'.repeat(31) + '01';
  const draftPlan = buildPlan(input, target, reserve.requiredBase, placeholderHash, {
    ...opts.plan,
    snapshotHash: `0x${snapshotHash}`,
  });

  if (draftPlan === null) {
    reasons.push('NO_ACTIONS');
    return finish({ admission, curves, lowerBounds, reserve, target, enumeration, costGate: gate });
  }

  reasons.push('REBALANCE');
  const out = finish({
    admission,
    curves,
    lowerBounds,
    reserve,
    target,
    enumeration,
    costGate: gate,
    plan: draftPlan,
    action: 'rebalance',
  });

  // The plan commits to the real decision hash, so it is rebuilt once that
  // hash exists.
  out.plan = buildPlan(input, target, reserve.requiredBase, `0x${out.decisionHash}`, {
    ...opts.plan,
    snapshotHash: `0x${snapshotHash}`,
  });
  return out;
}
