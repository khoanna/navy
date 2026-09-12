/**
 * Diagnostic — NOT part of the registered evaluation, and it reads NO sealed era.
 *
 * §11.5's Kupiec test rejected the registered per-venue quantile on every
 * venue on both held-out eras, in BOTH directions: 0.00% breaches against
 * 1.00% expected on aave/compound, 7.55% on moonwell. The proposed amendment
 * is to condition the quantile on the venue's utilization at the origin.
 *
 * This asks whether that amendment actually improves out-of-sample coverage,
 * using a walk-forward split INSIDE the calibration era: fit on the first 70%
 * of origins, test Kupiec on the last 30%. If banding does not help here it
 * will not help on a held-out era either, and the amendment is not worth
 * opening another era for.
 */
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { deriveCompletedLabels } from '../src/evaluation/kernel/decision-input.js';
import { residualsFor, type ResidualObservations } from '../src/forecast/grid-sweep.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';

const BANDS: [number, number][] = [[0, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 2]];
const bandOf = (u: number): number => BANDS.findIndex(([lo, hi]) => u >= lo && u < hi);

/** Same estimator the artifact uses: the empirical (1-coverage) lower quantile. */
function lowerQuantile(xs: bigint[], coverage: number): bigint {
  if (xs.length === 0) return 0n;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const i = Math.min(s.length - 1, Math.floor((1 - coverage) * s.length));
  const q = s[Math.max(0, i)]!;
  return q > 0n ? 0n : q;
}

/** Kupiec unconditional-coverage LR, as the gate computes it. */
function kupiecLR(x: number, n: number, p: number): number {
  if (n === 0) return NaN;
  const pi = x / n;
  if (x === 0) return -2 * (n * Math.log(1 - p));
  if (x === n) return -2 * (n * Math.log(p));
  const ll0 = x * Math.log(p) + (n - x) * Math.log(1 - p);
  const ll1 = x * Math.log(pi) + (n - x) * Math.log(1 - pi);
  return -2 * (ll0 - ll1);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const art = loadRegisteredArtifact('config/registered-artifact.json');
    const cov = art.coverageTarget;
    const expected = 1 - cov;
    const ds = await loadEra(prisma, 'calibration', 'a banded-quantile diagnostic');
    const labels = deriveCompletedLabels(ds.snapshots, art.horizonSeconds, art.availabilityLagSeconds);
    const collected: ResidualObservations = {};
    residualsFor(
      { method: art.method, methodParams: art.methodParams, horizonSeconds: art.horizonSeconds, coverageTarget: cov } as never,
      labels as never,
      art.minObservations,
      collected,
    );

    console.log(`method=${art.method} H=${art.horizonSeconds / 86400}d coverage=${cov} (expected breach ${(expected * 100).toFixed(2)}%)`);
    console.log(`walk-forward: fit on the first 70% of calibration origins, test on the last 30%\n`);
    console.log(
      `${'venue'.padEnd(18)} ${'n_test'.padStart(7)} ${'POOLED'.padStart(14)} ${'LR'.padStart(8)} ` +
        `${'BANDED'.padStart(14)} ${'LR'.padStart(8)} ${'ROLL-1000'.padStart(14)} ${'LR'.padStart(8)} ` +
        `${'ROLL-3000'.padStart(14)} ${'LR'.padStart(8)}`,
    );

    for (const venue of Object.keys(collected).sort()) {
      const obs = collected[venue]!.filter((o) => o.utilizationWad !== undefined).slice().sort((a, b) => a.originSeconds - b.originSeconds);
      if (obs.length < 200) continue;
      const cut = Math.floor(obs.length * 0.7);
      const fit = obs.slice(0, cut);
      const test = obs.slice(cut);

      const pooledQ = lowerQuantile(fit.map((o) => o.residualWad), cov);
      const pooledBreaches = test.filter((o) => o.residualWad < pooledQ).length;

      const bandQ = BANDS.map((_, b) => {
        const inBand = fit.filter((o) => bandOf(Number(o.utilizationWad!) / 1e18) === b);
        // Thin band -> fall back to the POOLED quantile, never to a narrower one.
        return inBand.length >= 100 ? lowerQuantile(inBand.map((o) => o.residualWad), cov) : pooledQ;
      });
      const bandedBreaches = test.filter((o) => o.residualWad < bandQ[bandOf(Number(o.utilizationWad!) / 1e18)]!).length;

      // ROLLING: at each test origin, re-solve the quantile from the trailing
      // W observations ENDING BEFORE that origin. Uses only data available at
      // the origin, so it is not look-ahead; it registers an ESTIMATOR and a
      // window rather than a frozen scalar, which is what a non-stationary
      // residual distribution actually needs.
      const rollingBreaches = (W: number): number => {
        let breaches = 0;
        for (let i = 0; i < test.length; i++) {
          const hist = obs.slice(Math.max(0, cut + i - W), cut + i).map((o) => o.residualWad);
          if (hist.length < 200) continue;
          if (test[i]!.residualWad < lowerQuantile(hist, cov)) breaches += 1;
        }
        return breaches;
      };
      const r1 = rollingBreaches(1000), r2 = rollingBreaches(3000);
      const pr = pooledBreaches / test.length, br = bandedBreaches / test.length;
      console.log(
        `${venue.padEnd(18)} ${String(test.length).padStart(7)} ${(pr * 100).toFixed(2).padStart(13)}% ${kupiecLR(pooledBreaches, test.length, expected).toFixed(1).padStart(8)} ` +
          `${(br * 100).toFixed(2).padStart(13)}% ${kupiecLR(bandedBreaches, test.length, expected).toFixed(1).padStart(8)}` +
          `${((r1 / test.length) * 100).toFixed(2).padStart(13)}% ${kupiecLR(r1, test.length, expected).toFixed(1).padStart(8)}` +
          `${((r2 / test.length) * 100).toFixed(2).padStart(13)}% ${kupiecLR(r2, test.length, expected).toFixed(1).padStart(8)}`,
      );
    }
    console.log(`\n(LR below 3.84 = passes Kupiec at 5%.)`);
  } finally { await prisma.$disconnect(); }
}
void main();
