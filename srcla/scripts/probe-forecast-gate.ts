/** Diagnostic: does the forecast gate now SCORE the registered artifact? */
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { deriveCompletedLabels } from '../src/evaluation/kernel/decision-input.js';
import { alignedResiduals } from '../src/evaluation/kernel/forecast-gate.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const art = loadRegisteredArtifact('config/registered-artifact.json');
    const ds = await loadEra(prisma, 'calibration', 'a forecast-gate probe');
    const labels = deriveCompletedLabels(ds.snapshots, art.horizonSeconds, art.availabilityLagSeconds);
    const m = alignedResiduals(art.method, art.methodParams, labels, art.horizonSeconds, art.minObservations);
    console.log(`method=${art.method} -> ${m === null ? 'NULL (still NOT PRODUCED)' : `SCORED ${m.size} venues`}`);
    if (m !== null) {
      for (const [venue, rows] of [...m].sort()) {
        const q = art.residualQuantileWadByMarket[venue];
        const breaches = q === undefined ? NaN : rows.filter((r) => r.residualWad < q).length;
        console.log(`  ${venue.padEnd(20)} ${String(rows.length).padStart(6)} residuals  ` +
          `exceedance ${((breaches / rows.length) * 100).toFixed(2)}% (target ${((1 - art.coverageTarget) * 100).toFixed(0)}%)`);
      }
    }
  } finally { await prisma.$disconnect(); }
}
void main();
