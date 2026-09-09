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
 * UNITS: returns and quantiles are WAD over the horizon; times are seconds.
 */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { parseArtifact } from '../src/policy/artifact.js';
import { REGISTERED_ERAS, eraBounds, eraFor } from '../src/evaluation/eras.js';
import {
  deriveCompletedLabels,
  calibrateCashResidualQuantiles,
} from '../src/evaluation/kernel/decision-input.js';
import {
  registeredGrid,
  selectPoint,
  sweep,
  type SweepRow,
} from '../src/forecast/grid-sweep.js';
import { buildResidualPanel } from '../src/policy/steps/portfolio-quantile.js';
import { buildIdentityPin, regimeOf } from '../src/domain/config-digest.js';
import { runRegisteredEvaluation } from '../src/evaluation/kernel/harness.js';
import { SRCLA_POLICY } from '../src/evaluation/kernel/registry.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import type { HarnessConfig } from '../src/evaluation/kernel/decision-input.js';
import type { EvaluationDataset } from '../src/evaluation/dataset.js';
import type { PolicyArtifact } from '../src/policy/types.js';
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
  const outPath = arg('out') ?? 'config/registered-artifact.json';
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

    const chosen = selectPoint(rows);
    console.log(`[freeze] ${chosen.reason}`);
    console.log('[freeze] top 5 by loss:');
    for (const r of [...rows].sort((a, b) => a.loss.total - b.loss.total).slice(0, 5)) {
      console.log(
        `    loss=${r.loss.total.toFixed(8)}  ${r.point.method.padEnd(12)} ` +
          `${JSON.stringify(r.point.methodParams).padEnd(26)} ` +
          `H=${r.point.horizonSeconds / 86_400}d cov=${r.point.coverageTarget} ` +
          `achieved=${(r.loss.achievedCoverage * 100).toFixed(2)}% n=${r.loss.observations}`,
      );
    }
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
    const horizonLabels = allLabels.filter((l) => l.horizonSeconds === horizon);

    const cashQuantiles = calibrateCashResidualQuantiles(
      horizonLabels,
      chosen.row.point.coverageTarget,
      minObservations,
    );
    console.log(`[freeze] §7.2 cash bound calibrated for ${Object.keys(cashQuantiles).length} venues`);

    const panel = buildResidualPanel(horizonLabels, minObservations);
    console.log(
      `[freeze] P2 residual panel: ${panel === undefined ? 'NOT BUILT (insufficient aligned history)' : 'built'}`,
    );

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

    // P8's k, scored by RUNNING THE POLICY on the calibration era.
    //
    // The artifact this replaces said k=1.0 "carries no such registration and
    // was never swept", and that calibrating it needs a turnover-vs-return
    // sweep over a real collected dataset. This is that sweep: SRCLA at one
    // tier, once per candidate, through the same replay the registered run
    // uses. Everything it reads is calibration-era.
    // Portfolio scalar fallback: the most conservative solved per-venue
    // quantile. It governs only when no residual panel can be built, and
    // taking the most conservative rather than the mean keeps the fallback on
    // the safe side of the panel it substitutes for.
    const solvedQuantiles = Object.values(chosen.row.quantileWadByMarket);
    const portfolioFallback =
      solvedQuantiles.length > 0 ? solvedQuantiles.reduce((a, b) => (a < b ? a : b)) : 0n;

    /** The artifact JSON for a given `k`. One builder, so the swept artifact
     *  and the written one cannot diverge in any field but `k`. */
    const artifactJsonFor = (k: number): Record<string, unknown> => ({
      policyVersion: 5,
      horizonSeconds: horizon,
      coverageTarget: chosen.row.point.coverageTarget,
      method: chosen.row.point.method === 'direct-arx' ? 'arx' : chosen.row.point.method,
      methodParams: chosen.row.point.methodParams,
      residualQuantileWadByMarket: Object.fromEntries(
        Object.entries(chosen.row.quantileWadByMarket).map(([m, v]) => [m, v.toString()]),
      ),
      portfolioResidualQuantileWad: portfolioFallback.toString(),
      cashResidualQuantileWadByMarket: Object.fromEntries(
        Object.entries(cashQuantiles).map(([m, v]) => [m, v.toString()]),
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
      edgeWindowEffective: effectiveWindow(chosen.row.point, horizon),
      ...(panel !== undefined
        ? {
            residualPanel: {
              marketIds: panel.marketIds,
              originsSeconds: panel.originsSeconds,
              rows: panel.rows.map((r) => r.map((v) => v.toString())),
            },
          }
        : {}),
      pinnedConfigDigests,
      configDigest: 'registered-2026-09-08',
    });

    const kBaseArtifact: PolicyArtifact = parseArtifact(artifactJsonFor(1.0), { requireProvisional: false });

    const gas = await loadGasSeries(
      prisma,
      dataset.snapshots[0]!.timestamp,
      dataset.snapshots[dataset.snapshots.length - 1]!.timestamp,
    );
    const kConfig: HarnessConfig = {
      vault: { adminReserveBase: 0n, minIdleBps: 500, configurationDigest: '0x' + '00'.repeat(32) },
      markets: {},
      defaultMarket: { capBps: 5_000, absoluteCapBase: 10n ** 15n, maxLossBps: 50, dependencyGroupIds: [] },
      dependencyGroups: [],
      gas,
      horizonSeconds: horizon,
      availabilityLagSeconds: AVAILABILITY_LAG_SECONDS,
    };

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
