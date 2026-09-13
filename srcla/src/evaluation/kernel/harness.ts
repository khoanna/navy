/**
 * THE evaluation harness. One entry point, one policy kernel.
 *
 * `runRegisteredEvaluation` runs every §11.2 baseline and §11.3 ablation over
 * the same dataset, at every registered tier, by calling
 * `src/policy/decide.ts` with a different `PolicyAblations` setting per row.
 * Nothing here re-implements admission, simulation, forecasting, the reserve,
 * the optimiser or the cost gate.
 *
 * It also measures two things the previous harnesses asserted:
 *   - whether an ablation is INERT (its decision sequence is byte-identical
 *     to SRCLA's, so the "ablation" removes nothing on this dataset), and
 *   - the withdrawal success rate, from redemptions the replay executes.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates are WAD annualized;
 * times are seconds.
 */
import { runReplay, type PolicyFn, type ReplayResult, type WithdrawalRequest } from '../replay/replay.js';
import {
  accumulateCensus,
  accumulateGateCensus,
  capitalAtWork,
  deploymentLatency,
} from '../replay/deployment-metrics.js';
import type { EvaluationDataset, TimeOrderedSnapshot } from '../dataset.js';
import type { CompletedLabel, DecisionInput, PolicyArtifact } from '../../policy/types.js';
import type { DecideOpts } from '../../policy/decide.js';
import { DEFAULT_DECIDE_OPTS } from '../../policy/decide.js';
import {
  buildDecisionInput,
  deriveCompletedLabels,
  labelsAvailableAt,
  calibrateResidualQuantiles,
  calibrateCashResidualQuantiles,
  type HarnessConfig,
} from './decision-input.js';
import { buildResidualPanel } from '../../policy/steps/portfolio-quantile.js';
import {
  runForecastGate,
  type ArtifactRegistration,
  type ForecastGateResult,
} from './forecast-gate.js';
import { gasAt } from '../gas-series.js';
import { buildIdentityPin } from '../../domain/config-digest.js';
import { summariseLastAction, type PersistedActionRecord } from '../../policy/last-action.js';
import {
  REGISTERED_POLICIES,
  SRCLA_POLICY,
  frozenEqualWeightTarget,
  runKernel,
  targetToActions,
  type RegisteredPolicy,
} from './registry.js';
import type { BaselineAction } from '../replay/replay.js';
import {
  forkDecisionHash,
  runForkReplays,
  type ForkBenchVaultConfig,
  type ForkReplayOptions,
  type ForkReplayPlan,
} from '../fork-runner.js';
import type { ForkReplayResult } from './gates.js';
import { keccak256, toUtf8Bytes } from 'ethers';

/** §11.1: "Vault tiers are exactly 10,000; 100,000; 1,000,000; and 10,000,000
 *  USDC." All four, in USDC base units. The harness that produced
 *  SRCLA-REPORT.md ran three of them and its gates iterated only over the
 *  tiers present, so the missing one could not fail anything. */
export const REGISTERED_TIERS: readonly bigint[] = [
  10_000_000_000n,
  100_000_000_000n,
  1_000_000_000_000n,
  10_000_000_000_000n,
];

/**
 * P37 (G5): the tiers the P37 and release verdicts are decided over — 10,000,
 * 100,000 and 1,000,000 USDC, in base units. Every registered tier still runs
 * and is reported; 10,000,000 is outside the release scope, matching the
 * mainnet vault's deposit cap.
 */
export const RELEASE_TIERS: readonly bigint[] = [
  10_000_000_000n,
  100_000_000_000n,
  1_000_000_000_000n,
];

export interface WithdrawalSchedule {
  requests: WithdrawalRequest[];
  /**
   * `observed` — scaled from the vault's real `WithdrawalEvent` series.
   * `registered-schedule` — the deterministic fallback below. A report must
   * not present the second as evidence about real user behaviour.
   */
  source: 'observed' | 'registered-schedule';
}

/**
 * §11.4's deployment metrics — the diagnostic the v0.6 run record lacked. A
 * policy that never deployed and a policy that deployed badly both reported
 * as "low return"; these four fields make the difference legible from the
 * run record alone, without re-deriving it by hand.
 */
export interface DeploymentMetrics {
  /** Time-averaged fraction of NAV actually deployed, over the run. */
  capitalAtWorkFraction: number;
  /** Origins elapsed before the first admitted deployment; null if never. */
  deploymentLatencyOrigins: number | null;
  /**
   * This run's net APY minus the SAME policy's net APY with the deployment
   * hurdle (§9.1.2) disabled — the H3d ablation. `null` until H3d is
   * registered (it is not registered by this task); populated only for the
   * `srcla` row, and only when an `h3d` row ran at the same tier.
   */
  idleDragApy: number | null;
  /**
   * Reason-code -> count, merged from every origin's `accumulateCensus`
   * (per-leg hurdle blocks) and `accumulateGateCensus` (aggregate brake
   * blocks, with `BACKOFF_THEN_` distinguishing a brake on the divest-only
   * backoff from a brake on the full target). Empty for policy shapes that
   * never call `decide` (`idle`, `frozen-equal-weight`).
   */
  hurdleBlocks: Record<string, number>;
}

export interface PolicyRunResult {
  policy: RegisteredPolicy;
  tier: bigint;
  replay: ReplayResult & DeploymentMetrics;
  /** Kernel decision hashes, one per origin. The evidence for `inert`. */
  decisionHashes: string[];
  /**
   * The FIRST origin at which this policy actually proposed a move, kept so
   * §11.1's pinned-prestate fork replay has something to replay.
   *
   * One origin, not all of them: see `evaluation/fork-runner.ts`'s module
   * header for why the replay is per (policy, tier) rather than per origin,
   * and note that `null` here means the policy held at EVERY origin — which
   * the replay reports as a HOLD, not as an execution.
   */
  firstProposal: CapturedProposal | null;
  /** Number of origins whose action was 'rebalance'. */
  rebalances: number;
  /**
   * True when this policy's decision sequence is identical to SRCLA's at
   * every origin — i.e. the switch removed nothing on this dataset, so any
   * reported delta is noise, not a component's contribution. MEASURED, not
   * assumed: the old `h5Policy` was `b2Policy` under another name and its
   * own comment admitted it.
   */
  inertVsSrcla: boolean;
}

/**
 * One origin's proposal, captured verbatim from the replay so it can be
 * re-executed on a Base fork (§11.1). `decisionHash` is `null` for the policy
 * shapes that never call the kernel (`idle`, `frozen-equal-weight`) and have
 * no hash of their own; the fork replay labels those rather than inventing a
 * kernel hash for them.
 */
export interface CapturedProposal {
  originIndex: number;
  originTimestampSeconds: number;
  decisionHash: string | null;
  actions: BaselineAction[];
}

export interface RegisteredEvaluationResult {
  results: PolicyRunResult[];
  withdrawalSource: WithdrawalSchedule['source'];
  /** Artifact used; `provisional` is true when it is not calibrated. */
  artifact: PolicyArtifact;
  provisional: boolean;
  /**
   * Registered policy ids that produced no result AT SOME TIER, as
   * `policyId@tier`. §11.5 fails the gate on these.
   *
   * Per (policy, tier), not per policy: a global "was this id seen anywhere"
   * set would report nothing for a policy that ran at three tiers and was
   * skipped at the fourth, which is the same absence-reads-as-success shape
   * as a gate written `TIERS.every(...)` over the tiers that happen to be
   * present.
   */
  missingPolicyIds: string[];
  /** Registered tiers with no result. §11.5 fails the gate on these too. */
  missingTiers: bigint[];
  /**
   * §11.5's FORECAST gate over the artifact this run used and the labels it
   * evaluated it on.
   *
   * It lives here, beside the run, rather than being left to the caller for
   * the reason the forecast gate had to be written in the first place: the
   * only way half a release criterion goes four revisions without ever being
   * evaluated is by being something a caller has to remember to invoke.
   * Producing it as part of the run makes forgetting it impossible.
   */
  forecastGate: ForecastGateResult;
  /**
   * The same forecast gate under Amendment P37 (G1 + G2). Post-hoc on
   * `heldout-c` and `heldout-b`; the release verdict's forecast half on
   * `heldout-d`. `forecastGate` above stays the registered v0.10 gate.
   */
  forecastGateP37?: ForecastGateResult;
}

export interface RegisteredEvaluationOptions {
  dataset: EvaluationDataset;
  config: HarnessConfig;
  artifact: PolicyArtifact;
  tiers?: readonly bigint[];
  decideOpts?: Omit<DecideOpts, 'disable'>;
  /** Fraction of the dataset used to calibrate the artifact's quantiles. */
  calibrationFraction?: number;
  withdrawals?: WithdrawalSchedule;
  /**
   * Allocation quanta per tier (§8.2's quantum q). The quantum SCALES with
   * the tier — a fixed 1,000 USDC quantum would make the greedy search
   * 10,000 steps at the 10,000,000 tier and 10 steps at the 10,000 one, so
   * the two tiers would not be running the same search. Default 100, i.e.
   * a 1%-of-NAV quantum at every tier.
   */
  quantumStepsPerTier?: number;
  /**
   * Restrict the run to these registered policy ids.
   *
   * For CALIBRATION-TIME sweeps only (choosing P8's `k`, say), never for a
   * registered result: `missingPolicyIds` still reports every (policy, tier)
   * the protocol requires, so a filtered run cannot pass §11.5's completeness
   * check by simply not running the policies it would have failed on.
   */
  policyIds?: readonly string[];
  /**
   * Origins from BEFORE the evaluated window, used only to derive the history
   * the policy sees at its first origins.
   *
   * Without this an era is evaluated in isolation and every policy starts with
   * an empty `input.history`, so `admit`'s REGIME_MIN_HISTORY rejects every
   * venue until enough labels complete inside the window itself. On a 15-day
   * era with a 14-day horizon that is the WHOLE era -- every policy reported
   * exactly 0.000% net APY, which reads like a result and is an artifact of
   * where the window was cut.
   *
   * It is NOT look-ahead. Labels are past outcomes relative to the origin that
   * consumes them, and `labelsAvailableAt` still applies the availability lag,
   * so a warm-up origin can only supply history a live deployment would also
   * have had. The replay itself still runs over `dataset` alone, so nothing
   * before the era contributes a return, a cost or a rebalance.
   */
  warmupSnapshots?: readonly TimeOrderedSnapshot[];
  /**
   * The `_registration` block beside the registered artifact file.
   * `parseArtifact` drops it (it describes how the artifact was FIT, not what
   * the policy reads), so it is threaded separately. Absent means the
   * registration-dependent forecast-gate checks report NOT PRODUCED — which
   * blocks, rather than passing on a missing input.
   */
  registration?: ArtifactRegistration;
}

/**
 * Per-tier decide options: the allocation quantum is NAV/steps and the curve
 * is sampled over the whole deployable range. Sampling fewer points than
 * steps would clamp `rateAt` at a fraction of NAV and hide the capacity
 * decay the optimiser is supposed to see.
 */
export function decideOptsForTier(
  base: Omit<DecideOpts, 'disable'>,
  tier: bigint,
  steps: number,
): Omit<DecideOpts, 'disable'> {
  const quantumBase = tier / BigInt(steps);
  return {
    ...base,
    quantumBase: quantumBase > 0n ? quantumBase : 1n,
    maxCurvePoints: steps + 1,
  };
}

const seconds = (s: TimeOrderedSnapshot): number => Math.floor(s.timestamp.getTime() / 1000);

/**
 * Realized mean supply rate over [t_i, t_i + H] per (origin, market).
 * B5's hindsight input — and ONLY B5's: it reads values from after the
 * origin, which is why B5 is labelled non-deployable in the registry.
 */
export function buildHindsightRates(
  snapshots: TimeOrderedSnapshot[],
  horizonSeconds: number,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (let i = 0; i < snapshots.length; i++) {
    const origin = snapshots[i]!;
    const end = seconds(origin) + horizonSeconds;
    for (const m of origin.snapshots) {
      let sum = 0n;
      let n = 0n;
      for (let k = i; k < snapshots.length; k++) {
        const s = snapshots[k]!;
        if (seconds(s) > end) break;
        const obs = s.snapshots.find((x) => x.marketId === m.marketId);
        if (obs === undefined) continue;
        sum += obs.supplyRateE18;
        n += 1n;
      }
      if (n > 0n) out.set(`${i}:${m.marketId}`, sum / n);
    }
  }
  return out;
}

/**
 * Redemptions to execute, and the withdrawal series the reserve rule sees.
 *
 * Prefers the vault's real `WithdrawalEvent` history, scaled from the
 * observed vault NAV to the replay tier so a 10,000 USDC vault faces
 * proportionally the same demand a 10,000,000 one does. Falls back to a
 * REGISTERED deterministic schedule (a fixed fraction of the tier at a fixed
 * cadence) when the dataset carries no withdrawals — and says which it used,
 * because the two are not the same evidence.
 */
export function buildWithdrawalSchedule(
  dataset: EvaluationDataset,
  tier: bigint,
  opts: { redemptionBps?: number; cadenceSeconds?: number } = {},
): WithdrawalSchedule {
  const redemptionBps = BigInt(opts.redemptionBps ?? 500); // 5% of the tier
  // CADENCE IS TIME, NOT SNAPSHOT COUNT.
  //
  // This was `cadenceSnapshots: 7`, which meant "weekly" only because the
  // dataset it was written against had daily origins. Against the hourly
  // origins the archive backfill produces, the same 7 meant every SEVEN
  // HOURS: 5% of NAV seventeen times a day, ~240% of the vault demanded
  // inside a single 14-day reserve horizon. §8.1 then correctly required the
  // entire vault in cash, nothing was ever deployable, and all seventeen
  // policies realised exactly 0.000% net APY with zero rebalances -- a total
  // that looks like a policy result and is actually a unit error in the test
  // harness. Expressed in seconds it cannot silently rescale with the
  // dataset's cadence again.
  const cadenceSeconds = opts.cadenceSeconds ?? 7 * 86_400;

  const observed = dataset.withdrawals ?? [];
  if (observed.length > 0 && dataset.snapshots.length > 0) {
    // Reference NAV: the largest vault NAV seen in the window. Every market
    // row carries the vault's own totalAssetsBase, so any row will do.
    let referenceNav = 0n;
    for (const s of dataset.snapshots) {
      for (const m of s.snapshots) {
        if (m.totalAssetsBase > referenceNav) referenceNav = m.totalAssetsBase;
      }
    }
    if (referenceNav > 0n) {
      const times = dataset.snapshots.map(seconds);
      const requests: WithdrawalRequest[] = [];
      for (const w of observed) {
        const at = w.timestampSeconds;
        let index = times.findIndex((t) => t >= at);
        if (index < 0) index = times.length - 1;
        const assetsBase = (w.assetsBase * tier) / referenceNav;
        if (assetsBase > 0n) requests.push({ snapshotIndex: index, assetsBase });
      }
      if (requests.length > 0) return { requests, source: 'observed' };
    }
  }

  const requests: WithdrawalRequest[] = [];
  if (dataset.snapshots.length > 0) {
    const firstSeconds = seconds(dataset.snapshots[0]!);
    let nextAt = firstSeconds + cadenceSeconds;
    for (let i = 0; i < dataset.snapshots.length; i++) {
      if (seconds(dataset.snapshots[i]!) >= nextAt) {
        requests.push({
          snapshotIndex: i,
          // Reporting value only; the replay re-sizes against live NAV.
          assetsBase: (tier * redemptionBps) / 10_000n,
          // A FRACTION OF NAV, not of the initial tier. See
          // WithdrawalRequest.navFractionBps: a fixed fraction of the tier
          // demands 190% of the vault over a 267-day era, exhausts the
          // cohort's shares two thirds of the way through, and makes every
          // policy report the same withdrawal-success rate because the
          // failures are share exhaustion rather than illiquidity.
          navFractionBps: Number(redemptionBps),
        });
        nextAt += cadenceSeconds;
      }
    }
  }
  return { requests, source: 'registered-schedule' };
}

/**
 * The withdrawal series the RESERVE rule sees at each origin, i.e. the
 * demand history Q_beta(W_H) is computed from. It is the same schedule the
 * replay executes, so the reserve is sized against the demand it will
 * actually face rather than against a series nobody acts on.
 */
function withdrawalObservations(
  schedule: WithdrawalSchedule,
  snapshots: TimeOrderedSnapshot[],
): DecisionInput['withdrawals'] {
  return schedule.requests
    .filter((r) => r.snapshotIndex < snapshots.length)
    .map((r) => ({
      timestampSeconds: seconds(snapshots[r.snapshotIndex]!),
      assetsBase: r.assetsBase,
    }));
}

/**
 * Build the artifact actually used for a run: the bootstrap/registered
 * artifact with `pinnedConfigDigests` taken from the dataset's first
 * observation of each market (§6.2's registration pin) and per-venue
 * residual quantiles calibrated on the CALIBRATION split only (§7.3's
 * no-look-ahead rule).
 */
export function prepareArtifact(
  base: PolicyArtifact,
  dataset: EvaluationDataset,
  labels: CompletedLabel[],
  calibrationFraction: number,
): PolicyArtifact {
  // A REGISTERED artifact is FROZEN. Returning it untouched is not an
  // optimisation, it is the whole point of registering one.
  //
  // Everything below re-fits the quantiles and re-pins the digests from the
  // dataset it is handed. That is right for the PROVISIONAL bootstrap, whose
  // quantiles are placeholders and whose only data is the run's own -- but
  // against a registered artifact and a HELD-OUT era it would refit the
  // policy on the very data the run is meant to test, which is the
  // look-ahead §2.2 rejects outright. It would also silently discard the
  // calibration era's registration, so the artifact hash in the manifest
  // would describe something the run did not use.
  if (base._provisional === undefined) return base;

  // Pinned IDENTITIES, from every digest observed -- not the first FULL
  // digest seen. Pinning the full digest makes a venue permanently
  // inadmissible at its first governance rate change, which is what made an
  // earlier end-to-end run realise 0.000% for all seventeen policies. See
  // src/domain/config-digest.ts.
  const digestsByMarket = new Map<string, Set<string>>();
  for (const s of dataset.snapshots) {
    for (const m of s.snapshots) {
      const set = digestsByMarket.get(m.marketId) ?? new Set<string>();
      set.add(m.configDigest);
      digestsByMarket.set(m.marketId, set);
    }
  }
  const pinnedConfigDigests: Record<string, string> = {};
  for (const [marketId, set] of digestsByMarket) {
    pinnedConfigDigests[marketId] = buildIdentityPin(set);
  }

  const splitIndex = Math.floor(dataset.snapshots.length * calibrationFraction);
  const splitSeconds =
    splitIndex > 0 && splitIndex < dataset.snapshots.length
      ? seconds(dataset.snapshots[splitIndex]!)
      : Number.POSITIVE_INFINITY;
  const calibrationLabels = labels.filter((l) => l.availableAtSeconds <= splitSeconds);

  // P2: the aligned residual panel, from the CALIBRATION labels only. This
  // is what makes `q^p_alpha(w)` depend on w — without it the portfolio
  // quantile is a frozen scalar times notional, invariant to the mix, and
  // P2 cannot change a ranking (readiness audit NEW-7). `undefined` when
  // there is not enough aligned history: the frozen scalar is then used and
  // the run says so, rather than a panel being fabricated.
  const residualPanel = buildResidualPanel(calibrationLabels, base.minObservations);

  const prepared: PolicyArtifact = {
    ...base,
    pinnedConfigDigests,
    residualQuantileWadByMarket: calibrateResidualQuantiles(
      calibrationLabels,
      base.coverageTarget,
      base.minObservations,
    ),
    // §7.2's SECOND registered target, calibrated on the SAME split, with
    // the same coverage target and the same minimum-observation rule as the
    // first. It supplies e_i^cons in §8.1 and phi_i in §8.2; before this it
    // was never registered, calibrated or applied anywhere (audit NEW-11)
    // and both consumers read the spot cash instead.
    cashResidualQuantileWadByMarket: calibrateCashResidualQuantiles(
      calibrationLabels,
      base.coverageTarget,
      base.minObservations,
    ),
  };
  if (residualPanel !== undefined) prepared.residualPanel = residualPanel;
  return prepared;
}

/**
 * Build the `PolicyFn` the replay drives for one registered policy.
 *
 * Everything except B0 and B4 is literally `decide(input, artifact, {...opts,
 * disable: policy.disable})`. `decisionHashes` is appended to on every
 * origin so the caller can prove afterwards whether the switch changed
 * anything.
 */
export function createKernelPolicyFn(
  policy: RegisteredPolicy,
  ctx: {
    artifact: PolicyArtifact;
    opts: Omit<DecideOpts, 'disable'>;
    config: HarnessConfig;
    labels: CompletedLabel[];
    withdrawals: DecisionInput['withdrawals'];
    hindsightRates: Map<string, bigint>;
    decisionHashes: string[];
    /** §11.4 census, mutated in place across every origin this policy runs. */
    hurdleBlocks: Record<string, number>;
    onRebalance: () => void;
    /**
     * Called with EVERY non-empty proposal this policy makes. The harness
     * keeps only the first (see `PolicyRunResult.firstProposal`); the hook is
     * per-proposal rather than first-only so a caller that wants a different
     * origin does not have to re-run the replay to get one.
     */
    onProposal?: (proposal: CapturedProposal) => void;
  },
): PolicyFn {
  let frozen: Map<string, bigint> | null = null;
  // §9.1 churn history for this policy's run. The replay driver keeps it in
  // memory where the live driver reads it from `Decision` rows, but BOTH
  // reduce it through the same `summariseLastAction`, so the cooldown,
  // turnover window and reversal allowance a policy is evaluated under are
  // the ones it would face in production. The previous version tracked only
  // `lastActionSeconds` plus a `turnoverWindowBase` that was OVERWRITTEN on
  // every rebalance — a one-decision window, not a rolling one — and had no
  // reversal state at all.
  const actionHistory: PersistedActionRecord[] = [];
  const recordAction = (originSeconds: number, actions: BaselineAction[]): void => {
    actionHistory.push({
      timestampSeconds: originSeconds,
      isAction: true,
      moves: actions.map((a) => ({
        marketId: a.adapter,
        deltaBase: a.kind === 'divest' ? -a.amount : a.amount,
      })),
    });
  };

  return (state, snapshot) => {
    if (policy.shape === 'idle') return [];

    const originSeconds = Math.floor(snapshot.timestamp.getTime() / 1000);
    const visible = labelsAvailableAt(ctx.labels, originSeconds);
    const seenWithdrawals = ctx.withdrawals.filter((w) => w.timestampSeconds <= originSeconds);

    let input = buildDecisionInput(
      state,
      snapshot,
      visible,
      seenWithdrawals,
      ctx.config,
      summariseLastAction(actionHistory, originSeconds, {
        turnoverWindowSeconds: ctx.opts.cost.turnoverWindowSeconds,
        reversalWindowSeconds: ctx.opts.cost.reversalWindowSeconds,
      }),
    );

    if (policy.shape === 'hindsight') {
      // B5 only: replace each venue's displayed rate with its realized mean
      // over the forecast horizon. Combined with `capacityCurves: true` this
      // ranks on what actually happened. See the registry note on why the
      // substitution has to reach the curve.
      input = {
        ...input,
        markets: input.markets.map((m) => ({
          ...m,
          supplyRateWad: ctx.hindsightRates.get(`${snapshot.index}:${m.marketId}`) ?? m.supplyRateWad,
        })),
      };
    }

    if (policy.shape === 'frozen-equal-weight') {
      frozen = frozenEqualWeightTarget(input, ctx.artifact, frozen, {
        quantile: ctx.opts.reserveQuantile,
        horizonSeconds: ctx.opts.reserveHorizonSeconds,
      });
      if (frozen === null) return [];
      const actions = targetToActions(frozen, state.strategyBalances);
      if (actions.length > 0) {
        recordAction(originSeconds, actions);
        ctx.onRebalance();
        ctx.onProposal?.({
          originIndex: snapshot.index,
          originTimestampSeconds: originSeconds,
          decisionHash: null,
          actions,
        });
      }
      return actions;
    }

    const out = runKernel(policy, input, { artifact: ctx.artifact, opts: ctx.opts });
    ctx.decisionHashes.push(out.decisionHash);
    // §11.4 census — every origin, not only rebalances, so a run that held
    // throughout still reports WHY (ADMISSION_EMPTY, NOT_EVALUATED, a churn
    // brake, ...) rather than reducing to a bare rebalance count.
    accumulateCensus(out.costGate.legs, ctx.hurdleBlocks);
    accumulateGateCensus(out.costGate, ctx.hurdleBlocks);
    if (out.action !== 'rebalance') return [];

    const actions = targetToActions(out.target, state.strategyBalances);
    if (actions.length === 0) return [];

    recordAction(originSeconds, actions);
    ctx.onRebalance();
    ctx.onProposal?.({
      originIndex: snapshot.index,
      originTimestampSeconds: originSeconds,
      decisionHash: out.decisionHash,
      actions,
    });
    return actions;
  };
}

/**
 * Run the whole registered protocol: every policy, every tier, one kernel.
 */
export function runRegisteredEvaluation(
  options: RegisteredEvaluationOptions,
): RegisteredEvaluationResult {
  const { dataset, config } = options;
  const tiers = options.tiers ?? REGISTERED_TIERS;
  const baseOpts: Omit<DecideOpts, 'disable'> = options.decideOpts ?? DEFAULT_DECIDE_OPTS;
  const quantumSteps = options.quantumStepsPerTier ?? 100;

  // Labels come from the warm-up PLUS the evaluated window; the replay below
  // runs over the evaluated window alone. See `warmupSnapshots`.
  const warmup = options.warmupSnapshots ?? [];
  const labels = deriveCompletedLabels(
    warmup.length > 0 ? [...warmup, ...dataset.snapshots] : dataset.snapshots,
    config.horizonSeconds,
    config.availabilityLagSeconds,
  );
  const artifact = prepareArtifact(
    options.artifact,
    dataset,
    labels,
    options.calibrationFraction ?? 0.7,
  );
  const hindsightRates = buildHindsightRates(dataset.snapshots, config.horizonSeconds);
  const firstOriginSeconds =
    dataset.snapshots.length > 0
      ? Math.floor(dataset.snapshots[0]!.timestamp.getTime() / 1000)
      : 0;
  const replayGas = gasAt(config.gas, firstOriginSeconds);

  const results: PolicyRunResult[] = [];
  let withdrawalSource: WithdrawalSchedule['source'] = 'registered-schedule';

  for (const tier of tiers) {
    const schedule = options.withdrawals ?? buildWithdrawalSchedule(dataset, tier);
    withdrawalSource = schedule.source;
    const withdrawals = withdrawalObservations(schedule, dataset.snapshots);

    const opts = decideOptsForTier(baseOpts, tier, quantumSteps);
    const perTier: PolicyRunResult[] = [];
    const policies =
      options.policyIds === undefined
        ? REGISTERED_POLICIES
        : REGISTERED_POLICIES.filter((p) => options.policyIds!.includes(p.id));
    for (const policy of policies) {
      const decisionHashes: string[] = [];
      const hurdleBlocks: Record<string, number> = {};
      let rebalances = 0;
      let firstProposal: CapturedProposal | null = null;
      const policyFn = createKernelPolicyFn(policy, {
        artifact,
        opts,
        config,
        labels,
        withdrawals,
        hindsightRates,
        decisionHashes,
        hurdleBlocks,
        onRebalance: () => {
          rebalances += 1;
        },
        onProposal: (proposal) => {
          if (firstProposal === null) firstProposal = proposal;
        },
      });

      const replay = runReplay({
        dataset,
        evaluationId: policy.id,
        startDate: dataset.snapshots[0]?.timestamp ?? new Date(0),
        endDate: dataset.snapshots[dataset.snapshots.length - 1]?.timestamp ?? new Date(0),
        tier,
        policy: policyFn,
        withdrawals: schedule.requests,
        // The replay books realized gas per action at a single price. It is
        // resolved at the FIRST origin of the window rather than taken from a
        // constant, so a run over a cheap period is not charged a dear
        // period's fees. Per-action pricing lives inside the kernel's own
        // cost model, which sees the full series through DecisionInput.gas.
        gasPriceWei: replayGas.l2BaseFeeWei,
        ethUsdE8: replayGas.ethUsdE8,
      });

      // §11.4 — derived from the replay's own snapshot series (idle/deployed
      // are already tracked there), plus the census this policy's origins
      // accumulated above. `idleDragApy` needs the H3d row, which has not
      // run yet at this point in the loop, so it is filled in below.
      const series = replay.snapshots.map((s) => ({
        idleBase: s.idleBase,
        deployedBase: s.totalAssets - s.idleBase,
      }));
      const deploymentMetrics: DeploymentMetrics = {
        capitalAtWorkFraction: capitalAtWork(series),
        deploymentLatencyOrigins: deploymentLatency(series),
        idleDragApy: null,
        hurdleBlocks,
      };

      perTier.push({
        policy,
        tier,
        replay: { ...replay, ...deploymentMetrics },
        decisionHashes,
        rebalances,
        inertVsSrcla: false,
        firstProposal,
      });
    }

    const srcla = perTier.find((r) => r.policy.id === SRCLA_POLICY.id);
    for (const r of perTier) {
      if (r.policy.id === SRCLA_POLICY.id || srcla === undefined) continue;
      r.inertVsSrcla =
        r.policy.shape === 'kernel' &&
        r.decisionHashes.length === srcla.decisionHashes.length &&
        r.decisionHashes.every((h, i) => h === srcla.decisionHashes[i]);
    }

    // idleDragApy (§9.1.2's ablation, H3d): this run's net APY minus SRCLA's
    // net APY with the deployment hurdle disabled. H3d is not registered by
    // this task (`REGISTERED_ABLATIONS` carries no `h3d` id), so `perTier`
    // never actually contains one yet and this stays a no-op until it does —
    // deliberately: the follow-on plan registers H3d, and nothing here
    // should have to change when it does.
    const h3d = perTier.find((r) => r.policy.id === 'h3d');
    if (h3d !== undefined && srcla !== undefined) {
      srcla.replay.idleDragApy = srcla.replay.realizedNetApy - h3d.replay.realizedNetApy;
    }

    results.push(...perTier);
  }

  const seenPairs = new Set(results.map((r) => `${r.policy.id}@${r.tier}`));
  const seenTiers = new Set(results.map((r) => r.tier.toString()));

  // Every registered policy is required at every REGISTERED tier, not merely
  // at the tiers this invocation happened to run: a run restricted with
  // `--tiers` is an incomplete run, and §11.5 fails on a missing tier.
  const missingPolicyIds: string[] = [];
  for (const t of REGISTERED_TIERS) {
    for (const p of REGISTERED_POLICIES) {
      if (!seenPairs.has(`${p.id}@${t}`)) missingPolicyIds.push(`${p.id}@${t}`);
    }
  }

  return {
    results,
    withdrawalSource,
    artifact,
    provisional: artifact._provisional !== undefined,
    missingPolicyIds,
    missingTiers: REGISTERED_TIERS.filter((t) => !seenTiers.has(t.toString())),
    forecastGate: runForecastGate(artifact, labels, {
      registration: options.registration,
    }),
    forecastGateP37: runForecastGate(artifact, labels, {
      registration: options.registration,
      amendment: 'p37',
    }),
  };
}

/**
 * §11.1's PINNED-PRESTATE FORK REPLAY, for a completed registered run.
 *
 * This is `fork-runner.ts`'s caller. Each (policy, tier) contributes the
 * first origin at which it actually proposed a move; that proposal is
 * re-executed against the deployed vault on a Base fork, from the same
 * pinned prestate, through `submitPlan` + `executeNextActionWithProof`.
 *
 * It is DELIBERATELY not called by `runRegisteredEvaluation`. That function
 * is synchronous and pure over a dataset; this one needs a live RPC, a
 * deployed vault and an allocator key. An offline run therefore supplies no
 * `forkResults`, and §11.5's completeness check reports NOT PRODUCED and
 * blocks — which is the correct verdict for a run that produced no replay,
 * and is why this is a separate call rather than a best-effort step inside
 * the evaluation that could silently no-op.
 *
 * A policy that held at every origin is replayed as a HOLD: the result says
 * so in its `detail` and does not claim an execution.
 */
export async function runRegisteredForkReplays(
  out: RegisteredEvaluationResult,
  // `registeredBench` is REQUIRED here: a registered replay on a vault that
  // does not carry the registered harness values tests a different
  // experiment, so the caller may not skip the check by omission.
  opts: ForkReplayOptions & { registeredBench: ForkBenchVaultConfig },
): Promise<ForkReplayResult[]> {
  const plans: ForkReplayPlan[] = out.results.map((r) => {
    const proposal = r.firstProposal;
    // Shapes with no kernel hash (`idle`, `frozen-equal-weight`) get a
    // labelled, deterministic, non-zero stand-in: `submitPlan` rejects a zero
    // decision hash, and fabricating a kernel-looking hash for a policy that
    // never ran the kernel would misattribute the plan's provenance.
    // The kernel's hash needs its `0x` restored before `submitPlan` can take
    // it as a bytes32; see `forkDecisionHash`.
    const decisionHash =
      proposal?.decisionHash !== undefined && proposal?.decisionHash !== null
        ? forkDecisionHash(proposal.decisionHash, `${r.policy.id}@${r.tier}`)
        : keccak256(toUtf8Bytes(`srcla-fork-replay|${r.policy.id}|${r.tier}|${proposal?.originIndex ?? -1}`));
    return {
      policyId: r.policy.id,
      tier: r.tier,
      originIndex: proposal?.originIndex ?? -1,
      decisionHash,
      actions: (proposal?.actions ?? []).map((a) => ({
        kind: a.kind,
        marketId: a.adapter,
        amountBase: a.amount,
      })),
    };
  });
  return runForkReplays(plans, opts);
}
