import { computeDecisionHashV2, hashData } from '../domain/hashing.js';
import { admit } from './steps/admit.js';
import { simulateCurves, flatDisplayedRateCurves } from './steps/simulate.js';
import { forecastMarkets } from './steps/forecast.js';
import { requiredReserve } from './steps/reserve.js';
import {
  effectiveCapBase,
  optimize,
  reserveOptsFrom,
  resolveQuantumBase,
  type PolicyAblations,
} from './steps/optimize.js';
import {
  applyBrakes,
  clampToTurnoverBudget,
  remainingTurnoverBase,
  type CostParams,
} from './steps/cost.js';
import {
  chooseExecuted,
  notionalBase,
  partialAdjustAtLeast,
  planLegs,
  survivingTarget,
} from './steps/legs.js';
import { buildPlan, type BuildPlanOpts } from './steps/plan.js';
import { safetyUnwind } from './steps/unwind.js';
import type {
  CostGateResult,
  DecisionInput,
  DecisionOutput,
  PolicyArtifact,
  RateCurve,
} from './types.js';

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
      costGate: partial.costGate ?? { passed: false, reason: 'NOT_EVALUATED', legs: [], backedOff: false },
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
      // P17 - the per-leg verdicts, which are what the movement decision now
      // consists of. This slot used to carry `costGate.terms`; once the single
      // gate was replaced that map was permanently `{}`, so §10.2's "costs"
      // component of the hash was a constant and the real information was
      // outside the hash entirely.
      legs: base.costGate.legs,
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
      artifact,
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
    const bypassed: CostGateResult = {
      passed: true,
      reason: 'SAFETY_UNWIND_BYPASS',
      // No leg was evaluated: §9.1's unwind bypasses the economic gate
      // wholesale, so an empty list is the honest report, not an omission. A
      // caller reading `passed === true` tells a bypass from a cleared gate by
      // the reason AND by the fact that nothing was priced.
      legs: [],
      backedOff: false,
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

  // §8.2 - ONE quantum for the whole decision: the curves the objective
  // reads, the grid the greedy loop walks, and the grid the exhaustive check
  // enumerates. `resolveQuantumBase` raises the requested quantum when the
  // vault is large enough that enumeration would otherwise be skipped, which
  // is what made §8.2's check unreachable at three of the four registered
  // tiers. Resolved here, before the curves, because a curve built on a
  // different quantum than the search walks would be interpolated off-grid.
  const quantumBase = resolveQuantumBase(input.vault.totalAssetsBase, opts.quantumBase);

  // H1: rank on the displayed rate instead of the post-deposit curve. Same
  // curve shape and same WAD-annualized rate unit either way (see
  // flatDisplayedRateCurves) so no consumer needs an H1 branch.
  const curves =
    disable.capacityCurves === true
      ? flatDisplayedRateCurves(input, admission.eligible, quantumBase, opts.maxCurvePoints)
      : simulateCurves(input, admission.eligible, quantumBase, opts.maxCurvePoints);
  const lowerBounds = forecastMarkets(input, curves, artifact);

  const { target: unclampedTarget, enumeration } = optimize(input, curves, artifact, {
    quantumBase,
    reserveQuantile: opts.reserveQuantile,
    reserveHorizonSeconds: opts.reserveHorizonSeconds,
    disable,
  });

  // §9.1's turnover cap TRIMS the move; it does not veto it. Rejecting a
  // move that exceeded the window made a cold start unresolvable (a vault
  // holding 100% cash proposes ~94% of NAV, is refused, and finds the same
  // 100% cash at the next origin) and broke §11.1's equal envelope, since
  // B0 and B4 never run through this gate at all. See
  // `clampToTurnoverBudget`.
  //
  // P17: the trim is now UNCONDITIONAL, H3 included. It was previously
  // skipped under `disable.costGate` because that switch also removed the
  // MAX_TURNOVER brake it feeds. §9.1.4 puts the brakes outside the hurdles
  // ("they bound the policy's aggregate behavior, whereas the hurdles above
  // decide individual legs") and `cost.ts#applyBrakes` is now evaluated on
  // every path, H3 included — so leaving H3 untrimmed would hand it an
  // untrimmed vector and then veto it on MAX_TURNOVER, making the ablation
  // strictly MORE constrained than the policy it ablates.
  const target = clampToTurnoverBudget(
    current,
    unclampedTarget,
    remainingTurnoverBase(input, opts.cost),
  );

  // Same derivation the optimiser scored candidates with (reserveOptsFrom),
  // so the reported reserve cannot disagree with the one the search obeyed.
  const reserve = requiredReserve(
    input,
    artifact,
    target,
    reserveOptsFrom(disable, {
      reserveQuantile: opts.reserveQuantile,
      reserveHorizonSeconds: opts.reserveHorizonSeconds,
    })
  );

  // P17 — §9.1.4's per-leg evaluation, replacing the single all-or-nothing
  // gate. The target is diffed into legs, each leg meets its own hurdle
  // (steps/hurdles.ts), the survivors are re-checked for feasibility, and the
  // executed move is a partial adjustment toward them. v0.6's one-gate form
  // discarded the whole vector whenever any part of it failed, which produced
  // 1 and 0 rebalances on the two sealed held-out eras.
  //
  // H3 (`disable.costGate`) skips the economic hurdles only. The aggregate
  // brakes below stay live on every path — §9.1.4 states they "remain in
  // force" independently of the hurdles — so H3 is an ablation of the
  // thresholds, not of the churn budget.
  //
  // P36: H2 removes the calibrated lower bound EVERYWHERE it is read, the
  // movement hurdles included. Before P36 the switch reached only the
  // optimiser's objective, so H2 never ablated the one copy of the haircut
  // that was withholding capital at scale.
  const verdicts =
    disable.costGate === true
      ? []
      : planLegs(current, target, input, artifact, curves, opts.cost, {
          pointForecast: disable.uncertainty === true,
        });

  // H3d: remove the DEPLOYMENT hurdle only, keeping the rotation hurdle, so
  // §9.1.2 and §9.1.3 can be attributed separately.
  const effective =
    disable.deploymentHurdle === true
      ? verdicts.map((v) =>
          v.kind === 'deploy' ? { ...v, clears: true, reason: 'DEPLOY_HURDLE_ABLATED' } : v,
        )
      : verdicts;

  const sub = disable.costGate === true ? target : survivingTarget(current, target, effective);

  // A subset of a feasible target need not itself be feasible: dropping the
  // deploy leg that was going to absorb a divest changes idle, the reserve and
  // every cap check. Re-check before committing, and again after the partial
  // adjustment, which lands strictly between two vectors but is not guaranteed
  // to satisfy a non-monotone constraint at the interpolation point.
  const feasible = (candidate: Map<string, bigint>): boolean =>
    reFeasible(input, artifact, curves, current, candidate, disable, {
      reserveQuantile: opts.reserveQuantile,
      reserveHorizonSeconds: opts.reserveHorizonSeconds,
    });

  // §9.1's minimum-turnover floor, needed here (not only inside `applyBrakes`)
  // because the adjustment rate has to be raised to it rather than scaled
  // under it - see `partialAdjustAtLeast`.
  const minTurnoverBase =
    (input.vault.totalAssetsBase * BigInt(opts.cost.minTurnoverBps)) / 10_000n;

  // Divest-only backoff. An unpaired divest carries no economic hurdle (§9.1
  // states none for reducing exposure) and is usually a constraint response, so
  // discarding it because some OTHER surviving leg made the vector infeasible
  // would be the all-or-nothing failure P17 removes, in the direction that
  // raises risk. Try the full surviving set, then the risk-reducing subset of
  // it, and only then hold.
  const divestOnly =
    disable.costGate === true
      ? current
      : survivingTarget(current, target, effective.filter((v) => v.kind === 'divest'));
  const hasDivest = effective.some((v) => v.kind === 'divest' && v.clears);

  const commit = (candidate: Map<string, bigint>): Map<string, bigint> | null => {
    if (!feasible(candidate)) return null;
    const moved = partialAdjustAtLeast(
      current,
      candidate,
      artifact.adjustmentRate,
      minTurnoverBase,
    );
    return feasible(moved) ? moved : null;
  };

  const { executed, backedOff } = chooseExecuted(current, sub, divestOnly, hasDivest, commit);

  // §9.1.4's brakes are evaluated on the FINAL executed vector, not the raw
  // target: they bound the policy's aggregate behaviour, so the quantity they
  // must see is the notional actually about to move.
  const notional = notionalBase(current, executed);
  const brake = applyBrakes(input, notional, current, executed, opts.cost);

  // `applyBrakes` reports `NO_MOVES: target equals current` for a zero
  // notional, which was exact when the executed vector WAS the target. It no
  // longer is: a zero notional now usually means the hurdles refused every leg,
  // or that the survivors did not survive the feasibility re-check. Report the
  // actual cause in those two cases and leave every other brake string
  // untouched, so a census can still match on them.
  const anyCleared = effective.some((v) => v.clears);
  const gate: CostGateResult = {
    passed: brake === null,
    reason:
      brake === null
        ? disable.costGate === true
          ? 'COST_GATE_ABLATED'
          : backedOff
            ? 'HURDLES_CLEARED_DIVEST_ONLY'
            : 'HURDLES_CLEARED'
        : notional === 0n && effective.length > 0
          ? anyCleared
            ? 'INFEASIBLE_AFTER_HURDLES'
            : 'ALL_LEGS_BLOCKED'
          : brake,
    legs: effective,
    // Reported independently of `reason`: a brake that fires AFTER the
    // backoff overwrites `reason` with the brake string alone, which is
    // indistinguishable from the same brake firing on the full target
    // unless this is carried alongside it. See CostGateResult#backedOff.
    backedOff,
  };
  if (!gate.passed) {
    reasons.push(`HURDLES: ${gate.reason}`);
    return finish({ admission, curves, lowerBounds, reserve, target, enumeration, costGate: gate });
  }

  // Everything below plans and reports the EXECUTED vector, not the raw
  // target: the reserve the plan header commits to must be the one required by
  // the allocation the plan actually reaches.
  const executedReserve = requiredReserve(
    input,
    artifact,
    executed,
    reserveOptsFrom(disable, {
      reserveQuantile: opts.reserveQuantile,
      reserveHorizonSeconds: opts.reserveHorizonSeconds,
    })
  );

  // buildPlan's header embeds decisionHash (it becomes the derived planId
  // too), but the decision hash itself is computed from reasons/target/
  // reserve/costs that do not depend on the plan draft - so a placeholder,
  // guaranteed-non-zero decisionHash is used only to check whether any
  // action would actually be emitted (plan === null means NO_ACTIONS).
  const placeholderHash = '0x' + '00'.repeat(31) + '01';
  const draftPlan = buildPlan(input, executed, executedReserve.requiredBase, placeholderHash, {
    ...opts.plan,
    snapshotHash: `0x${snapshotHash}`,
  });

  if (draftPlan === null) {
    reasons.push('NO_ACTIONS');
    return finish({
      admission,
      curves,
      lowerBounds,
      reserve: executedReserve,
      target: executed,
      enumeration,
      costGate: gate,
    });
  }

  reasons.push('REBALANCE');
  const out = finish({
    admission,
    curves,
    lowerBounds,
    reserve: executedReserve,
    target: executed,
    enumeration,
    costGate: gate,
    plan: draftPlan,
    action: 'rebalance',
  });

  // The plan commits to the real decision hash, so it is rebuilt once that
  // hash exists.
  out.plan = buildPlan(input, executed, executedReserve.requiredBase, `0x${out.decisionHash}`, {
    ...opts.plan,
    snapshotHash: `0x${snapshotHash}`,
  });
  return out;
}

/**
 * Re-run the guardrails `optimize`'s own `hardFeasible` applies, against a
 * vector `optimize` did not itself produce.
 *
 * P17 needs this because the executed vector is no longer the optimiser's
 * output: it is a SUBSET of it (only the legs that cleared their hurdle) and
 * then a partial adjustment toward that subset. Neither is guaranteed feasible
 * just because the target was — dropping a deploy leg that was going to absorb
 * a divest changes idle, and idle is what the reserve is paid out of.
 *
 * It mirrors `optimize`'s predicate term for term (total, per-venue caps,
 * dependency groups, the reserve requirement and the §8.1 stress scenarios),
 * with two deliberate differences, both forced by the fact that this predicate
 * — unlike `optimize`'s — is applied to vectors that CONTAIN THE CURRENT
 * POSITION rather than being built up from zero:
 *
 *  1. Caps are enforced only over the SIMULATED UNIVERSE (`curves`). A
 *     candidate here can carry a legacy position in a venue that has since
 *     fallen out of admission; `optimize` never sees such a venue, so
 *     `caps.get(id) ?? 0n` would read `0n` and refuse every candidate outright,
 *     turning one de-admitted holding into a permanent hold. The holding is
 *     still counted toward `deployed`, so the reserve check stays honest about
 *     it; exiting it is §9.1's safety unwind's job, not this one's.
 *
 *  2. Every bound is evaluated as "NO WORSE THAN CURRENT", not as an absolute.
 *     A percentage cap is a fraction of TVL and the stress scenarios are a
 *     function of live venue cash, so the vault can find ITSELF in breach with
 *     no move at all — a redemption shrinks `totalAssetsBase` and a `capBps`
 *     bound with it. Demanding absolute compliance from every candidate would
 *     then reject the current position too, and `decide` would hold forever in
 *     exactly the state that most needs a move. A candidate may not push a
 *     bound further out of compliance; it is not required to repair a
 *     pre-existing breach in one cycle.
 *
 * The §11.4 stressed-coverage floor is deliberately NOT re-applied: `optimize`
 * treats it as a PREFERENCE and falls back to `hardFeasible` alone when no
 * candidate clears it, so enforcing it here as a hard constraint would reject
 * survivors the optimiser itself accepted.
 *
 * Exported for direct testing: the monotone relaxations above are the part of
 * this that is easy to get subtly wrong (P17 review I3 was exactly that), and
 * reaching each branch through `decide()` needs a four-venue fixture tuned to
 * flip one stress scenario. `decide` is its only caller in `src/`.
 *
 * PURE.
 */
export function reFeasible(
  input: DecisionInput,
  artifact: PolicyArtifact,
  curves: RateCurve[],
  current: Map<string, bigint>,
  candidate: Map<string, bigint>,
  disable: PolicyAblations,
  opts: { reserveQuantile: number; reserveHorizonSeconds: number }
): boolean {
  const { totalAssetsBase } = input.vault;

  const sum = (v: Map<string, bigint>): bigint => {
    let acc = 0n;
    for (const x of v.values()) acc += x;
    return acc;
  };

  for (const x of candidate.values()) if (x < 0n) return false;
  const deployed = sum(candidate);
  if (deployed > totalAssetsBase) return false;

  for (const c of curves) {
    const m = input.markets.find((k) => k.marketId === c.marketId);
    if (m === undefined) return false;
    const x = candidate.get(c.marketId) ?? 0n;
    const cap = effectiveCapBase(m, totalAssetsBase, disable.liquidityCap);
    if (x > cap && x > (current.get(c.marketId) ?? 0n)) return false;
  }

  if (disable.dependencyCaps !== true) {
    for (const g of input.dependencyGroups) {
      let candidateSum = 0n;
      let currentSum = 0n;
      for (const member of g.members) {
        candidateSum += candidate.get(member) ?? 0n;
        currentSum += current.get(member) ?? 0n;
      }
      const pct = (totalAssetsBase * BigInt(g.capBps)) / 10_000n;
      const cap = pct < g.absoluteCapBase ? pct : g.absoluteCapBase;
      if (candidateSum > cap && candidateSum > currentSum) return false;
    }
  }

  if (disable.reserve !== true) {
    const reserveOpts = reserveOptsFrom(disable, opts);
    const r = requiredReserve(input, artifact, candidate, reserveOpts);
    const idle = totalAssetsBase - deployed;
    if (idle < r.requiredBase) {
      const currentIdle = totalAssetsBase - sum(current);
      const currentRequired = requiredReserve(input, artifact, current, reserveOpts).requiredBase;
      // Only a candidate that leaves LESS idle than today against a reserve
      // requirement it already fails is refused; one that improves the
      // shortfall is exactly the move a breached vault needs.
      if (idle - r.requiredBase < currentIdle - currentRequired) return false;
    }
    // §8.1 — a candidate must not fail a stress scenario the current position
    // passes, NOR fail one it already fails by a LARGER shortfall. Scenario
    // feasibility is a function of live venue cash, so the current position can
    // already fail one; requiring the candidate to fix that in one step would
    // strand the vault. But comparing only WHICH scenarios fail (P17 review I3)
    // let the shortfall grow without bound: a candidate failing today's
    // scenario worse than today passed as "no worse", every origin, forever.
    const failed = r.scenarioFeasible.filter((x) => !x.feasible);
    if (failed.length > 0) {
      const base = new Map(
        requiredReserve(input, artifact, current, reserveOpts).scenarioFeasible.map((x) => [
          x.scenario,
          x,
        ])
      );
      for (const s of failed) {
        const today = base.get(s.scenario);
        if (today === undefined || today.feasible) return false;
        if (s.shortfallBase > today.shortfallBase) return false;
      }
    }
  }

  return true;
}
