/**
 * Diagnostic — NOT part of the registered evaluation.
 *
 * §7.2's decision-time haircut is calibrated by `calibrateResidualQuantiles`,
 * which measures `realized - the venue's own mean realized return`. The grid
 * sweep that SELECTS the forecast method measures `realized - the model's
 * forecast` (`residualsFor`). This prints both, so the cost of the
 * inconsistency is a measured number rather than an argument.
 */
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { deriveCompletedLabels, calibrateResidualQuantiles } from '../src/evaluation/kernel/decision-input.js';
import { residualsFor } from '../src/forecast/grid-sweep.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';

const YEAR = 31_536_000;

function lowerQuantile(sample: bigint[], coverage: number): bigint {
  const s = [...sample].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const i = Math.min(s.length - 1, Math.floor((1 - coverage) * s.length));
  return s[Math.max(0, i)]!;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const art = loadRegisteredArtifact('config/registered-artifact.json');
    const ds = await loadEra(prisma, 'calibration', 'a residual diagnostic');
    const labels = deriveCompletedLabels(ds.snapshots, art.horizonSeconds, art.availabilityLagSeconds);
    const asApy = (q: bigint): string => `${((Number(q) / 1e18) * (YEAR / art.horizonSeconds) * 100).toFixed(3)}%`;

    const meanBased = calibrateResidualQuantiles(labels as never, art.coverageTarget, art.minObservations);
    const model = residualsFor(
      { method: art.method, methodParams: art.methodParams, horizonSeconds: art.horizonSeconds, coverageTarget: art.coverageTarget } as never,
      labels as never,
      art.minObservations,
    );

    console.log(`method=${art.method} params=${JSON.stringify(art.methodParams)} H=${art.horizonSeconds / 86400}d cov=${art.coverageTarget}`);
    console.log(`labels=${labels.length}\n`);
    console.log(
      `${'venue'.padEnd(20)} ${'MEAN-based (shipped)'.padStart(22)} ` +
        `${'MODEL-based'.padStart(14)} ${'n'.padStart(7)}  tighter by`,
    );
    for (const venue of Object.keys(meanBased).sort()) {
      const mq = meanBased[venue]!;
      const res = model[venue] ?? [];
      if (res.length === 0) { console.log(`${venue.padEnd(20)} ${asApy(mq).padStart(22)} ${'(none)'.padStart(14)}`); continue; }
      const modelQ = lowerQuantile(res, art.coverageTarget);
      const ratio = Number(mq) === 0 ? NaN : Number(modelQ) / Number(mq);
      console.log(
        `${venue.padEnd(20)} ${asApy(mq).padStart(22)} ${asApy(modelQ).padStart(14)} ${String(res.length).padStart(7)}  ${(1 / ratio).toFixed(2)}x`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
void main();
