#!/usr/bin/env tsx
/**
 * P37 C6: SRCLA against B4, H1 and H7 over the FULL calibration era, at the
 * 10k / 100k / 1M tiers, to decide whether heldout-c's 1M gap to B4 exists on
 * data the design is allowed to use — and whether a single ablation explains it.
 *
 * The criterion is fixed in
 * docs/superpowers/specs/2026-09-13-srcla-p37-release-gates-design.md (C6)
 * and applied by `src/evaluation/calibration-gap.ts`; this script only
 * produces the numbers and hands them over.
 *
 * READ-ONLY against the database: it calls `loadEra` and `loadGasSeries`,
 * both `findMany`. It loads the calibration era through the sealing guard and
 * refuses any origin outside it.
 *
 * The runner is silent between tiers. Tell a working run from a hung one by
 * the node process's accumulated CPU TIME:
 *   ps -eo pid,etime,time,%cpu,args --sort=-%cpu | grep sweep-calibration-gap | grep -v grep | head -2
 *
 * Usage (from srcla/):
 *   DATABASE_URL=postgresql://user:password@localhost:5433/srcla pnpm exec tsx scripts/sweep-calibration-gap.ts --run
 *   pnpm exec tsx scripts/sweep-calibration-gap.ts --decide evaluation-sweep-c6-calibration.json --decision-out <path>
 *
 * --decision-out is REQUIRED with --decide (no default): the committed
 * evidence at config/c6-calibration-gap-decision.json is `--run`'s output,
 * and --decide must never overwrite it by accident.
 */
import { readFileSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { assertNotSealed } from '../src/evaluation/eras.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { runRegisteredEvaluation } from '../src/evaluation/kernel/harness.js';
import {
  C6_DECISION_TIER,
  C6_GAP_THRESHOLD_APY,
  C6_MAX_CAPITAL_AT_WORK_DRIFT,
  C6_MIN_GAP_CLOSED,
  C6_POLICY_IDS,
  C6_S2_FLOOR,
  C6_TIERS,
  assertCalibrationOnly,
  decideCalibrationGap,
  splitWarmup,
  timeAveragedVenueWeights,
  venueWeightsAt,
  type C6Row,
} from '../src/evaluation/calibration-gap.js';
import { arg, harnessConfig } from './lib/sweep-harness.js';

const PURPOSE = 'P37 C6 calibration-gap sweep';
const STRIDE = 3;
/** Inert for a registered artifact (`prepareArtifact` returns it untouched); kept for parity with the P36 sweep. */
const CALIBRATION_FRACTION = 0.7;
const SWEEP_OUT = 'evaluation-sweep-c6-calibration.json';
const DEFAULT_DECISION_OUT = 'config/c6-calibration-gap-decision.json';

interface SweepRowJson {
  policyId: string;
  /** USDC base units, as a string: JSON has no bigint. */
  tier: string;
  tierUsd: number;
  netApy: number;
  capitalAtWork: number;
  minStressedCoverage: number;
  p05Coverage: number;
  rebalances: number;
  meanVenueWeights: Record<string, number>;
  weightSeries: { t: string; w: Record<string, number> }[];
}

interface SweepJson {
  era: 'calibration';
  window: { start: string; end: string };
  stride: number;
  warmupDays: number;
  rows: SweepRowJson[];
}

const round4 = (w: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(w).map(([m, x]) => [m, Number(x.toFixed(4))]));

async function run(): Promise<void> {
  // Every kernel module is statically imported above, so the code under test
  // is fixed for the life of the process from this line on.
  console.error('[c6] started — kernel modules loaded');
  assertNotSealed('calibration', PURPOSE);
  const artifact = loadRegisteredArtifact('config/registered-artifact.json');
  const warmupDays = Math.ceil(artifact.horizonSeconds / 86_400) + 30;

  const prisma = new PrismaClient();
  try {
    const era = await loadEra(prisma, 'calibration', PURPOSE);
    assertCalibrationOnly(era.snapshots, 'loaded era');
    const { warmup, evaluated } = splitWarmup(era.snapshots, warmupDays);
    const dataset = { ...era, snapshots: evaluated.filter((_, i) => i % STRIDE === 0) };
    const first = evaluated[0]!.timestamp;
    const last = evaluated[evaluated.length - 1]!.timestamp;
    const gas = await loadGasSeries(prisma, first, last);
    console.error(
      `[c6] ${dataset.snapshots.length} origins (every ${STRIDE}rd of ${evaluated.length}, ` +
        `${first.toISOString()} -> ${last.toISOString()}), warm-up ${warmup.length} origins over ${warmupDays}d, ` +
        `tiers ${C6_TIERS.join(',')}, policies ${C6_POLICY_IDS.join(',')}`,
    );

    const rows: SweepRowJson[] = [];
    for (const tier of C6_TIERS) {
      const started = Date.now();
      const evaluation = runRegisteredEvaluation({
        dataset,
        config: harnessConfig(gas, artifact),
        artifact,
        tiers: [tier],
        policyIds: C6_POLICY_IDS,
        decideOpts: DEFAULT_DECIDE_OPTS,
        calibrationFraction: CALIBRATION_FRACTION,
        warmupSnapshots: warmup,
      });
      for (const r of evaluation.results) {
        rows.push({
          policyId: r.policy.id,
          tier: r.tier.toString(),
          tierUsd: Number(r.tier / 1_000_000n),
          netApy: r.replay.realizedNetApy,
          capitalAtWork: r.replay.capitalAtWorkFraction,
          minStressedCoverage: r.replay.minStressedLiquidCoverage,
          p05Coverage: r.replay.coverageDistribution.p05,
          rebalances: r.rebalances,
          meanVenueWeights: timeAveragedVenueWeights(r.replay.snapshots),
          weightSeries: r.replay.snapshots.map((s) => ({ t: s.timestamp.toISOString(), w: round4(venueWeightsAt(s)) })),
        });
      }
      console.error(`[c6] tier ${tier} done in ${Math.round((Date.now() - started) / 60_000)} min`);
    }

    const sweep: SweepJson = {
      era: 'calibration',
      window: { start: first.toISOString(), end: last.toISOString() },
      stride: STRIDE,
      warmupDays,
      rows,
    };
    writeFileSync(SWEEP_OUT, JSON.stringify(sweep, null, 2) + '\n');
    console.error(`[c6] wrote ${SWEEP_OUT}`);
  } finally {
    await prisma.$disconnect();
  }
  decide(SWEEP_OUT, arg('decision-out') ?? DEFAULT_DECISION_OUT);
}

function decide(sweepPath: string, decisionOut: string): void {
  const sweep = JSON.parse(readFileSync(sweepPath, 'utf8')) as SweepJson;
  const rows: C6Row[] = sweep.rows.map((r) => ({
    policyId: r.policyId,
    tier: BigInt(r.tier),
    netApy: r.netApy,
    capitalAtWork: r.capitalAtWork,
    minStressedCoverage: r.minStressedCoverage,
  }));
  const decision = decideCalibrationGap(rows);
  const pct = (x: number): string => `${(x * 100).toFixed(3)}%`;
  const bps = (x: number): string => `${(x * 10_000).toFixed(1)} bps`;

  console.log(`C6 calibration window ${sweep.window.start} -> ${sweep.window.end}`);
  console.log(`  at 1,000,000 USDC: SRCLA ${pct(decision.srclaNetApy)}, B4 ${pct(decision.b4NetApy)}, gap ${bps(decision.gapApy)} (threshold 21.5 bps)`);
  for (const a of decision.ablations) {
    console.log(
      `  ${a.policyId}: ${pct(a.netApy)}, closes ${(a.gapClosedFraction * 100).toFixed(1)}% of the gap, ` +
        `min stressed coverage ${a.minStressedCoverage.toFixed(4)}, capital-at-work drift ${a.capitalAtWorkDrift.toFixed(4)} — ` +
        (a.qualifies ? 'QUALIFIES' : `does not qualify: ${a.reasons.join('; ')}`),
    );
  }
  console.log(`OUTCOME: ${decision.outcome}`);

  const decisionTier = C6_DECISION_TIER.toString();
  writeFileSync(
    decisionOut,
    JSON.stringify(
      {
        criterion: {
          gapThresholdApy: C6_GAP_THRESHOLD_APY,
          decisionTier,
          minGapClosed: C6_MIN_GAP_CLOSED,
          s2Floor: C6_S2_FLOOR,
          maxCapitalAtWorkDrift: C6_MAX_CAPITAL_AT_WORK_DRIFT,
          spec: 'docs/superpowers/specs/2026-09-13-srcla-p37-release-gates-design.md#c6',
        },
        window: sweep.window,
        stride: sweep.stride,
        warmupDays: sweep.warmupDays,
        decision,
        meanVenueWeightsAt1M: Object.fromEntries(
          sweep.rows.filter((r) => r.tier === decisionTier).map((r) => [r.policyId, r.meanVenueWeights]),
        ),
        rows: sweep.rows.map((r) => ({
          policyId: r.policyId,
          tier: r.tier,
          tierUsd: r.tierUsd,
          netApy: r.netApy,
          capitalAtWork: r.capitalAtWork,
          minStressedCoverage: r.minStressedCoverage,
          p05Coverage: r.p05Coverage,
          rebalances: r.rebalances,
          meanVenueWeights: r.meanVenueWeights,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  console.error(`[c6] wrote ${decisionOut}`);
}

const USAGE = 'usage: --run | --decide <sweep.json> --decision-out <path>';

async function main(): Promise<void> {
  const d = process.argv.indexOf('--decide');
  if (d >= 0) {
    const sweepPath = process.argv[d + 1];
    if (sweepPath === undefined || sweepPath.startsWith('--')) {
      throw new Error(`${USAGE} — --decide requires a sweep JSON path`);
    }
    // --decide MUST NOT fall back to the committed evidence path: without an
    // explicit --decision-out it would silently overwrite
    // config/c6-calibration-gap-decision.json with whatever fixture the
    // caller happened to point --decide at.
    const decisionOut = arg('decision-out');
    if (decisionOut === undefined) {
      throw new Error(
        `${USAGE} — --decide requires an explicit --decision-out <path>; without it, it would ` +
          `silently overwrite the committed evidence at ${DEFAULT_DECISION_OUT}`,
      );
    }
    if (decisionOut.startsWith('--')) {
      throw new Error(`${USAGE} — --decision-out requires a path, not another flag`);
    }
    decide(sweepPath, decisionOut);
    return;
  }
  if (process.argv.includes('--run')) {
    await run();
    return;
  }
  throw new Error(USAGE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
