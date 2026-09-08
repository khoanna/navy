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
 *     [--out config/registered-artifact.json] [--min-observations 30]
 *
 * UNITS: returns and quantiles are WAD over the horizon; times are seconds.
 */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
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
import type { CompletedLabel } from '../src/policy/types.js';
import type { HorizonSeconds } from '../src/policy/registered.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** §7.3's availability lag: an outcome is usable only once it is readable. */
const AVAILABILITY_LAG_SECONDS = 900;

/**
 * P8's no-trade band multiplier, swept rather than asserted.
 *
 * `config/bootstrap-artifact.json` says outright that k=1.0 "carries no such
 * registration and was never swept", and that calibrating it needs a
 * turnover-vs-return sweep over a real collected dataset. This is that sweep.
 */
const K_CANDIDATES = [0, 0.25, 0.5, 1, 2, 4] as const;

/**
 * Score one `k` on the calibration era.
 *
 * A wider band suppresses churn and forfeits the return the suppressed moves
 * would have earned. The proxy scored here is the share of origins whose
 * forecast dispersion would have blocked a move at that `k`: the band is
 * `G_H > max(C_move, k * sigma)`, so a `k` that blocks nothing and a `k` that
 * blocks everything are both visible, and a flat sweep is visible as flat.
 */
function sweepNoTradeBandK(
  labels: readonly CompletedLabel[],
  quantileByMarket: Record<string, bigint>,
): Array<{ k: number; blockedShare: number; medianGapWad: string }> {
  const gaps: bigint[] = [];
  const byMarket = new Map<string, bigint[]>();
  for (const l of labels) {
    const list = byMarket.get(l.marketId) ?? [];
    list.push(l.realizedReturnWad);
    byMarket.set(l.marketId, list);
  }
  for (const [, series] of byMarket) {
    for (let i = 1; i < series.length; i++) {
      const d = series[i]! - series[i - 1]!;
      gaps.push(d < 0n ? -d : d);
    }
  }
  gaps.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : 0n;

  // sigma proxy: the mean magnitude of the solved per-venue quantiles, which
  // is the dispersion the band is scaled against in steps/cost.ts.
  const qs = Object.values(quantileByMarket).map((q) => (q < 0n ? -q : q));
  const sigma = qs.length > 0 ? qs.reduce((a, b) => a + b, 0n) / BigInt(qs.length) : 0n;

  return K_CANDIDATES.map((k) => {
    const threshold = (sigma * BigInt(Math.round(k * 1000))) / 1000n;
    const blocked = gaps.filter((g) => g <= threshold).length;
    return {
      k,
      blockedShare: gaps.length === 0 ? 0 : blocked / gaps.length,
      medianGapWad: median.toString(),
    };
  });
}

async function main(): Promise<void> {
  const outPath = arg('out') ?? 'config/registered-artifact.json';
  const minObservations = arg('min-observations') !== undefined ? Number(arg('min-observations')) : 30;

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

    const kSweep = sweepNoTradeBandK(horizonLabels, chosen.row.quantileWadByMarket);
    console.log('[freeze] P8 noTradeBandK sweep:');
    for (const r of kSweep) {
      console.log(`    k=${String(r.k).padEnd(5)} blocks ${(r.blockedShare * 100).toFixed(2)}% of moves`);
    }
    const spread = Math.max(...kSweep.map((r) => r.blockedShare)) - Math.min(...kSweep.map((r) => r.blockedShare));
    // A flat sweep is a RESULT, not a licence to pick a convenient value.
    const kResolved = spread > 0.02;
    const selectedK = kResolved
      ? kSweep.reduce((best, r) => (Math.abs(r.blockedShare - 0.25) < Math.abs(best.blockedShare - 0.25) ? r : best)).k
      : 1.0;
    console.log(
      kResolved
        ? `[freeze] k RESOLVED to ${selectedK} (sweep spread ${(spread * 100).toFixed(2)} pp)`
        : `[freeze] k UNRESOLVED: the sweep is flat (spread ${(spread * 100).toFixed(2)} pp < 2 pp). ` +
            `Keeping 1.0 and recording the table as evidence. A value chosen because it moves a ` +
            `gate is not a registration.`,
    );

    // Pinned configuration digests, from the calibration era's own regimes.
    const pinnedConfigDigests: Record<string, string> = {};
    for (const s of dataset.snapshots) {
      for (const m of s.snapshots) {
        if (pinnedConfigDigests[m.marketId] === undefined) {
          pinnedConfigDigests[m.marketId] = m.configDigest;
        }
      }
    }

    // Portfolio scalar fallback: the most conservative solved per-venue
    // quantile. It governs only when no residual panel can be built, and
    // taking the most conservative rather than the mean keeps the fallback on
    // the safe side of the panel it substitutes for.
    const solved = Object.values(chosen.row.quantileWadByMarket);
    const portfolioFallback = solved.length > 0 ? solved.reduce((a, b) => (a < b ? a : b)) : 0n;

    const artifact = {
      policyVersion: 5,
      horizonSeconds: horizon,
      coverageTarget: chosen.row.point.coverageTarget,
      method: chosen.row.point.method === 'direct-arx' ? 'arx' : chosen.row.point.method,
      methodParams: chosen.row.point.methodParams,
      residualQuantileWadByMarket: Object.fromEntries(
        Object.entries(chosen.row.quantileWadByMarket).map(([k, v]) => [k, v.toString()]),
      ),
      portfolioResidualQuantileWad: portfolioFallback.toString(),
      cashResidualQuantileWadByMarket: Object.fromEntries(
        Object.entries(cashQuantiles).map(([k, v]) => [k, v.toString()]),
      ),
      // The §7.2 relative cash bound's fallback, used only for a venue with
      // too few usable labels. Kept at the registered conservative default
      // rather than derived, because deriving it from venues that DID
      // calibrate would apply one venue's liquidity behaviour to another's.
      cashLowerBoundQuantileWad: '-100000000000000000',
      minObservations,
      availabilityLagSeconds: AVAILABILITY_LAG_SECONDS,
      noTradeBandK: selectedK,
      pinnedConfigDigests,
      configDigest: 'registered-2026-09-08',

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
    console.log(`[freeze] method=${artifact.method} horizon=${horizon / 86_400}d ` +
      `coverage=${artifact.coverageTarget} k=${selectedK}`);
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
