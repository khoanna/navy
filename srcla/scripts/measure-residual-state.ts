/**
 * Diagnostic — NOT part of the registered evaluation.
 *
 * §7.2's haircut is ONE constant per venue. This asks whether the forecast
 * error it summarises is actually state-independent, by splitting the same
 * residuals two ways:
 *
 *   ABSOLUTE  q05 of (realized - forecast)          -- what ships today
 *   RELATIVE  q05 of (realized - forecast)/forecast -- a multiplicative model
 *
 * If ABSOLUTE varies strongly across utilization bands while RELATIVE is
 * roughly flat, the error is proportional to the level being forecast and a
 * constant absolute haircut is the wrong specification.
 */
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { deriveCompletedLabels } from '../src/evaluation/kernel/decision-input.js';
import { residualsFor, type ResidualObservations } from '../src/forecast/grid-sweep.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';

const WAD = 10n ** 18n;
const YEAR = 31_536_000;

const q05 = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.05 * s.length))]!;
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const art = loadRegisteredArtifact('config/registered-artifact.json');
    const ds = await loadEra(prisma, 'calibration', 'a residual-state diagnostic');
    const labels = deriveCompletedLabels(ds.snapshots, art.horizonSeconds, art.availabilityLagSeconds);
    const collect: ResidualObservations = {};
    residualsFor(
      { method: art.method, methodParams: art.methodParams, horizonSeconds: art.horizonSeconds, coverageTarget: art.coverageTarget } as never,
      labels as never,
      art.minObservations,
      collect,
    );
    const toApy = (wad: number): number => (wad / 1e18) * (YEAR / art.horizonSeconds) * 100;

    for (const venue of Object.keys(collect).sort()) {
      const obs = collect[venue]!;
      const known = obs.filter((o) => o.utilizationWad !== undefined);
      console.log(`\n=== ${venue}  (${obs.length} residuals, ${known.length} with utilization) ===`);
      console.log(`${'util band'.padEnd(12)} ${'n'.padStart(6)} ${'ABS q05 (APY)'.padStart(14)} ${'REL q05'.padStart(10)} ${'mean fcast APY'.padStart(15)}`);
      const bands: [number, number][] = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]];
      for (const [lo, hi] of bands) {
        const inBand = known.filter((o) => {
          const u = Number(o.utilizationWad!) / 1e18;
          return u >= lo && u < hi;
        });
        if (inBand.length < 50) continue;
        const abs = inBand.map((o) => Number(o.residualWad));
        const rel = inBand
          .filter((o) => o.forecastWad > 0n)
          .map((o) => Number((o.residualWad * WAD) / o.forecastWad) / 1e18);
        const mf = inBand.reduce((s, o) => s + Number(o.forecastWad), 0) / inBand.length;
        console.log(
          `${`${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`.padEnd(12)} ${String(inBand.length).padStart(6)} ` +
            `${toApy(q05(abs)).toFixed(3).padStart(13)}% ${q05(rel).toFixed(3).padStart(10)} ${toApy(mf).toFixed(3).padStart(14)}%`,
        );
      }
      const allAbs = obs.map((o) => Number(o.residualWad));
      console.log(`${'ALL (shipped)'.padEnd(12)} ${String(obs.length).padStart(6)} ${toApy(q05(allAbs)).toFixed(3).padStart(13)}%`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
void main();
