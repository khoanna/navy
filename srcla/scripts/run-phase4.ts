#!/usr/bin/env tsx
/**
 * Phase 4's registered run, end to end, in one process.
 *
 * Runs the §11 protocol over BOTH held-out eras against the frozen registered
 * artifact, gates each, and renders `SRCLA-REPORT.{md,json}` from
 * `src/evaluation/report/` — replacing the untracked `evaluation-v2/*.mjs`
 * harness that produced every earlier version of that file (defect V5).
 *
 * BOTH eras are reported, and the report says why:
 *   held-out A  267d, statistically powered, but PRECEDES the burned window,
 *               so it carries the disclosed design-knowledge caveat.
 *   held-out B  chronologically after everything including the burn, and
 *               therefore temporally clean, but short and low-powered.
 * Neither alone is sufficient evidence. Reporting only the flattering one
 * would be the choice this whole phase exists to make impossible.
 *
 * THIS IS THE MOMENT THE SEALED DATA IS OPENED. Everything that fits anything
 * must already be committed: a result that prompts a change to the artifact
 * or the grid is a NEW REGISTRATION ON A NEW ERA, not a retune. §11.5
 * requires publishing a negative result rather than tuning against held-out
 * data.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx scripts/run-phase4.ts \
 *     [--artifact config/registered-artifact.json] \
 *     [--tiers 10000,100000,1000000,10000000] \
 *     [--eras heldout-a,heldout-b] \
 *     [--out-dir .]
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD annualized.
 */
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { loadEra } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { REGISTERED_ERAS, eraBounds, type EraTag } from '../src/evaluation/eras.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import {
  runRegisteredEvaluation,
  REGISTERED_TIERS,
} from '../src/evaluation/kernel/harness.js';
import { NOT_OBSERVED, type HarnessConfig } from '../src/evaluation/kernel/decision-input.js';
import { buildRunRecord, manifestConfigForRun } from '../src/evaluation/kernel/provenance.js';
import { evaluateRegisteredRelease } from '../src/evaluation/kernel/gates.js';
import { generateManifest, signManifest } from '../src/evaluation/manifest/generator.js';
import { renderReport, type RunSummary } from '../src/evaluation/report/render-markdown.js';
import type { PolicyArtifact } from '../src/policy/types.js';

const MANIFEST_VERSION = '1.0.0';
const CALIBRATION_FRACTION = 0.7;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function codeCommit(): string {
  const fromEnv = process.env.GIT_COMMIT_HASH;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function harnessConfig(gas: HarnessConfig['gas'], artifact: PolicyArtifact): HarnessConfig {
  return {
    vault: {
      adminReserveBase: 0n,
      minIdleBps: 500,
      configurationDigest: '0x' + '00'.repeat(32),
    },
    markets: {},
    defaultMarket: {
      capBps: 5_000,
      absoluteCapBase: 10n ** 15n,
      maxLossBps: 50,
      dependencyGroupIds: [],
    },
    // EMPTY, deliberately: the collector emits no dependency-group data, so
    // H5 has nothing to remove and is reported INERT rather than given a
    // number it did not earn.
    dependencyGroups: [],
    gas,
    horizonSeconds: artifact.horizonSeconds,
    availabilityLagSeconds: artifact.availabilityLagSeconds,
  };
}

/** Everything the JSON sidecar records for one era. */
function serialisableRun(run: RunSummary): Record<string, unknown> {
  return {
    era: run.era,
    bounds: eraBounds(run.era),
    origins: run.datasetOrigins,
    provenance: run.provenance,
    artifactHash: run.evaluation.artifact.artifactHash,
    provisionalArtifact: run.evaluation.provisional,
    withdrawalSource: run.evaluation.withdrawalSource,
    missingTiers: run.evaluation.missingTiers.map((t) => t.toString()),
    missingPolicyIds: run.evaluation.missingPolicyIds,
    results: run.evaluation.results.map((r) => ({
      policyId: r.policy.id,
      paperSection: r.policy.section,
      deployable: r.policy.deployable,
      tier: r.tier.toString(),
      realizedNetApy: r.replay.realizedNetApy,
      totalCostsBase: r.replay.totalCosts.toString(),
      totalTurnoverBase: r.replay.totalTurnover.toString(),
      rebalances: r.rebalances,
      withdrawalsAttempted: r.replay.withdrawals.length,
      withdrawalSuccessRate: r.replay.withdrawalSuccessRate,
      minStressedLiquidCoverage: r.replay.minStressedLiquidCoverage,
      inertVsSrcla: r.inertVsSrcla,
    })),
    releaseGate: {
      pass: run.gate.pass,
      blockedReasons: run.gate.blockedReasons,
      checks: run.gate.checks,
      comparisons: run.gate.comparisons,
    },
  };
}

async function runEra(
  prisma: PrismaClient,
  era: EraTag,
  artifact: PolicyArtifact,
  tiers: readonly bigint[],
  commit: string,
): Promise<RunSummary> {
  const b = eraBounds(era);
  console.error('');
  console.error(`=== ERA ${era}: ${b.start} -> ${b.end} (${b.days}d) ===`);
  if (REGISTERED_ERAS[era].sealed) {
    console.error('    SEALED. This run OPENS it; nothing may be refit afterwards.');
  }

  const dataset = await loadEra(prisma, era, 'the registered §11 evaluation', {
    allowSealed: true,
  });
  if (dataset.snapshots.length === 0) {
    throw new Error(
      `era '${era}' holds no origins. Run \`pnpm backfill:history --era ${era}\` first; ` +
        `this script will not substitute synthetic data.`,
    );
  }
  const start = dataset.snapshots[0]!.timestamp;
  const end = dataset.snapshots[dataset.snapshots.length - 1]!.timestamp;
  console.error(`    ${dataset.snapshots.length} origins, ${start.toISOString()} -> ${end.toISOString()}`);

  const gas = await loadGasSeries(prisma, start, end);
  console.error(
    `    gas: ${gas.summary.observations} measured, L2 ${gas.summary.minL2BaseFeeWei}..` +
      `${gas.summary.maxL2BaseFeeWei} wei, ETH ${gas.summary.minEthUsdE8}..${gas.summary.maxEthUsdE8}, ` +
      `digest ${gas.digest}`,
  );

  const config = harnessConfig(gas, artifact);
  const evaluation = runRegisteredEvaluation({
    dataset,
    config,
    artifact,
    tiers,
    decideOpts: DEFAULT_DECIDE_OPTS,
    calibrationFraction: CALIBRATION_FRACTION,
  });

  const manifest = signManifest(
    generateManifest(
      manifestConfigForRun({
        version: MANIFEST_VERSION,
        dataset,
        tiers,
        artifact: evaluation.artifact,
        config,
        calibrationFraction: CALIBRATION_FRACTION,
        codeCommit: commit,
      }),
    ),
    { snapshots: dataset.snapshots, withdrawals: dataset.withdrawals ?? [] },
  );
  const record = buildRunRecord({ codeCommit: commit, manifest, evaluation });
  const gate = evaluateRegisteredRelease(evaluation);

  for (const c of gate.checks) {
    const mark = c.passed === true ? 'OK          ' : c.passed === false ? 'FAILED      ' : 'NOT PRODUCED';
    console.error(`    [${mark}] ${c.name}: ${c.detail.slice(0, 160)}`);
  }
  console.error(
    gate.pass
      ? `    §11.5 release gate PASSED for ${era}`
      : `    §11.5 release gate BLOCKED for ${era}: ${gate.blockedReasons.join(', ')}`,
  );

  return {
    era,
    evaluation,
    gate,
    datasetOrigins: dataset.snapshots.length,
    provenance: {
      codeCommit: record.codeCommit,
      manifestHash: manifest.contentHashes.manifest,
      datasetHash: manifest.contentHashes.dataset,
      resultHash: record.resultHash,
      gasSeriesDigest: gas.digest,
    },
  };
}

async function main(): Promise<void> {
  const artifactPath = arg('artifact') ?? 'config/registered-artifact.json';
  const outDir = arg('out-dir') ?? '.';
  const eras = (arg('eras') ?? 'heldout-a,heldout-b').split(',').map((e) => e.trim()) as EraTag[];
  const tiers = arg('tiers')
    ? arg('tiers')!.split(',').map((t) => BigInt(t.trim()) * 1_000_000n)
    : REGISTERED_TIERS;

  for (const e of eras) {
    if (!(e in REGISTERED_ERAS)) {
      throw new Error(`unknown era '${e}'; expected one of ${Object.keys(REGISTERED_ERAS).join(', ')}`);
    }
  }

  const artifact = loadRegisteredArtifact(artifactPath);
  const registration = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    _registration?: {
      calibrationEra: { start: string; end: string; days: number };
      coverageByMarket: Record<string, number>;
      noTradeBandKResolved: boolean;
    };
  };
  const reg = registration._registration;
  if (reg === undefined) {
    throw new Error(
      `${artifactPath} carries no _registration block. Produce it with ` +
        `scripts/freeze-artifact.ts rather than by hand: a report cannot describe how an ` +
        `artifact was fit if the artifact does not say.`,
    );
  }

  console.error(`[phase4] artifact ${artifact.artifactHash} (registered)`);
  console.error(
    `[phase4] method ${artifact.method}, horizon ${artifact.horizonSeconds / 86_400}d, ` +
      `coverage ${artifact.coverageTarget}, k ${artifact.noTradeBandK}` +
      `${reg.noTradeBandKResolved ? '' : ' (UNRESOLVED)'}`,
  );
  console.error(`[phase4] tiers ${tiers.map((t) => (t / 1_000_000n).toString()).join(', ')} USDC`);

  const prisma = new PrismaClient();
  try {
    const commit = codeCommit();
    const runs: RunSummary[] = [];
    for (const era of eras) {
      runs.push(await runEra(prisma, era, artifact, tiers, commit));
    }

    const markdown = renderReport({
      generatedAt: new Date().toISOString(),
      runs,
      notObserved: NOT_OBSERVED,
      artifactSummary: {
        hash: artifact.artifactHash,
        method: artifact.method,
        horizonDays: artifact.horizonSeconds / 86_400,
        coverageTarget: artifact.coverageTarget,
        noTradeBandK: artifact.noTradeBandK,
        noTradeBandKResolved: reg.noTradeBandKResolved,
        calibrationEra: reg.calibrationEra,
        perVenueCoverage: reg.coverageByMarket,
      },
    });

    const mdPath = join(outDir, 'SRCLA-REPORT.md');
    const jsonPath = join(outDir, 'SRCLA-REPORT.json');
    writeFileSync(mdPath, markdown);
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          codeCommit: commit,
          artifact: {
            hash: artifact.artifactHash,
            method: artifact.method,
            horizonSeconds: artifact.horizonSeconds,
            coverageTarget: artifact.coverageTarget,
            noTradeBandK: artifact.noTradeBandK,
            registration: reg,
          },
          notObserved: [...NOT_OBSERVED],
          runs: runs.map(serialisableRun),
        },
        null,
        2,
      ) + '\n',
    );

    console.error('');
    console.error(`[phase4] wrote ${mdPath} and ${jsonPath}`);
    for (const r of runs) {
      console.error(
        `[phase4] ${r.era}: ${r.gate.pass ? 'PASS' : 'FAIL'} — result hash ${r.provenance.resultHash}`,
      );
    }
    // A blocked gate is a failed run. Exiting 0 would let CI, and a reader,
    // treat "did not verify" as "verified".
    if (runs.some((r) => !r.gate.pass)) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[phase4] FAILED:', err);
  process.exit(1);
});
