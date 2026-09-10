/**
 * Throughput probe — NOT part of the registered evaluation.
 *
 * Answers one question: how many origin-decisions per second does the
 * registered kernel sustain on this machine? `pnpm phase4:run` prints nothing
 * between an era's warm-up line and its completion, so a run in flight offers
 * no way to estimate its own finish time. This measures the constant on a
 * SMALL slice of `burned` -- design data that lies in neither the calibration
 * nor a sealed era -- with one policy at one tier, then reports the rate.
 *
 * It opens nothing sealed and writes nothing.
 */
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { loadEra, loadWarmup } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { runRegisteredEvaluation, prepareArtifact, buildHindsightRates } from '../src/evaluation/kernel/harness.js';
import { deriveCompletedLabels } from '../src/evaluation/kernel/decision-input.js';
import type { HarnessConfig } from '../src/evaluation/kernel/decision-input.js';

const N = Number(process.argv[2] ?? 150);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const T = Date.now();
    const lap = (m: string): void => console.error(`[bench] ${m} +${((Date.now()-T)/1000).toFixed(1)}s`);
    const artifact = loadRegisteredArtifact(process.env['BENCH_ARTIFACT'] ?? 'config/registered-artifact.json');
    lap('artifact');
    const full = await loadEra(prisma, 'burned', 'a throughput probe');
    lap(`loadEra ${full.snapshots.length} origins`);
    const slice = full.snapshots.slice(0, N);
    const dataset = { ...full, snapshots: slice };
    const gas = await loadGasSeries(
      prisma,
      slice[0]!.timestamp,
      slice[slice.length - 1]!.timestamp,
    );
    const warmupDays = Math.ceil(artifact.horizonSeconds / 86_400) + 30;
    const warmup = await loadWarmup(prisma, 'burned', warmupDays);
    lap(`loadWarmup ${warmup.length}`);

    const config: HarnessConfig = {
      vault: { adminReserveBase: 0n, minIdleBps: 500, configurationDigest: '0x' + '00'.repeat(32) },
      markets: {},
      defaultMarket: {
        capBps: 5_000,
        absoluteCapBase: 10n ** 15n,
        maxLossBps: 50,
        dependencyGroupIds: [],
      },
      dependencyGroups: [],
      gas,
      horizonSeconds: artifact.horizonSeconds,
      availabilityLagSeconds: artifact.availabilityLagSeconds,
    };

    const labels = deriveCompletedLabels(
      [...warmup, ...slice],
      config.horizonSeconds,
      config.availabilityLagSeconds,
    );
    lap(`deriveCompletedLabels ${labels.length ?? 'n/a'}`);
    prepareArtifact(artifact, dataset, labels, 0.7);
    lap('prepareArtifact');
    buildHindsightRates(slice, config.horizonSeconds);
    lap('buildHindsightRates');

    const t0 = Date.now();
    const evaluation = runRegisteredEvaluation({
      dataset,
      config,
      artifact,
      tiers: [10_000_000_000n],
      policyIds: ['srcla'],
      decideOpts: DEFAULT_DECIDE_OPTS,
      calibrationFraction: 0.7,
      warmupSnapshots: warmup,
      quantumStepsPerTier: Number(process.argv[3] ?? 100),
    });
    lap('replay done');
    // Compare the DECISION-RELEVANT outputs only. A digest of the whole
    // result object is not comparable across processes -- it carries
    // measured timings -- and a difference in it would say nothing about
    // whether the policy decided differently.
    for (const r of evaluation.results) {
      const hashes = createHash('sha256').update(r.decisionHashes.join('|')).digest('hex');
      console.log(
        `[bench] ${r.policy.id} tier=${r.tier} rebalances=${r.rebalances} ` +
          `netApy=${r.replay.realizedNetApy} decisions=${r.decisionHashes.length}:${hashes.slice(0, 16)}`,
      );
      console.log(`[bench]   first3 ${r.decisionHashes.slice(0, 3).map((h) => h.slice(0, 12)).join(' ')}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
