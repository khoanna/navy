#!/usr/bin/env tsx
/**
 * P36's validation sweep: SRCLA before and after the relative hurdle bound, on
 * CALIBRATION-era data only, across the sixteen figure vault sizes.
 *
 * Calibration is the one era §2.2 lets a design decision be measured on, so
 * this sweep may inform P36 without spending a sealed era. It runs the same
 * `runRegisteredEvaluation` the registered run does, with the same frozen
 * artifact and `DEFAULT_DECIDE_OPTS`, over the LAST 90 days of the era on every
 * 3rd origin (the figure sweep's stride).
 *
 * The go/no-go criteria were fixed in
 * docs/superpowers/specs/2026-09-13-srcla-p36-hurdle-bound-design.md BEFORE
 * either run; `--compare` evaluates exactly those and nothing else.
 *
 * Usage (from srcla/):
 *   DATABASE_URL=... pnpm exec tsx scripts/sweep-hurdle-bound.ts --label before --policies srcla,h3d,b2
 *   DATABASE_URL=... pnpm exec tsx scripts/sweep-hurdle-bound.ts --label after --policies srcla,h3d
 *   pnpm exec tsx scripts/sweep-hurdle-bound.ts --compare evaluation-sweep-p36-before.json evaluation-sweep-p36-after.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { loadDataset } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { REGISTERED_ERAS } from '../src/evaluation/eras.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { runRegisteredEvaluation } from '../src/evaluation/kernel/harness.js';
import { FIGURE_TIERS } from '../src/evaluation/report/charts.js';
import { arg, harnessConfig } from './lib/sweep-harness.js';

const WINDOW_DAYS = 90;
const STRIDE = 3;
const CALIBRATION_FRACTION = 0.7;

interface SweepRow {
  policyId: string;
  tierUsd: number;
  capitalAtWork: number;
  netApy: number;
  minCoverage: number;
  p05Coverage: number;
  fullExitOrigins: number | null;
  rebalances: number;
  hurdleBlocks: Record<string, number>;
}

async function sweep(label: string, policyIds: string[]): Promise<void> {
  // Every module of the decision kernel is statically imported above, so by
  // this line the code under test is fixed for the life of the process.
  console.error(`[sweep ${label}] started — kernel modules loaded`);
  const artifact = loadRegisteredArtifact('config/registered-artifact.json');
  const cal = REGISTERED_ERAS.calibration;
  const end = new Date(cal.endSeconds * 1000);
  const start = new Date((cal.endSeconds - WINDOW_DAYS * 86_400 + 1) * 1000);
  const warmupDays = Math.ceil(artifact.horizonSeconds / 86_400) + 30;
  const warmupEnd = new Date(start.getTime() - 1000);
  const warmupStart = new Date(start.getTime() - warmupDays * 86_400_000);

  const prisma = new PrismaClient();
  try {
    const full = await loadDataset(prisma, `sweep-p36:calibration-last-${WINDOW_DAYS}d`, start, end);
    if (full.snapshots.length === 0) {
      throw new Error('calibration window holds no origins; run `pnpm backfill:history` first');
    }
    const dataset = { ...full, snapshots: full.snapshots.filter((_, i) => i % STRIDE === 0) };
    const warmup = (await loadDataset(prisma, 'sweep-p36:warmup', warmupStart, warmupEnd)).snapshots;
    const first = full.snapshots[0]!.timestamp;
    const last = full.snapshots[full.snapshots.length - 1]!.timestamp;
    const gas = await loadGasSeries(prisma, first, last);
    console.error(
      `[sweep ${label}] ${dataset.snapshots.length} origins (every ${STRIDE}rd of ${full.snapshots.length}, ` +
        `${first.toISOString()} -> ${last.toISOString()}), ${FIGURE_TIERS.length} sizes, policies ${policyIds.join(',')}`,
    );

    const evaluation = runRegisteredEvaluation({
      dataset,
      config: harnessConfig(gas, artifact),
      artifact,
      tiers: FIGURE_TIERS,
      policyIds,
      decideOpts: DEFAULT_DECIDE_OPTS,
      calibrationFraction: CALIBRATION_FRACTION,
      warmupSnapshots: warmup,
    });

    const rows: SweepRow[] = evaluation.results.map((r) => ({
      policyId: r.policy.id,
      tierUsd: Number(r.tier / 1_000_000n),
      capitalAtWork: r.replay.capitalAtWorkFraction,
      netApy: r.replay.realizedNetApy,
      minCoverage: r.replay.minStressedLiquidCoverage,
      p05Coverage: r.replay.coverageDistribution.p05,
      fullExitOrigins: r.replay.timeToFullExitOrigins,
      rebalances: r.rebalances,
      hurdleBlocks: r.replay.hurdleBlocks,
    }));
    const out = `evaluation-sweep-p36-${label}.json`;
    writeFileSync(
      out,
      JSON.stringify(
        { label, window: { start: first.toISOString(), end: last.toISOString() }, stride: STRIDE, rows },
        null,
        2,
      ) + '\n',
    );
    console.error(`[sweep ${label}] wrote ${out}`);
  } finally {
    await prisma.$disconnect();
  }
}

function compare(beforePath: string, afterPath: string): void {
  const load = (p: string): SweepRow[] => (JSON.parse(readFileSync(p, 'utf8')) as { rows: SweepRow[] }).rows;
  const key = (r: SweepRow): string => `${r.policyId}@${r.tierUsd}`;
  const beforeRows = load(beforePath);
  const before = new Map(beforeRows.map((r) => [key(r), r]));
  const afterRows = load(afterPath);
  const failures: string[] = [];
  const pct = (x: number): string => `${(x * 100).toFixed(3)}%`;

  console.log('srcla   tier(USD) | CaW before -> after | net APY before -> after | min cov before -> after | p05 cov after');
  for (const a of afterRows.filter((r) => r.policyId === 'srcla').sort((x, y) => x.tierUsd - y.tierUsd)) {
    const b = before.get(key(a));
    if (b === undefined) {
      failures.push(`no before row for srcla@${a.tierUsd}`);
      continue;
    }
    console.log(
      `${a.tierUsd.toString().padStart(18)} | ${b.capitalAtWork.toFixed(3)} -> ${a.capitalAtWork.toFixed(3)} | ` +
        `${pct(b.netApy)} -> ${pct(a.netApy)} | ${b.minCoverage.toFixed(3)} -> ${a.minCoverage.toFixed(3)} | ` +
        `${a.p05Coverage.toFixed(3)}`,
    );
    // Criterion 1: at >= $3M, capital at work and net APY do not fall.
    if (a.tierUsd >= 3_000_000 && (a.capitalAtWork < b.capitalAtWork - 1e-9 || a.netApy < b.netApy - 1e-9)) {
      failures.push(`C1 srcla@${a.tierUsd}: CaW ${b.capitalAtWork} -> ${a.capitalAtWork}, APY ${b.netApy} -> ${a.netApy}`);
    }
    // Criterion 2: coverage holds 0.95 where it held it, and drops <= 0.02 where it did not.
    const floor = b.minCoverage >= 0.95 ? 0.95 : b.minCoverage - 0.02;
    if (a.minCoverage < floor - 1e-9) {
      failures.push(`C2 srcla@${a.tierUsd}: min coverage ${b.minCoverage} -> ${a.minCoverage} (floor ${floor})`);
    }
    // Criterion 3: at <= $1M, net APY within +/-5 bps.
    if (a.tierUsd <= 1_000_000 && Math.abs(a.netApy - b.netApy) > 0.0005) {
      failures.push(`C3 srcla@${a.tierUsd}: APY ${b.netApy} -> ${a.netApy}`);
    }
  }

  console.log('\nreference rows (not criteria): h3d before/after, b2 before');
  for (const r of [...beforeRows, ...afterRows].filter((x) => x.policyId !== 'srcla')) {
    console.log(`  ${r.policyId}@${r.tierUsd}: CaW ${r.capitalAtWork.toFixed(3)} APY ${pct(r.netApy)} min cov ${r.minCoverage.toFixed(3)}`);
  }

  if (failures.length > 0) {
    console.log(`\nNO-GO — ${failures.length} criterion failure(s):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nGO — all three pre-registered criteria hold at every vault size.');
  }
}

async function main(): Promise<void> {
  const cmp = process.argv.indexOf('--compare');
  if (cmp >= 0) {
    compare(process.argv[cmp + 1]!, process.argv[cmp + 2]!);
    return;
  }
  const label = arg('label');
  if (label === undefined) throw new Error('--label <before|after> is required');
  const policies = (arg('policies') ?? 'srcla,h3d').split(',').map((p) => p.trim());
  await sweep(label, policies);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
