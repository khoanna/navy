/**
 * Capacity frontier — where does SRCLA stop working?
 *
 * The registered tiers jump 1M -> 10M, and the controller's behaviour changes
 * completely across that gap (capital at work 0.913 -> 0.427). This locates
 * the threshold by sweeping intermediate vault sizes.
 *
 * Runs on `burned` — §4.1 DESIGN data, in neither the calibration nor a sealed
 * era — so no sealed era is read and no held-out result informs anything.
 */
import { PrismaClient } from '@prisma/client';
import { loadEra, loadWarmup } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { runRegisteredEvaluation } from '../src/evaluation/kernel/harness.js';
import type { HarnessConfig } from '../src/evaluation/kernel/decision-input.js';

const TIERS = [
  500_000n, 1_000_000n, 2_000_000n, 3_000_000n,
  5_000_000n, 7_000_000n, 10_000_000n,
].map((t) => t * 1_000_000n);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const art = loadRegisteredArtifact('config/registered-artifact.json');
    const ds = await loadEra(prisma, 'burned', 'a capacity-frontier probe');
    const gas = await loadGasSeries(
      prisma, ds.snapshots[0]!.timestamp, ds.snapshots[ds.snapshots.length - 1]!.timestamp,
    );
    const warmup = await loadWarmup(prisma, 'burned', Math.ceil(art.horizonSeconds / 86_400) + 30);

    // Worst-case total withdrawable cash across the venue universe: the
    // quantity a vault's size must be judged against.
    let worst = Number.POSITIVE_INFINITY;
    for (const o of ds.snapshots) {
      const cash = o.snapshots.reduce((s, m) => s + Number(m.maxWithdrawableBase), 0);
      if (cash < worst) worst = cash;
    }
    console.log(`era=burned origins=${ds.snapshots.length}  worst-case venue universe cash = $${(worst / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}\n`);

    const config: HarnessConfig = {
      vault: { adminReserveBase: 0n, minIdleBps: 500, configurationDigest: '0x' + '00'.repeat(32) },
      markets: {},
      defaultMarket: { capBps: 5_000, absoluteCapBase: 10n ** 15n, maxLossBps: 50, dependencyGroupIds: [] },
      dependencyGroups: [],
      gas,
      horizonSeconds: art.horizonSeconds,
      availabilityLagSeconds: art.availabilityLagSeconds,
    };

    console.log(`${'vault size'.padStart(12)} ${'vault/universe'.padStart(14)} ${'capWork'.padStart(8)} ${'net APY'.padStart(8)} ${'minCov'.padStart(7)} ${'APY/deployed $'.padStart(14)}`);
    for (const tier of TIERS) {
      const out = runRegisteredEvaluation({
        dataset: ds, config, artifact: art, tiers: [tier], policyIds: ['srcla'],
        decideOpts: DEFAULT_DECIDE_OPTS, calibrationFraction: 0.7, warmupSnapshots: warmup,
      });
      const r = out.results[0]!;
      const cw = r.replay.capitalAtWorkFraction;
      console.log(
        `${('$' + (Number(tier) / 1e6).toLocaleString('en-US')).padStart(12)} ` +
        `${(Number(tier) / worst).toFixed(2).padStart(13)}x ${cw.toFixed(3).padStart(8)} ` +
        `${(r.replay.realizedNetApy * 100).toFixed(3).padStart(7)}% ${r.replay.coverageDistribution.min.toFixed(3).padStart(7)} ` +
        `${(cw > 0 ? (r.replay.realizedNetApy / cw) * 100 : 0).toFixed(3).padStart(13)}%`,
      );
    }
  } finally { await prisma.$disconnect(); }
}
void main();
