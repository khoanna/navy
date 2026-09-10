#!/usr/bin/env tsx
/**
 * The registered evaluation entry point (paper §11, Appendix C).
 *
 * Runs B0-B5, B2u, SRCLA and H1-H7 over a frozen dataset by calling
 * `src/policy/decide.ts` once per origin per policy, with a different
 * `PolicyAblations` setting per row. There is no second policy implementation
 * anywhere on this path.
 *
 * It FAILS rather than substituting anything. The script this replaces
 * (`scripts/quarantined/run-evaluation.ts`) silently swapped in a synthetic
 * manifest when the real one would not load, a fabricated 180-day
 * single-venue 5%-APY dataset when the database was unavailable, and
 * `Math.random()` noise for the realized returns the forecast gate is
 * calibrated against — so a run with Postgres down emitted a
 * complete-looking, non-reproducible report. None of those paths exist here.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/run-registered-evaluation.ts \
 *     --era heldout-c [--tiers 10000,100000] [--out file.json]
 *   DATABASE_URL=... tsx scripts/run-registered-evaluation.ts \
 *     --start 2026-06-01 --end 2026-08-23 ...
 *
 * `--era` is the registered form and the one a citable result must use: it
 * names a boundary fixed in `src/evaluation/eras.ts` before any fitting ran,
 * rather than a date range chosen after the fact. Running a SEALED era is the
 * moment the held-out data is legitimately opened -- everything that fits
 * anything must already be committed, because a result that prompts a change
 * to the artifact or the grid is a new registration on a new era, not a
 * retune.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD annualized.
 */
import { writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { loadDataset, loadEra } from '../src/evaluation/dataset.js';
import { REGISTERED_ERAS, eraBounds, type EraTag } from '../src/evaluation/eras.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { loadBootstrapArtifact, loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import {
  runRegisteredEvaluation,
  REGISTERED_TIERS,
  type RegisteredEvaluationResult,
} from '../src/evaluation/kernel/harness.js';
import type { HarnessConfig } from '../src/evaluation/kernel/decision-input.js';
import type { PolicyArtifact } from '../src/policy/types.js';
import { NOT_OBSERVED } from '../src/evaluation/kernel/decision-input.js';
import {
  buildRunRecord,
  manifestConfigForRun,
} from '../src/evaluation/kernel/provenance.js';
import { evaluateRegisteredRelease } from '../src/evaluation/kernel/gates.js';
import { generateManifest, signManifest } from '../src/evaluation/manifest/generator.js';

/** Schema version of the manifest this script emits. */
const MANIFEST_VERSION = '1.0.0';
/** Calibration split (§7.3's no-look-ahead boundary), shared with the manifest. */
const CALIBRATION_FRACTION = 0.7;

/**
 * `git rev-parse HEAD`, or the `GIT_COMMIT_HASH` override.
 *
 * THROWS rather than defaulting to 'unknown'. A result nobody can tie to a
 * revision is not reproducible, and `manifest/generator.ts` used to default
 * that field silently.
 */
function codeCommit(): string {
  const fromEnv = process.env.GIT_COMMIT_HASH;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (err) {
    throw new Error(
      'Cannot determine the code commit (git rev-parse HEAD failed). Set GIT_COMMIT_HASH. ' +
        `Underlying error: ${String(err)}`,
    );
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function required(name: string): string {
  const v = arg(name);
  if (v === undefined || v === '') {
    throw new Error(`--${name} is required. This script does not substitute a default window.`);
  }
  return v;
}

/**
 * The harness configuration.
 *
 * `gas` is now MEASURED: `loadGasSeries` reads `ChainCostSnapshot`, which the
 * archive backfill fills at every origin from the block header, the OP-Stack
 * GasPriceOracle and the two Chainlink feeds. It is passed in rather than
 * asserted here.
 *
 * The remaining fields ARE registered constants, because srcla persists no
 * dependency-group registry, no absolute caps and no protocol supply-cap
 * headroom. See the surviving entries in `NOT_OBSERVED`.
 */
function harnessConfig(gas: HarnessConfig['gas'], artifact: PolicyArtifact): HarnessConfig {
  return {
    vault: {
      adminReserveBase: 0n,
      // §8.1's admin floor: 5% of NAV, matching the vault's configured
      // minIdleBps in the deploy scripts.
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
    // H5 (remove shared-dependency caps) has nothing to remove and the
    // harness will report it INERT rather than emit a number for it.
    dependencyGroups: [],
    gas,
    // FROM THE ARTIFACT, not a constant. The harness derives its labels at
    // this horizon and the policy forecasts at `artifact.horizonSeconds`; if
    // the two disagree, every label the kernel trains on describes a
    // different horizon than the quantiles were solved for. The runner used
    // to hardcode 7 days while the registered grid may select 1, 7 or 14.
    horizonSeconds: artifact.horizonSeconds,
    availabilityLagSeconds: artifact.availabilityLagSeconds,
  };
}

function summarize(out: RegisteredEvaluationResult): Record<string, unknown> {
  return {
    provisionalArtifact: out.provisional,
    artifactHash: out.artifact.artifactHash,
    withdrawalSource: out.withdrawalSource,
    missingPolicyIds: out.missingPolicyIds,
    missingTiers: out.missingTiers.map((t) => t.toString()),
    notObserved: [...NOT_OBSERVED],
    results: out.results.map((r) => ({
      policyId: r.policy.id,
      paperSection: r.policy.section,
      paperDefinition: r.policy.paperDefinition,
      deployable: r.policy.deployable,
      disable: r.policy.disable,
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
  };
}

async function main(): Promise<void> {
  const eraArg = arg('era');
  if (eraArg !== undefined && !(eraArg in REGISTERED_ERAS)) {
    throw new Error(
      `--era must be one of ${Object.keys(REGISTERED_ERAS).join(', ')}, got '${eraArg}'`,
    );
  }
  const era = eraArg as EraTag | undefined;

  const startDate =
    era !== undefined
      ? new Date(REGISTERED_ERAS[era].startSeconds * 1000)
      : new Date(required('start'));
  const endDate =
    era !== undefined
      ? new Date(Math.min(REGISTERED_ERAS[era].endSeconds, Math.floor(Date.now() / 1000)) * 1000)
      : new Date(required('end'));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('--start and --end must be parseable dates');
  }
  if (era !== undefined) {
    const b = eraBounds(era);
    console.error(
      `[evaluation] era '${era}': ${b.start} -> ${b.end} (${b.days}d)` +
        (REGISTERED_ERAS[era].sealed
          ? ' — SEALED. This run OPENS it; nothing may be refit afterwards.'
          : ''),
    );
  }

  const tiers = arg('tiers')
    ? arg('tiers')!
        .split(',')
        .map((t) => BigInt(t.trim()) * 1_000_000n)
    : REGISTERED_TIERS;

  const prisma = new PrismaClient();
  try {
    // A sealed era is opened deliberately here, with the intent recorded at
    // the call site. Every other loader path refuses one.
    const dataset =
      era !== undefined
        ? await loadEra(prisma, era, 'the registered §11 evaluation', { allowSealed: true })
        : await loadDataset(prisma, arg('manifest') ?? 'registered', startDate, endDate);
    if (dataset.snapshots.length === 0) {
      // No synthetic fallback: an empty window is a failed run, not a run
      // over invented data.
      throw new Error(
        `No snapshots between ${startDate.toISOString()} and ${endDate.toISOString()}. ` +
          `Collect a dataset first; this script will not substitute synthetic data.`
      );
    }

    const commit = codeCommit();
    // Measured, per origin. `loadGasSeries` THROWS on an empty
    // ChainCostSnapshot rather than substituting the constants this script
    // used to assert -- a run priced from an assumption is a run whose H3
    // number describes the assumption.
    const gas = await loadGasSeries(prisma, startDate, endDate);
    console.error(
      `[evaluation] gas series: ${gas.summary.observations} measured observations, ` +
        `${gas.summary.firstIso} -> ${gas.summary.lastIso}, L2 base fee ` +
        `${gas.summary.minL2BaseFeeWei}..${gas.summary.maxL2BaseFeeWei} wei, ETH ` +
        `${gas.summary.minEthUsdE8}..${gas.summary.maxEthUsdE8} (1e8), digest ${gas.digest}`,
    );
    // The registered artifact when one is given, the provisional bootstrap
    // otherwise. §11.5's "Calibrated artifact" check blocks on the bootstrap,
    // so a run without --artifact is a rehearsal, not a citable result.
    const artifactPath = arg('artifact');
    const artifact =
      artifactPath !== undefined ? loadRegisteredArtifact(artifactPath) : loadBootstrapArtifact();
    console.error(
      `[evaluation] artifact ${artifact.artifactHash} ` +
        `(${artifact._provisional !== undefined ? 'PROVISIONAL — results are not citable' : 'registered'})`,
    );
    console.error(
      `[evaluation] horizon ${artifact.horizonSeconds / 86_400}d, coverage ` +
        `${artifact.coverageTarget}, method ${artifact.method}, k ${artifact.noTradeBandK}`,
    );
    const config = harnessConfig(gas, artifact);

    const out = runRegisteredEvaluation({
      dataset,
      config,
      artifact,
      tiers,
      decideOpts: DEFAULT_DECIDE_OPTS,
      calibrationFraction: CALIBRATION_FRACTION,
    });

    // The manifest is signed against the OBSERVATIONS, so it detects a
    // swapped dataset over the same window; the run record adds a result
    // hash, which the repo previously computed nowhere. `evaluation:verify`
    // re-derives both.
    const manifest = signManifest(
      generateManifest(
        manifestConfigForRun({
          version: MANIFEST_VERSION,
          dataset,
          tiers,
          artifact: out.artifact,
          config,
          calibrationFraction: CALIBRATION_FRACTION,
          codeCommit: commit,
        }),
      ),
      { snapshots: dataset.snapshots, withdrawals: dataset.withdrawals ?? [] },
    );

    const record = buildRunRecord({ codeCommit: commit, manifest, evaluation: out });

    // §11.5. Failure here is the point of the run: a missing tier, a missing
    // (policy, tier), an unmeasured withdrawal rate, an inert ablation, an
    // indistinguishable comparison and an absent fork replay each BLOCK,
    // rather than being skipped by a gate that iterates only over what is
    // present.
    const gate = evaluateRegisteredRelease(out);

    const summary = {
      ...summarize(out),
      releaseGate: {
        pass: gate.pass,
        blockedReasons: gate.blockedReasons,
        checks: gate.checks,
        comparisons: gate.comparisons,
        // §11.5's PRIMARY criterion, machine-readable rather than only as
        // prose inside the check details.
        sustainability: gate.sustainability,
        comparatorSustainability: gate.comparatorSustainability,
        scaleInvariant: gate.scaleInvariant,
        excludedComparators: gate.excludedComparators,
      },
      provenance: {
        codeCommit: record.codeCommit,
        manifestHash: manifest.contentHashes.manifest,
        datasetHash: manifest.contentHashes.dataset,
        resultHash: record.resultHash,
      },
      record,
    };
    const file = arg('out');
    if (file !== undefined) {
      writeFileSync(file, JSON.stringify(summary, null, 2));
      console.log(`[evaluation] wrote ${file}`);
      console.log(`[evaluation] result hash   ${record.resultHash}`);
      console.log(`[evaluation] manifest hash ${manifest.contentHashes.manifest}`);
      console.log(`[evaluation] dataset hash  ${manifest.contentHashes.dataset}`);
      console.log(`[evaluation] verify with:  pnpm run evaluation:verify ${file}`);
    } else {
      console.log(JSON.stringify(summary, null, 2));
    }

    console.error('');
    for (const c of gate.checks) {
      const mark = c.passed === true ? 'OK         ' : c.passed === false ? 'FAILED     ' : 'NOT PRODUCED';
      console.error(`[gate] [${mark}] ${c.name}: ${c.detail}`);
    }
    console.error(
      gate.pass
        ? '[gate] §11.5 release gate PASSED'
        : `[gate] §11.5 release gate BLOCKED: ${gate.blockedReasons.join(', ')}`,
    );

    if (out.provisional) {
      console.error(
        '[evaluation] WARNING: the artifact is PROVISIONAL (config/bootstrap-artifact.json says ' +
          'it is not calibrated). Results are not citable.'
      );
    }
    const inert = out.results.filter((r) => r.inertVsSrcla).map((r) => r.policy.id);
    if (inert.length > 0) {
      console.error(
        `[evaluation] WARNING: these policies made byte-identical decisions to SRCLA and removed ` +
          `nothing on this dataset: ${[...new Set(inert)].join(', ')}`
      );
    }
    // A blocked gate is a failed run. Exiting 0 would let CI, and a reader,
    // treat "did not verify" as "verified".
    if (!gate.pass) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[evaluation] FAILED:', err);
  process.exit(1);
});
