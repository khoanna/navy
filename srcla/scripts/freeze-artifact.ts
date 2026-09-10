#!/usr/bin/env tsx
/**
 * Freeze the registered `PolicyArtifact` from a grid sweep over the
 * CALIBRATION ERA ONLY (paper §7.2, §7.3; amendments P1 and P8).
 *
 * This is the last thing that may look at data before the held-out run, and
 * the only thing that fits anything. Two guards make that structural rather
 * than procedural:
 *
 *   1. It loads through `loadEra(prisma, 'calibration', ...)`, and
 *      `assertNotSealed` throws for either held-out era.
 *   2. It re-asserts the era of every row it received, because the point of a
 *      seal is that it does not depend on one call site being right.
 *
 * The output carries NO `_provisional` field. That field is what §11.5's
 * "Calibrated artifact" check blocks on, so writing it here would produce an
 * artifact that fails the gate it exists to pass.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx scripts/freeze-artifact.ts \
 *     [--out config/registered-artifact.json] [--min-observations 30] [--sweep-k]
 *
 * `--sweep-k` is OPT-IN because it runs SRCLA through six full replays of the
 * calibration era and takes the better part of an hour, which is too long to
 * sit on the critical path of every re-freeze. Without it, k is reported
 * UNRESOLVED at the registered default of 1.0 -- which is not a guess, it is
 * a refusal to claim, and it is what the report then says.
 *
 * RUNTIME. P18's two decision-focused loss terms are NOT opt-in: a selection
 * made without them is the v0.6 selection, and there must be no flag that
 * quietly produces one. (`--selection-subsample N` makes a run FASTER, never
 * term-free, and refuses to write the registered artifact.) They are measured
 * over a SEQUENTIAL replay of the calibration era per candidate -- see
 * `src/forecast/decision-score.ts` for why a frozen per-origin state made both
 * terms measure the opposite of what §7.3 asks them for. Measured cost on the registered 81-point grid over
 * the 443-day calibration era: 63 ms per decision on average at
 * SELECTION_QUANTUM_STEPS allocation quanta, 886 origins per candidate after
 * the stride, i.e. ~56 s per grid point and ~76 minutes for the sweep.
 * Budget for that; it is the price of a forecast selection that can see what
 * its consumer does with the forecast. See SELECTION_QUANTUM_STEPS for what
 * the registered quantum would have cost instead.
 *
 * UNITS: returns and quantiles are WAD over the horizon; times are seconds.
 */
import { writeFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { parseArtifact } from '../src/policy/artifact.js';
import { REGISTERED_ERAS, eraBounds, eraFor } from '../src/evaluation/eras.js';
import {
  buildDecisionInput,
  deriveCompletedLabels,
  calibrateCashResidualQuantiles,
  labelsAvailableAt,
} from '../src/evaluation/kernel/decision-input.js';
import {
  attachDecisionTerms,
  interquartileRange,
  registeredGrid,
  nearTieResolution,
  resolveNearTie,
  residualsFor,
  scoreGrid,
  selectPoint,
  sweep,
  MIN_DISCRIMINATING_IQR,
  MIN_SELECTION_MARGIN,
  type GridPoint,
  type ResidualObservations,
  type ScoredPoint,
  type SweepRow,
} from '../src/forecast/grid-sweep.js';
import {
  bestNetReturn,
  sacrificedReturn,
  scoreCandidateDecisions,
  type DecisionScore,
} from '../src/forecast/decision-score.js';
import {
  buildRelativeResidualPanel,
  buildResidualPanel,
} from '../src/policy/steps/portfolio-quantile.js';
import { buildIdentityPin, regimeOf } from '../src/domain/config-digest.js';
import {
  buildWithdrawalSchedule,
  decideOptsForTier,
  runRegisteredEvaluation,
} from '../src/evaluation/kernel/harness.js';
import { SRCLA_POLICY } from '../src/evaluation/kernel/registry.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import type { HarnessConfig } from '../src/evaluation/kernel/decision-input.js';
import type { EvaluationDataset } from '../src/evaluation/dataset.js';
import type { VaultState } from '../src/evaluation/replay/state.js';
import type { DecisionInput, PolicyArtifact } from '../src/policy/types.js';
import type { CompletedLabel } from '../src/policy/types.js';
import type { HorizonSeconds } from '../src/policy/registered.js';
import { K_CANDIDATES } from '../src/policy/registered.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** §7.3's availability lag: an outcome is usable only once it is readable. */
const AVAILABILITY_LAG_SECONDS = 900;

/** Registered until the P18 sweep resolves them (see the plan's open registrations). */
const PAYBACK_SECONDS = 30 * 24 * 60 * 60;
const ADJUSTMENT_RATE = 1;

/**
 * Registered selection subsample. The full replay runs ONCE for the winner;
 * the grid is ranked on every Nth origin. The v0.6 k-sweep reached 0 of 7
 * candidates in 65 minutes without this (release-readiness ruling F15), and
 * this plan makes each grid point strictly more expensive.
 *
 * APPLIED AT ORIGIN CONSTRUCTION, not inside `scoreCandidateDecisions`, and
 * the scorer is then called with `everyNth: 1`. The two are equivalent in
 * what gets scored; they are not equivalent in memory. `buildDecisionInput`
 * retains a `history` array per origin, and materialising all 10,632
 * calibration origins holds ~1.4e8 label references (>1GB) per horizon before
 * the stride discards 11 of every 12 of them. `originsScored` in the recorded
 * `DecisionScore` is therefore the count AFTER the stride, which is the number
 * the registration means.
 */
const SELECTION_SUBSAMPLE = 12;

/** The one path a REGISTERED artifact may be written to. */
const REGISTERED_ARTIFACT_PATH = 'config/registered-artifact.json';

/**
 * `--selection-subsample N` runs the ranking on a coarser stride, for
 * iteration. It is NOT an opt-out: the decision terms still run, the
 * non-registered stride is stamped into `_registration.selectionSubsample`
 * beside `selectionSubsampleRegistered: false`, and the script REFUSES to
 * write to `config/registered-artifact.json`. A fast run is therefore
 * self-identifying and cannot be mistaken for a registration by anyone
 * reading the artifact later.
 */
function resolveSubsample(): { everyNth: number; registered: boolean } {
  const raw = arg('selection-subsample');
  if (raw === undefined) return { everyNth: SELECTION_SUBSAMPLE, registered: true };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || Math.round(n) !== n) {
    throw new Error(`--selection-subsample must be a positive integer, got ${raw}`);
  }
  return { everyNth: n, registered: n === SELECTION_SUBSAMPLE };
}

/**
 * The vault the selection decisions are scored at: the third registered tier
 * (§11.1), held ENTIRELY IDLE at every origin.
 *
 * The SEEDING state, not the state every origin sees. Every candidate starts
 * from the same fully idle vault -- the state a real deployment starts from,
 * and the only one that is candidate-independent -- and then follows its OWN
 * trajectory from there: `scoreCandidateDecisions` threads positions, idle,
 * accrued interest, movement cost and §9.1 churn history forward across
 * origins.
 *
 * That comparison IS of trajectories, and it has to be. The first version of
 * this froze the state at every origin so that all candidates faced literally
 * identical inputs; the result was 886 independent cold starts in which
 * nothing could ever rotate, `turnover` measured deployed fraction and
 * penalised it, and a candidate that admitted no venue at all scored the best
 * attainable value on both economic terms. Comparability came at the price of
 * measuring the opposite of the intended quantity.
 */
const SELECTION_TIER_BASE = 1_000_000_000_000n;

/**
 * Allocation quanta per NAV for the SELECTION scoring only.
 *
 * MEASURED, not chosen for elegance. §8.2's exhaustive check walks
 * `C(steps+3, 3)` candidates at three venues, and each leaf runs a full
 * feasibility test (caps, dependency groups, §8.1's reserve and its stress
 * scenarios) plus a portfolio lower bound over the artifact's residual panel,
 * which on this era is 10,608 rows x 3 venues.
 *
 *   5 quanta  ->     56 leaves ->  63 ms/decision on average (92 ms at
 *                                    H=1d, 57 ms at H=7d, 41 ms at H=14d)
 *                                    -> 4,547 s, ~76 min, for the 81-point
 *                                    grid over the calibration era.
 *   50 quanta -> 23,426 leaves -> a 420x larger enumeration. A partial probe
 *                                 could not get below 12 s/decision even on
 *                                 early origins, where `admit` short-circuits
 *                                 for want of regime history and the decision
 *                                 returns before the optimiser runs at all;
 *                                 on real origins that is days for the grid.
 *
 * Ranking does not need 2%-of-NAV allocation resolution. The WINNER is
 * re-scored at the registered quantum by the full replay, which is the run
 * that produces a citable number. Recorded in `_registration` so the
 * coarsening is disclosed rather than hidden.
 */
const SELECTION_QUANTUM_STEPS = 5;

/**
 * Overlapping horizons mean W consecutive labels carry far less than W
 * independent observations. The registered deflation is the Newey-West style
 * ratio of the window to the overlap factor, floored at 1.
 */
function effectiveWindow(point: { methodParams: Record<string, number>; horizonSeconds: number }, horizonSeconds: number): number {
  const w = point.methodParams['windowObservations'] ?? 24;
  const overlap = Math.max(1, horizonSeconds / 3600);
  return Math.max(1, w / overlap);
}

/**
 * Score each candidate `k` by RUNNING THE POLICY, on the calibration era.
 *
 * The first version of this scored a proxy -- how many consecutive-label gaps
 * fell under `k * sigma` -- and produced a step function: 0% blocked at k=0,
 * 99.28% at k=0.25, 100% at k>=1. It then reported "k RESOLVED to 0" because
 * the spread was wide, which is a value chosen because the sweep moved rather
 * than because the sweep was informative, and disabling the no-trade band
 * outright would quietly change what H3 measures.
 *
 * The proxy was wrong in scale: it compared a horizon-return-magnitude sigma
 * against gaps between consecutive labels. What §9.1 actually asks -- and what
 * `config/bootstrap-artifact.json` says is needed, "a held-out
 * turnover-vs-return sweep" -- is the realised trade-off, so this runs SRCLA
 * through the real replay once per candidate and reads net APY and turnover
 * off it.
 *
 * A sweep whose net APY varies by less than `MIN_APY_SPREAD` across every
 * candidate is INCONCLUSIVE and is reported as such. An inconclusive sweep
 * honestly reported is a result; a value picked from noise is not.
 */
const MIN_APY_SPREAD = 1e-5; // 0.001 pp

interface KSweepRow {
  k: number;
  realizedNetApy: number;
  totalTurnoverBase: string;
  rebalances: number;
}

function sweepNoTradeBandK(
  dataset: EvaluationDataset,
  baseArtifact: PolicyArtifact,
  config: HarnessConfig,
): { rows: KSweepRow[]; resolved: boolean; selected: number; reason: string } {
  const rows: KSweepRow[] = [];
  // ONE tier and SRCLA only: this is choosing a scalar, not producing a
  // registered result, and the full grid would cost 68x more for a number
  // that does not depend on the tier.
  const tier = 1_000_000_000_000n;

  for (const k of K_CANDIDATES) {
    const artifact: PolicyArtifact = { ...baseArtifact, noTradeBandK: k };
    const out = runRegisteredEvaluation({
      dataset,
      config,
      artifact,
      tiers: [tier],
      decideOpts: DEFAULT_DECIDE_OPTS,
      calibrationFraction: 1.0,
      policyIds: [SRCLA_POLICY.id],
    });
    const r = out.results.find((x) => x.policy.id === SRCLA_POLICY.id);
    if (r === undefined) continue;
    rows.push({
      k,
      realizedNetApy: r.replay.realizedNetApy,
      totalTurnoverBase: r.replay.totalTurnover.toString(),
      rebalances: r.rebalances,
    });
    console.log(
      `    k=${String(k).padEnd(5)} net APY ${(r.replay.realizedNetApy * 100).toFixed(4)}%  ` +
        `turnover ${(Number(r.replay.totalTurnover) / 1e6).toFixed(0)}  rebalances ${r.rebalances}`,
    );
  }

  if (rows.length === 0) {
    return {
      rows,
      resolved: false,
      selected: 1.0,
      reason: 'the sweep produced no scorable run; k is unregistered and stays at 1.0',
    };
  }

  const apys = rows.map((r) => r.realizedNetApy);
  const spread = Math.max(...apys) - Math.min(...apys);
  if (spread < MIN_APY_SPREAD) {
    return {
      rows,
      resolved: false,
      selected: 1.0,
      reason:
        `INCONCLUSIVE: net APY varies by only ${(spread * 100).toFixed(6)} pp across ` +
        `k in {${K_CANDIDATES.join(', ')}}. k stays at the registered default 1.0 and every ` +
        `P8 result is provisional. Picking a winner from this spread would be picking noise.`,
    };
  }

  // Best net APY; ties broken toward the SMALLER band, which is the weaker
  // claim -- a wide band that merely matched a narrow one has not earned it.
  const best = rows.reduce((a, b) =>
    b.realizedNetApy > a.realizedNetApy + MIN_APY_SPREAD ? b : a,
  );
  return {
    rows,
    resolved: true,
    selected: best.k,
    reason:
      `k=${best.k} realised ${(best.realizedNetApy * 100).toFixed(4)}% against a spread of ` +
      `${(spread * 100).toFixed(4)} pp over the calibration era`,
  };
}

async function main(): Promise<void> {
  const outPath = arg('out') ?? REGISTERED_ARTIFACT_PATH;
  const subsample = resolveSubsample();
  // Resolved, not suffix-matched: `config//registered-artifact.json` and
  // `config/../config/registered-artifact.json` both name the registered
  // artifact and neither ends with the literal path.
  const writesRegisteredArtifact = resolvePath(outPath) === resolvePath(REGISTERED_ARTIFACT_PATH);
  if (!subsample.registered && writesRegisteredArtifact) {
    throw new Error(
      `--selection-subsample ${subsample.everyNth} is not the registered stride ` +
        `(${SELECTION_SUBSAMPLE}), so this run may not write ${REGISTERED_ARTIFACT_PATH}. ` +
        `Pass --out to a scratch path, or drop the override.`,
    );
  }
  if (!subsample.registered) {
    console.log(
      `[freeze] NON-REGISTERED selection stride ${subsample.everyNth} (registered is ` +
        `${SELECTION_SUBSAMPLE}). This is an iteration artifact and says so in _registration.`,
    );
  }
  const minObservations = arg('min-observations') !== undefined ? Number(arg('min-observations')) : 30;
  const shouldSweepK = process.argv.includes('--sweep-k');

  const prisma = new PrismaClient();
  try {
    const era = REGISTERED_ERAS.calibration;
    const bounds = eraBounds('calibration');
    console.log(`[freeze] calibration era ${bounds.start} -> ${bounds.end} (${bounds.days}d)`);

    // Guard 1: loadEra refuses a sealed era.
    const dataset = await loadEra(prisma, 'calibration', 'registered grid sweep');
    console.log(`[freeze] ${dataset.snapshots.length} origins loaded`);
    if (dataset.snapshots.length === 0) {
      throw new Error(
        'the calibration era is empty. Run `pnpm backfill:history` first; this script will ' +
          'not fit an artifact on invented data.',
      );
    }

    // Guard 2: re-assert every row's era. A seal that depends on one call
    // site being right is not a seal.
    for (const s of dataset.snapshots) {
      const tag = eraFor(Math.floor(s.timestamp.getTime() / 1000));
      if (tag !== 'calibration') {
        throw new Error(
          `SEAL VIOLATION: loadEra('calibration') returned an origin at ` +
            `${s.timestamp.toISOString()} which belongs to era '${tag ?? 'none'}'. ` +
            `Refusing to fit. This invalidates the held-out result if it is not fixed.`,
        );
      }
    }

    // Labels at every registered horizon, so the grid can traverse them (F1).
    const allLabels: CompletedLabel[] = [];
    for (const horizon of [86_400, 604_800, 1_209_600] as const) {
      allLabels.push(
        ...deriveCompletedLabels(
          dataset.snapshots,
          horizon as HorizonSeconds,
          AVAILABILITY_LAG_SECONDS,
        ),
      );
    }
    console.log(`[freeze] ${allLabels.length} completed labels across 3 horizons`);

    const grid = registeredGrid();
    console.log(`[freeze] sweeping ${grid.length} registered grid points...`);
    const rows: SweepRow[] = sweep(allLabels, grid, minObservations);
    console.log(`[freeze] ${rows.length} points scorable`);

    // ---- Everything a CANDIDATE artifact needs, hoisted above selection.
    //
    // P18 scores each grid point by running the registered decision rule under
    // that point's own artifact, so the pins, the gas series and the per-
    // horizon calibration material all have to exist before a winner does.

    // Pinned IDENTITIES, from every one observed during calibration.
    //
    // Not the first digest seen, and not the whole digest: pinning the whole
    // thing makes a venue permanently inadmissible at its first governance
    // rate change, which is what made the first end-to-end run realise 0.000%
    // for every policy. Registering the SET of identities is the honest
    // analogue of an operator pinning what was deployed -- a novel
    // implementation in the held-out era is still caught. See
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
      const regimes = new Set([...set].map(regimeOf)).size;
      console.log(
        `[freeze] ${marketId.padEnd(18)} identities=${pinnedConfigDigests[marketId]!.split(',').length} ` +
          `regimes=${regimes}`,
      );
    }

    const gas = await loadGasSeries(
      prisma,
      dataset.snapshots[0]!.timestamp,
      dataset.snapshots[dataset.snapshots.length - 1]!.timestamp,
    );

    const harnessConfigFor = (h: HorizonSeconds): HarnessConfig => ({
      vault: { adminReserveBase: 0n, minIdleBps: 500, configurationDigest: '0x' + '00'.repeat(32) },
      markets: {},
      defaultMarket: { capBps: 5_000, absoluteCapBase: 10n ** 15n, maxLossBps: 50, dependencyGroupIds: [] },
      dependencyGroups: [],
      gas,
      horizonSeconds: h,
      availabilityLagSeconds: AVAILABILITY_LAG_SECONDS,
    });

    /** Per-horizon calibration material, memoised: three horizons, 27 grid
     *  points each, and rebuilding the panel per point would be 27x the work
     *  for an identical answer. */
    const labelsByHorizon = new Map<number, CompletedLabel[]>();
    const horizonLabelsOf = (h: HorizonSeconds): CompletedLabel[] => {
      const hit = labelsByHorizon.get(h);
      if (hit !== undefined) return hit;
      const v = allLabels.filter((l) => l.horizonSeconds === h);
      labelsByHorizon.set(h, v);
      return v;
    };
    const panelByHorizon = new Map<number, ReturnType<typeof buildResidualPanel>>();
    const panelOf = (h: HorizonSeconds): ReturnType<typeof buildResidualPanel> => {
      if (panelByHorizon.has(h)) return panelByHorizon.get(h);
      const v = buildResidualPanel(horizonLabelsOf(h), minObservations);
      panelByHorizon.set(h, v);
      return v;
    };
    // P2's panel from MODEL residuals, expressed relative to the forecast.
    // Keyed by the GRID POINT, not the horizon: a model residual depends on
    // the model, so one panel per horizon would silently attribute one
    // candidate's errors to another. See `ResidualPanel.relative`.
    const relPanelByPoint = new Map<string, ReturnType<typeof buildRelativeResidualPanel>>();
    const relativePanelOf = (
      point: SweepRow['point'],
    ): ReturnType<typeof buildRelativeResidualPanel> => {
      const key = `${point.method}|${JSON.stringify(point.methodParams)}|${point.horizonSeconds}`;
      if (relPanelByPoint.has(key)) return relPanelByPoint.get(key);
      const observations: ResidualObservations = {};
      residualsFor(point, horizonLabelsOf(point.horizonSeconds as HorizonSeconds), minObservations, observations);
      const v = buildRelativeResidualPanel(observations, minObservations);
      relPanelByPoint.set(key, v);
      return v;
    };
    const cashByKey = new Map<string, Record<string, bigint>>();
    const cashQuantilesOf = (h: HorizonSeconds, coverage: number): Record<string, bigint> => {
      const key = `${h}:${coverage}`;
      const hit = cashByKey.get(key);
      if (hit !== undefined) return hit;
      const v = calibrateCashResidualQuantiles(horizonLabelsOf(h), coverage, minObservations);
      cashByKey.set(key, v);
      return v;
    };

    /**
     * The artifact JSON for ONE grid point at one `k`. One builder, so the
     * artifact a candidate is SCORED under and the artifact that is finally
     * WRITTEN cannot diverge in any field but the point and `k`.
     */
    const artifactJsonForRow = (row: SweepRow, k: number): Record<string, unknown> => {
      const h = row.point.horizonSeconds as HorizonSeconds;
      // Prefer the model-residual relative panel; fall back to the legacy
      // mean-residual absolute one only if the model path produced nothing.
      // ABSOLUTE panel: unchanged semantics, and the only one
      // `hurdles.ts#columnSigma` may read.
      const panel = panelOf(h);
      // RELATIVE model-residual panel: consumed only by the portfolio bound.
      const relPanel = relativePanelOf(row.point);
      // Portfolio scalar fallback: the most conservative solved per-venue
      // quantile. It governs only when no residual panel can be built, and
      // taking the most conservative rather than the mean keeps the fallback
      // on the safe side of the panel it substitutes for.
      const solved = Object.values(row.quantileWadByMarket);
      const portfolioFallback = solved.length > 0 ? solved.reduce((a, b) => (a < b ? a : b)) : 0n;
      return {
        policyVersion: 5,
        horizonSeconds: h,
        coverageTarget: row.point.coverageTarget,
        method: row.point.method === 'direct-arx' ? 'arx' : row.point.method,
        methodParams: row.point.methodParams,
        residualQuantileWadByMarket: Object.fromEntries(
          Object.entries(row.quantileWadByMarket).map(([m, v]) => [m, v.toString()]),
        ),
        // P1's RELATIVE form, solved from the same residuals as the absolute
        // map above. Emitted only when non-empty: an empty object would be
        // indistinguishable from "every venue calibrated to zero haircut",
        // and `lowerBoundAt` must fall back to the absolute map instead.
        ...(Object.keys(row.relativeQuantileWadByMarket ?? {}).length > 0
          ? {
              relativeResidualQuantileWadByMarket: Object.fromEntries(
                Object.entries(row.relativeQuantileWadByMarket).map(([m, v]) => [
                  m,
                  v.toString(),
                ]),
              ),
            }
          : {}),
        portfolioResidualQuantileWad: portfolioFallback.toString(),
        cashResidualQuantileWadByMarket: Object.fromEntries(
          Object.entries(cashQuantilesOf(h, row.point.coverageTarget)).map(([m, v]) => [
            m,
            v.toString(),
          ]),
        ),
        // The §7.2 relative cash bound's fallback, used only for a venue with
        // too few usable labels. Kept at the registered conservative default
        // rather than derived, because deriving it from venues that DID
        // calibrate would apply one venue's liquidity behaviour to another's.
        cashLowerBoundQuantileWad: '-100000000000000000',
        minObservations,
        availabilityLagSeconds: AVAILABILITY_LAG_SECONDS,
        noTradeBandK: k,
        paybackSeconds: PAYBACK_SECONDS,
        adjustmentRate: ADJUSTMENT_RATE,
        edgeWindowEffective: effectiveWindow(row.point, h),
        ...(panel !== undefined
          ? {
              residualPanel: {
                marketIds: panel.marketIds,
                originsSeconds: panel.originsSeconds,
                rows: panel.rows.map((r) => r.map((v) => v.toString())),
              },
            }
          : {}),
        ...(relPanel !== undefined
          ? {
              relativeResidualPanel: {
                marketIds: relPanel.marketIds,
                originsSeconds: relPanel.originsSeconds,
                rows: relPanel.rows.map((r) => r.map((v) => v.toString())),
                relative: true,
              },
            }
          : {}),
        pinnedConfigDigests,
        configDigest: 'registered-2026-09-08',
      };
    };

    // ---- P18: §7.3's two decision-focused loss terms.
    //
    // The five accuracy terms cannot see whether a candidate's forecast leaves
    // the movement rule able to act. v0.6's selection was decided on a 1.27e-7
    // margin in the residue of a `downsideRate` near 0.5, picked a 1-day
    // horizon, and the policy then executed ONE rebalance across an 86-day
    // era. These two terms are what make that visible, and they are measured
    // the only way they can be: by running `decide` -- the same function the
    // live service and the registered replay call -- over the calibration era
    // under each candidate's own artifact.
    const withdrawalSchedule = buildWithdrawalSchedule(dataset, SELECTION_TIER_BASE);
    const withdrawalObservations = withdrawalSchedule.requests
      .filter((r) => r.snapshotIndex < dataset.snapshots.length)
      .map((r) => ({
        timestampSeconds: Math.floor(
          dataset.snapshots[r.snapshotIndex]!.timestamp.getTime() / 1000,
        ),
        assetsBase: r.assetsBase,
      }));

    /** See SELECTION_TIER_BASE: one candidate-independent state, fully idle. */
    const selectionState: VaultState = {
      totalAssets: SELECTION_TIER_BASE,
      totalShares: SELECTION_TIER_BASE,
      idleBase: SELECTION_TIER_BASE,
      strategyBalances: new Map<string, bigint>(),
      cohorts: new Map(),
    };

    const buildSelectionOrigins = (h: HorizonSeconds): DecisionInput[] => {
      const labels = horizonLabelsOf(h);
      const config = harnessConfigFor(h);
      const out: DecisionInput[] = [];
      for (let i = 0; i < dataset.snapshots.length; i += subsample.everyNth) {
        const snap = dataset.snapshots[i]!;
        const originSeconds = Math.floor(snap.timestamp.getTime() / 1000);
        out.push(
          buildDecisionInput(
            selectionState,
            snap,
            labelsAvailableAt(labels, originSeconds),
            withdrawalObservations.filter((w) => w.timestampSeconds <= originSeconds),
            config,
            { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
          ),
        );
      }
      return out;
    };

    const selectionOpts = decideOptsForTier(
      DEFAULT_DECIDE_OPTS,
      SELECTION_TIER_BASE,
      SELECTION_QUANTUM_STEPS,
    );

    // Grouped BY HORIZON so only one horizon's origins are resident at a time:
    // each origin retains its visible-label slice, and three horizons' worth
    // at once is several hundred MB for no benefit.
    const byHorizon = new Map<number, SweepRow[]>();
    for (const r of rows) {
      const list = byHorizon.get(r.point.horizonSeconds) ?? [];
      list.push(r);
      byHorizon.set(r.point.horizonSeconds, list);
    }
    const decisionScores = new Map<GridPoint, DecisionScore>();
    console.log(
      `[freeze] P18 decision scoring: ${rows.length} candidates x every ${subsample.everyNth}th ` +
        `origin at ${SELECTION_QUANTUM_STEPS} allocation quanta...`,
    );
    const scoringStarted = Date.now();
    for (const [h, group] of [...byHorizon.entries()].sort((a, b) => a[0] - b[0])) {
      const horizonSeconds = h as HorizonSeconds;
      const origins = buildSelectionOrigins(horizonSeconds);
      for (const row of group) {
        const candidate = parseArtifact(artifactJsonForRow(row, 1.0), {
          requireProvisional: false,
        });
        decisionScores.set(
          row.point,
          scoreCandidateDecisions(origins, candidate, selectionOpts, { everyNth: 1 }),
        );
      }
      console.log(
        `[freeze]   H=${h / 86_400}d: ${group.length} candidates over ${origins.length} origins ` +
          `(${((Date.now() - scoringStarted) / 1000).toFixed(0)}s elapsed)`,
      );
    }

    // ---- Rank on all seven terms, standardized on the grid's own spread.
    //
    // §7.3's seventh term is GRID-RELATIVE: the shortfall of a candidate's
    // realised net return against the best any candidate on this grid
    // achieved. See `decision-score.ts#sacrificedReturn` for why the
    // edge-on-blocked-legs definition it replaces could not see the failure
    // it exists to detect.
    const gridBestNetReturn = bestNetReturn([...decisionScores.values()]);
    console.log(
      `[freeze] best realised net return on the grid: ` +
        `${(gridBestNetReturn * 100).toFixed(4)}% (the sacrificed-return reference)`,
    );
    const scored: ScoredPoint[] = scoreGrid(
      rows.map((row) => {
        const s = decisionScores.get(row.point)!;
        return {
          point: row.point,
          fit: attachDecisionTerms(row, {
            turnover: s.turnover,
            sacrificedReturn: sacrificedReturn(s, gridBestNetReturn),
          }),
        };
      }),
      { minIqr: MIN_DISCRIMINATING_IQR },
    );

    const winner = resolveNearTie(scored);
    const rowOf = (sp: ScoredPoint): SweepRow => {
      const hit = rows.find((r) => r.point === sp.point);
      if (hit === undefined) throw new Error('scoreGrid returned a point that was never swept');
      return { ...hit, loss: sp.fit.loss };
    };
    const runnerUpScored = scored[0] === winner ? scored[1] : scored[0];
    const selectionMargin =
      scored.length < 2 ? Number.POSITIVE_INFINITY : scored[1]!.total - scored[0]!.total;
    const nearTie = selectionMargin < MIN_SELECTION_MARGIN;
    const tieResolution = nearTieResolution(scored);

    const describe = (r: SweepRow): string =>
      `${r.point.method}(${JSON.stringify(r.point.methodParams)}) ` +
      `H=${r.point.horizonSeconds / 86_400}d cov=${r.point.coverageTarget}`;

    const chosen = {
      row: rowOf(winner),
      runnerUp: runnerUpScored === undefined ? null : rowOf(runnerUpScored),
      margin: selectionMargin,
      reason:
        `selected ${describe(rowOf(winner))} at normalized total ` +
        `${winner.total.toFixed(8)} (achieved coverage ` +
        `${(winner.fit.loss.achievedCoverage * 100).toFixed(2)}% on ` +
        `${winner.fit.loss.observations} residuals)` +
        (runnerUpScored === undefined
          ? '; no runner-up, the grid produced one scorable point'
          : `; runner-up ${describe(rowOf(runnerUpScored))} at ` +
            `${runnerUpScored.total.toFixed(8)}, margin ${selectionMargin.toExponential(3)}` +
            (nearTie
              ? ` — INSIDE ${MIN_SELECTION_MARGIN.toExponential(0)}, resolved by ` +
                (tieResolution === 'indistinguishable'
                  ? 'NOTHING: total, economics and horizon all tied, so this is sort order ' +
                    'and the loss does not support the choice'
                  : `resolveNearTie on ${tieResolution}`)
              : '')) +
        (winner.zeroWeighted.length > 0
          ? `; ZERO-WEIGHTED (IQR < ${MIN_DISCRIMINATING_IQR}): ${winner.zeroWeighted.join(', ')}`
          : '; every term discriminated'),
    };

    console.log(`[freeze] ${chosen.reason}`);
    console.log('[freeze] per-term interquartile range across the grid:');
    for (const term of [
      'pointError',
      'coverageDeviation',
      'exceedanceShortfall',
      'sharpness',
      'downsideRate',
      'turnover',
      'sacrificedReturn',
    ] as const) {
      const xs = scored.map((sp) => (sp.fit.loss as unknown as Record<string, number>)[term] ?? 0);
      const iqr = interquartileRange(xs);
      const status = winner.constantTerms.includes(term)
        ? 'CONSTANT (z=0 at every point, contributes nothing)'
        : iqr < MIN_DISCRIMINATING_IQR
          ? 'ZERO-WEIGHTED'
          : 'weighted';
      console.log(`    ${term.padEnd(20)} IQR=${iqr.toExponential(4)} ${status}`);
    }
    console.log('[freeze] top 5 by normalized total (all seven terms):');
    for (const sp of scored.slice(0, 5)) {
      const s = decisionScores.get(sp.point)!;
      console.log(
        `    total=${sp.total.toFixed(8)}  ${sp.point.method.padEnd(12)} ` +
          `${JSON.stringify(sp.point.methodParams).padEnd(26)} ` +
          `H=${sp.point.horizonSeconds / 86_400}d cov=${sp.point.coverageTarget} ` +
          `turnover=${s.turnover.toFixed(4)} netApy=${(s.realizedNetReturn * 100).toFixed(4)}% ` +
          `sacrificed=${sacrificedReturn(s, gridBestNetReturn).toExponential(3)} ` +
          `foregoneEdge=${s.foregoneEdge.toExponential(3)} ` +
          `rebalances=${s.rebalances}/${s.originsScored}`,
      );
    }

    // The accuracy-only ranking, kept as a DIAGNOSTIC: it is what v0.6
    // selected on, so the report can say whether the economic terms changed
    // the answer.
    const accuracyOnly = selectPoint(rows);
    console.log(`[freeze] accuracy-only (5-term) ranking would have picked: ${accuracyOnly.reason}`);

    // ---- The whole scored grid, dumped beside the artifact.
    //
    // The decision scoring is the expensive half of this script (see the
    // header's runtime note), and every question about the RANKING -- what a
    // different `minIqr` would have zero-weighted, whether a term sits near
    // the threshold, what the runner-up looked like on the economic terms --
    // is answerable from the scored terms alone. Persisting them means such a
    // question costs a `jq`, not another sweep. Ruling R20 asked exactly this
    // question of the 1e-4 threshold and it took an 80-minute run to answer.
    const gridPath = `${outPath.replace(/\.json$/, '')}.grid.json`;
    writeFileSync(
      gridPath,
      JSON.stringify(
        {
          era: { start: bounds.start, end: bounds.end, days: bounds.days },
          selectionSubsample: subsample.everyNth,
          selectionSubsampleRegistered: subsample.registered,
          selectionQuantumSteps: SELECTION_QUANTUM_STEPS,
          selectionTierBase: SELECTION_TIER_BASE.toString(),
          gridBestNetReturn,
          minDiscriminatingIqr: MIN_DISCRIMINATING_IQR,
          minSelectionMargin: MIN_SELECTION_MARGIN,
          zeroWeighted: winner.zeroWeighted,
          constantTerms: winner.constantTerms,
          points: scored.map((sp) => ({
            point: sp.point,
            total: sp.total,
            loss: sp.fit.loss,
            normalized: sp.normalized,
            decisionScore: decisionScores.get(sp.point) ?? null,
            coverageByMarket: sp.fit.coverageByMarket,
          })),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`[freeze] wrote the full scored grid to ${gridPath}`);

    console.log('[freeze] per-venue achieved coverage at the selected point (P1):');
    for (const [marketId, c] of Object.entries(chosen.row.coverageByMarket).sort()) {
      console.log(
        `    ${marketId.padEnd(18)} ${(c * 100).toFixed(2)}%  ` +
          `q=${chosen.row.quantileWadByMarket[marketId]!.toString()}`,
      );
    }

    // The horizon the selected point registers is the one every downstream
    // quantity must be computed on.
    const horizon = chosen.row.point.horizonSeconds as HorizonSeconds;
    const cashQuantiles = cashQuantilesOf(horizon, chosen.row.point.coverageTarget);
    console.log(`[freeze] §7.2 cash bound calibrated for ${Object.keys(cashQuantiles).length} venues`);
    const panel = panelOf(horizon);
    console.log(
      `[freeze] P2 residual panel: ${panel === undefined ? 'NOT BUILT (insufficient aligned history)' : 'built'}`,
    );

    // P8's k, scored by RUNNING THE POLICY on the calibration era.
    //
    // The artifact this replaces said k=1.0 "carries no such registration and
    // was never swept", and that calibrating it needs a turnover-vs-return
    // sweep over a real collected dataset. This is that sweep: SRCLA at one
    // tier, once per candidate, through the same replay the registered run
    // uses. Everything it reads is calibration-era.
    const artifactJsonFor = (k: number): Record<string, unknown> =>
      artifactJsonForRow(chosen.row, k);

    const kBaseArtifact: PolicyArtifact = parseArtifact(artifactJsonFor(1.0), { requireProvisional: false });
    const kConfig: HarnessConfig = harnessConfigFor(horizon);

    // OPT-IN: six full replays of the calibration era is roughly an hour, and
    // a scalar that the report is willing to call UNRESOLVED does not belong
    // on the critical path of every re-freeze.
    const kOutcome = shouldSweepK
      ? (console.log('[freeze] P8 noTradeBandK sweep (SRCLA through the real replay):'),
        sweepNoTradeBandK(dataset, kBaseArtifact, kConfig))
      : {
          rows: [],
          resolved: false,
          selected: 1.0,
          reason:
            'NOT SWEPT (--sweep-k not given). k stays at the registered default 1.0 and every ' +
            'P8 result is provisional. This is a refusal to claim, not a guess: the sweep that ' +
            'would register it runs SRCLA through six full replays of the calibration era.',
        };
    const kSweep = kOutcome.rows;
    const kResolved = kOutcome.resolved;
    const selectedK = kOutcome.selected;
    console.log(
      kResolved
        ? `[freeze] k RESOLVED: ${kOutcome.reason}`
        : `[freeze] k UNRESOLVED: ${kOutcome.reason}`,
    );

    const artifact = {
      ...artifactJsonFor(selectedK),

      // ---- Registration record. Not read by parseArtifact; present so the
      // artifact testifies to how it was produced.
      _registration: {
        calibrationEra: { start: bounds.start, end: bounds.end, days: bounds.days },
        calibrationOrigins: dataset.snapshots.length,
        labelsSwept: allLabels.length,
        gridPoints: grid.length,
        scorablePoints: rows.length,
        selection: chosen.reason,
        selectionMargin: Number.isFinite(chosen.margin) ? chosen.margin : null,
        // P18 — how the two decision-focused terms were measured. The stride
        // and the allocation quantum are part of the registration because
        // they are what makes the ranking affordable; see SELECTION_SUBSAMPLE
        // and SELECTION_QUANTUM_STEPS.
        selectionSubsample: subsample.everyNth,
        selectionSubsampleRegistered: subsample.registered,
        selectionQuantumSteps: SELECTION_QUANTUM_STEPS,
        selectionTierBase: SELECTION_TIER_BASE.toString(),
        selectionOriginsScored: decisionScores.get(chosen.row.point)?.originsScored ?? null,
        selectionNearTieResolved: nearTie,
        selectionResolvedBy: tieResolution,
        selectionZeroWeightedTerms: winner.zeroWeighted,
        // §7.3's "reported as a diagnostic and given zero weight" clause. At
        // MIN_DISCRIMINATING_IQR = 0 the zero-weighting is implicit (a
        // constant term z-scores to 0 at every point), so the REPORT is what
        // this field preserves. See ScoredPoint#constantTerms.
        selectionConstantTerms: winner.constantTerms,
        selectionTermIqr: Object.fromEntries(
          (
            [
              'pointError',
              'coverageDeviation',
              'exceedanceShortfall',
              'sharpness',
              'downsideRate',
              'turnover',
              'sacrificedReturn',
            ] as const
          ).map((term) => [
            term,
            interquartileRange(
              scored.map((sp) => (sp.fit.loss as unknown as Record<string, number>)[term] ?? 0),
            ),
          ]),
        ),
        selectionMinDiscriminatingIqr: MIN_DISCRIMINATING_IQR,
        selectionMinMargin: MIN_SELECTION_MARGIN,
        // I3 — process disclosure, not just conclusion. The IQR threshold was
        // 1e-4 when this sweep was first run, and was changed AFTER both that
        // run's winner and the corrected run's winner were visible. The
        // calibration era is not sealed, so that is permitted; recording it is
        // what keeps it from reading as an a-priori choice. The substantive
        // effect of the change is that it admits `coverageDeviation`, whose
        // weight of 10.0 then dominates the winning candidate's total.
        selectionThresholdChangedWithOutcomesVisible: true,
        selectionThresholdNote:
          'MIN_DISCRIMINATING_IQR was moved from 1e-4 to 0 after two full sweeps of this ' +
          'grid had been observed. At 1e-4 the gate zero-weighted pointError (IQR 7.64e-5), ' +
          'coverageDeviation (3.54e-5, weight 10.0) and exceedanceShortfall (2.34e-6, ' +
          'weight 5.0) while keeping sharpness (1.72e-4, weight 0.5) — a separation by raw ' +
          'units, not by discrimination. At 0 the gate labels only terms scoreGrid has ' +
          'already neutralised via its sd||1 fallback. Admitting coverageDeviation is what ' +
          'moved the winner.',
        // §7.3's seventh term is measured against the best realised net return
        // any candidate on THIS grid achieved; see decision-score.ts.
        sacrificedReturnReference: 'grid-best realised net return',
        gridBestNetReturn,
        accuracyOnlySelection: accuracyOnly.reason,
        decisionScore: decisionScores.get(chosen.row.point) ?? null,
        // §7.3's third named quantity — "the return foregone by every hurdle
        // rejection" — reported for every candidate. It is NOT the seventh
        // loss term (see decision-score.ts#sacrificedReturn for why a
        // leg-level statistic cannot see non-trading upstream of the cost
        // gate), but the paper asks for it to be scored, so it is scored.
        foregoneEdgeByPoint: Object.fromEntries(
          scored.map((sp) => [
            `${sp.point.method}|${JSON.stringify(sp.point.methodParams)}|` +
              `${sp.point.horizonSeconds}|${sp.point.coverageTarget}`,
            decisionScores.get(sp.point)?.foregoneEdge ?? null,
          ]),
        ),
        loss: chosen.row.loss,
        coverageByMarket: chosen.row.coverageByMarket,
        noTradeBandKSweep: kSweep,
        noTradeBandKResolved: kResolved,
        residualPanelBuilt: panel !== undefined,
        sealedErasNotRead: Object.values(REGISTERED_ERAS)
          .filter((e) => e.sealed)
          .map((e) => e.tag),
        burnedWindowExcluded: eraBounds('burned'),
        note:
          'Fit on the calibration era ONLY. No sealed era was read. The burned window ' +
          '(paper §4.1 design data) is excluded from this fit and from every held-out era; ' +
          'see src/evaluation/eras.ts for the two disclosed deviations.',
      },
    };

    writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');
    console.log('');
    console.log(`[freeze] wrote ${outPath}`);
    console.log(
      `[freeze] method=${chosen.row.point.method} horizon=${horizon / 86_400}d ` +
        `coverage=${chosen.row.point.coverageTarget} k=${selectedK}` +
        `${kResolved ? '' : ' (UNRESOLVED — every P8 result is provisional)'}`,
    );
    console.log('[freeze] NO _provisional field: this artifact is citable.');
    if (era.sealed) throw new Error('unreachable: the calibration era must not be sealed');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[freeze] FAILED:', err);
  process.exit(1);
});
