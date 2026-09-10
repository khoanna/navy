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
 *   heldout-c  86d, the v0.6 VALIDATION era. LESS BURNED, NOT PRISTINE: its
 *              aggregate statistics were read while diagnosing v0.5, so it is
 *              used because the alternative, heldout-b alone, is too short
 *              and too dominated by one venue's liquidity failure to
 *              adjudicate a yield claim -- not because it is clean.
 *   heldout-b  SECONDARY, chronologically after everything including the
 *              burned window and growing with the live collector -- clean
 *              but low power; reported for temporal purity, not significance.
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
 *     [--eras heldout-c,heldout-b] \
 *     [--out-dir .]
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD annualized.
 */
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { loadEra, loadWarmup } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { REGISTERED_ERAS, ERAS_IN_ORDER, eraBounds, type EraTag } from '../src/evaluation/eras.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import {
  runRegisteredEvaluation,
  REGISTERED_TIERS,
} from '../src/evaluation/kernel/harness.js';
import { NOT_OBSERVED, type HarnessConfig } from '../src/evaluation/kernel/decision-input.js';
import { buildRunRecord, manifestConfigForRun } from '../src/evaluation/kernel/provenance.js';
import { evaluateRegisteredRelease } from '../src/evaluation/kernel/gates.js';
import type { ArtifactRegistration } from '../src/evaluation/kernel/forecast-gate.js';
import { generateManifest, signManifest } from '../src/evaluation/manifest/generator.js';
import {
  renderReport,
  type RunSummary,
  type DatasetProvenance,
  type EraProvenanceRow,
  type VenueProvenanceRow,
  type CostRangeRow,
} from '../src/evaluation/report/render-markdown.js';
import { BASE, MARKET_IDS } from '../src/collector/archive/calls.js';
import type { PolicyArtifact } from '../src/policy/types.js';

const MANIFEST_VERSION = '1.0.0';
const CALIBRATION_FRACTION = 0.7;
/** Base mainnet. Not a deployment address -- this one is a global constant. */
const BASE_CHAIN_ID = 8453;
/** Matches `loadGasSeries`'s default -- so the L1/USDC ranges below describe
 * exactly the row set the L2/ETH ranges and the digest were built from. */
const GAS_LOOKBACK_SECONDS = 86_400;

const VENUE_META: Record<string, { displayName: string; address: string }> = {
  [MARKET_IDS.aave]: { displayName: 'Aave V3 Pool', address: BASE.aavePool },
  [MARKET_IDS.compound]: { displayName: 'Compound III Comet', address: BASE.comet },
  [MARKET_IDS.moonwell]: { displayName: 'Moonwell mUSDC', address: BASE.mToken },
};

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

/**
 * §11.4's stress demand is 50% of TVL; the venue universe can supply only
 * what the three venues held in `cashBase`, summed, at their single worst
 * origin. Computed from THIS era's own snapshots -- $3.6M is held-out A's
 * number, not a constant, and a different era's worst moment differs.
 */
function worstTotalCashLiquidity(dataset: {
  snapshots: readonly { timestamp: Date; snapshots: readonly { cashBase: bigint }[] }[];
}): { worstTotalCashBase: bigint; observedAtIso: string } {
  let worst: { totalCashBase: bigint; timestamp: Date } | undefined;
  for (const origin of dataset.snapshots) {
    const totalCashBase = origin.snapshots.reduce((sum, s) => sum + s.cashBase, 0n);
    if (worst === undefined || totalCashBase < worst.totalCashBase) {
      worst = { totalCashBase, timestamp: origin.timestamp };
    }
  }
  if (worst === undefined) {
    throw new Error('worstTotalCashLiquidity: dataset has no origins');
  }
  return { worstTotalCashBase: worst.totalCashBase, observedAtIso: worst.timestamp.toISOString() };
}

/**
 * The archive's ACTUAL per-era coverage -- distinct from `eraBounds()`,
 * which reports what was DECLARED. Every figure comes from `MarketSnapshot`
 * rows' own `blockNumber`/`timestamp`, denormalised `eraTag` included, never
 * from the registered boundary dates.
 */
async function loadEraProvenance(prisma: PrismaClient): Promise<EraProvenanceRow[]> {
  const rows = await prisma.marketSnapshot.findMany({
    where: { eraTag: { not: null }, blockNumber: { not: null } },
    distinct: ['eraTag', 'blockNumber'],
    select: { eraTag: true, blockNumber: true, timestamp: true },
    orderBy: [{ eraTag: 'asc' }, { blockNumber: 'asc' }],
  });

  const byEra = new Map<string, { blockNumber: bigint; timestamp: Date }[]>();
  for (const r of rows) {
    if (r.eraTag === null || r.blockNumber === null) continue;
    const arr = byEra.get(r.eraTag) ?? [];
    arr.push({ blockNumber: r.blockNumber, timestamp: r.timestamp });
    byEra.set(r.eraTag, arr);
  }

  return ERAS_IN_ORDER.map((e): EraProvenanceRow => {
    const originRows = (byEra.get(e.tag) ?? []).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    if (originRows.length === 0) {
      return {
        era: e.tag,
        firstDate: '—',
        lastDate: '—',
        firstBlock: '—',
        lastBlock: '—',
        origins: 0,
        days: 0,
        sealed: e.sealed,
      };
    }
    const first = originRows[0]!;
    const last = originRows[originRows.length - 1]!;
    const days = Math.max(
      1,
      Math.round((last.timestamp.getTime() - first.timestamp.getTime()) / 86_400_000),
    );
    return {
      era: e.tag,
      firstDate: first.timestamp.toISOString().slice(0, 10),
      lastDate: last.timestamp.toISOString().slice(0, 10),
      firstBlock: first.blockNumber.toString(),
      lastBlock: last.blockNumber.toString(),
      origins: originRows.length,
      days,
      sealed: e.sealed,
    };
  });
}

/**
 * The venue registry, with rates measured over the eras this run actually
 * evaluated (`eraTag` is denormalised onto every row at write time, so this
 * filters on the same predicate the sealing guard uses -- not a date range).
 */
async function loadVenueProvenance(
  prisma: PrismaClient,
  eras: readonly EraTag[],
): Promise<VenueProvenanceRow[]> {
  const marketIds = [MARKET_IDS.aave, MARKET_IDS.compound, MARKET_IDS.moonwell];
  const out: VenueProvenanceRow[] = [];
  for (const marketId of marketIds) {
    const meta = VENUE_META[marketId]!;
    const rows = await prisma.marketSnapshot.findMany({
      where: { marketId, eraTag: { in: [...eras] } },
      select: { supplyRateE18: true, configDigest: true, irmAddress: true },
    });
    if (rows.length === 0) {
      out.push({
        marketId,
        displayName: meta.displayName,
        address: meta.address,
        apyMin: 0,
        apyMean: 0,
        apyMax: 0,
        configRegimes: 0,
        irmContracts: 0,
      });
      continue;
    }
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const configs = new Set<string>();
    const irms = new Set<string>();
    for (const r of rows) {
      // supplyRateE18 is already WAD-annualized (calls.ts); a display-only
      // conversion, same lossy-Number convention as `pct()`/`usdc()` above.
      const apy = Number(BigInt(r.supplyRateE18)) / 1e18;
      if (apy < min) min = apy;
      if (apy > max) max = apy;
      sum += apy;
      configs.add(r.configDigest);
      if (r.irmAddress !== null) irms.add(r.irmAddress);
    }
    out.push({
      marketId,
      displayName: meta.displayName,
      address: meta.address,
      apyMin: min,
      apyMean: sum / rows.length,
      apyMax: max,
      configRegimes: configs.size,
      irmContracts: irms.size,
    });
  }
  return out;
}

/**
 * The L1 fee and USDC/USD ranges over exactly the row set `loadGasSeries`
 * (called with its default lookback) built the L2/ETH ranges and the digest
 * from -- so every column of the report's cost table describes one row set.
 */
async function loadL1AndUsdcRange(
  prisma: PrismaClient,
  start: Date,
  end: Date,
): Promise<{ l1BaseFeeMinWei: bigint; l1BaseFeeMaxWei: bigint; usdcUsdMinE8: bigint; usdcUsdMaxE8: bigint }> {
  const rows = await prisma.chainCostSnapshot.findMany({
    where: {
      timestamp: {
        gte: new Date(start.getTime() - GAS_LOOKBACK_SECONDS * 1000),
        lte: end,
      },
    },
    select: { l1BaseFeeWei: true, usdcUsdE8: true },
  });
  if (rows.length === 0) {
    throw new Error(
      `loadL1AndUsdcRange: no ChainCostSnapshot rows between ${start.toISOString()} and ` +
        `${end.toISOString()}`,
    );
  }
  let l1Min = BigInt(rows[0]!.l1BaseFeeWei);
  let l1Max = l1Min;
  let usdcMin = BigInt(rows[0]!.usdcUsdE8);
  let usdcMax = usdcMin;
  for (const r of rows) {
    const l1 = BigInt(r.l1BaseFeeWei);
    if (l1 < l1Min) l1Min = l1;
    if (l1 > l1Max) l1Max = l1;
    const usdc = BigInt(r.usdcUsdE8);
    if (usdc < usdcMin) usdcMin = usdc;
    if (usdc > usdcMax) usdcMax = usdc;
  }
  return { l1BaseFeeMinWei: l1Min, l1BaseFeeMaxWei: l1Max, usdcUsdMinE8: usdcMin, usdcUsdMaxE8: usdcMax };
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
      // §11.4's deployment and P28 sustainability measurements, per policy
      // per tier. Without these the machine-readable half of the deliverable
      // knows the PRIMARY release criterion only through prose inside the
      // check detail strings.
      capitalAtWorkFraction: r.replay.capitalAtWorkFraction,
      deploymentLatencyOrigins: r.replay.deploymentLatencyOrigins,
      timeToFullExitOrigins: r.replay.timeToFullExitOrigins,
      timeToFullExitCensored: r.replay.timeToFullExitCensored,
      venueStressContribution: r.replay.venueStressContribution,
      displayedVsRealizedGapApy: r.replay.displayedVsRealizedGapApy,
      policyViolations: r.replay.policyViolations,
    })),
    // §11.5 has TWO mandatory gates. The forecast one is serialised first,
    // and separately, because it is not a subset of the policy one: a policy
    // result computed from an uncalibrated forecast is not evidence about the
    // policy, whatever the policy gate says.
    forecastGate: {
      pass: run.evaluation.forecastGate.pass,
      blockedReasons: run.evaluation.forecastGate.blockedReasons,
      checks: run.evaluation.forecastGate.checks,
      venues: run.evaluation.forecastGate.venues,
    },
    releaseGate: {
      pass: run.gate.pass,
      blockedReasons: run.gate.blockedReasons,
      checks: run.gate.checks,
      comparisons: run.gate.comparisons,
      // §11.5's PRIMARY criterion, in full: the per-tier verdicts, the same
      // verdicts computed for every comparator (the counterexample table),
      // P26's scale-invariance roll-up and every comparator excluded from the
      // yield comparison with its reason.
      sustainability: run.gate.sustainability,
      comparatorSustainability: run.gate.comparatorSustainability,
      scaleInvariant: run.gate.scaleInvariant,
      excludedComparators: run.gate.excludedComparators,
      // P21 part 2 / P22. The margin is serialised beside the windows so the
      // run record testifies to the number that was actually used: a
      // registered constant nobody can read out of the artifact is not a
      // registration.
      nonInferiorityMarginApy: run.gate.nonInferiorityMarginApy,
      skillWindows: run.gate.skillWindows,
    },
  };
}

async function runEra(
  prisma: PrismaClient,
  era: EraTag,
  artifact: PolicyArtifact,
  tiers: readonly bigint[],
  commit: string,
  outDir: string,
  registration: ArtifactRegistration,
): Promise<{ run: RunSummary; costRow: CostRangeRow }> {
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

  // History the policy would have carried across the era boundary. Sized at
  // the artifact's horizon plus enough origins to clear minObservations --
  // without it, an era is evaluated cold and REGIME_MIN_HISTORY rejects every
  // venue until labels complete INSIDE the window, which on a short era is
  // the whole era. Never replayed, never scored, never fitted on.
  const warmupDays = Math.ceil(artifact.horizonSeconds / 86_400) + 30;
  const warmupSnapshots = await loadWarmup(prisma, era, warmupDays);
  console.error(
    `    warm-up: ${warmupSnapshots.length} origins over the ${warmupDays}d before the era ` +
      `(history only — not replayed, not scored)`,
  );

  const config = harnessConfig(gas, artifact);
  const evaluation = runRegisteredEvaluation({
    dataset,
    config,
    artifact,
    tiers,
    decideOpts: DEFAULT_DECIDE_OPTS,
    calibrationFraction: CALIBRATION_FRACTION,
    warmupSnapshots,
    registration,
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
  const universeLiquidity = worstTotalCashLiquidity(dataset);
  console.error(
    `    worst-case venue universe: $${(universeLiquidity.worstTotalCashBase / 1_000_000n).toString()} ` +
      `(observed ${universeLiquidity.observedAtIso})`,
  );
  const gate = evaluateRegisteredRelease(evaluation, { universeLiquidity });

  // §11.5's FIRST gate, printed first. It is not a subset of the policy gate
  // and it was never run before this release.
  console.error('');
  for (const c of evaluation.forecastGate.checks) {
    const mark = c.passed === true ? 'OK          ' : c.passed === false ? 'FAILED      ' : 'NOT PRODUCED';
    console.error(`    [${mark}] (forecast) ${c.name}: ${c.detail.slice(0, 160)}`);
  }
  console.error(
    evaluation.forecastGate.pass
      ? `    §11.5 forecast gate PASSED for ${era}`
      : `    §11.5 forecast gate BLOCKED for ${era}: ` +
        `${evaluation.forecastGate.blockedReasons.join(', ')}`,
  );
  console.error('');

  for (const c of gate.checks) {
    const mark = c.passed === true ? 'OK          ' : c.passed === false ? 'FAILED      ' : 'NOT PRODUCED';
    // A REPORTED check is not part of the verdict. Without this marker a
    // reader sees `FAILED` beside `release gate PASSED` and cannot tell which
    // of the two is wrong -- `blockedReasons` already excludes these.
    const role = c.gating === false ? ' (reported)' : '';
    console.error(`    [${mark}]${role} ${c.name}: ${c.detail.slice(0, 160)}`);
  }
  console.error(
    gate.pass
      ? `    §11.5 release gate PASSED for ${era}`
      : `    §11.5 release gate BLOCKED for ${era}: ${gate.blockedReasons.join(', ')}`,
  );

  // The VERIFIABLE run record, one file per era. `evaluation:verify` re-derives
  // the manifest, dataset and result hashes from it -- so the report's
  // "reproduce with" line names a file that actually exists rather than
  // describing a capability nothing exercises.
  const recordPath = join(outDir, `evaluation-${era}.json`);
  writeFileSync(recordPath, JSON.stringify({ record }, null, 2) + '\n');
  console.error(`    run record -> ${recordPath} (verify: pnpm run evaluation:verify ${recordPath})`);

  const l1AndUsdc = await loadL1AndUsdcRange(prisma, start, end);
  const costRow: CostRangeRow = {
    era,
    observations: gas.summary.observations,
    l2BaseFeeMinWei: gas.summary.minL2BaseFeeWei,
    l2BaseFeeMaxWei: gas.summary.maxL2BaseFeeWei,
    l1BaseFeeMinWei: l1AndUsdc.l1BaseFeeMinWei.toString(),
    l1BaseFeeMaxWei: l1AndUsdc.l1BaseFeeMaxWei.toString(),
    ethUsdMinE8: gas.summary.minEthUsdE8,
    ethUsdMaxE8: gas.summary.maxEthUsdE8,
    usdcUsdMinE8: l1AndUsdc.usdcUsdMinE8.toString(),
    usdcUsdMaxE8: l1AndUsdc.usdcUsdMaxE8.toString(),
    gasSeriesDigest: gas.digest,
  };

  return {
    run: {
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
    },
    costRow,
  };
}

async function main(): Promise<void> {
  const artifactPath = arg('artifact') ?? 'config/registered-artifact.json';
  // Default to the REPOSITORY ROOT, not the cwd. SRCLA-REPORT.{md,json} are
  // tracked at the root; writing them to srcla/ produced a fresh report
  // sitting beside a stale tracked one, which is the shape of mistake where
  // someone later cites the wrong file.
  const outDir = arg('out-dir') ?? '..';
  const eras = (arg('eras') ?? 'heldout-c,heldout-b').split(',').map((e) => e.trim()) as EraTag[];
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
    _registration?: ArtifactRegistration & {
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
    const costByEra: CostRangeRow[] = [];
    for (const era of eras) {
      const { run, costRow } = await runEra(prisma, era, artifact, tiers, commit, outDir, reg);
      runs.push(run);
      costByEra.push(costRow);
    }

    console.error('');
    console.error('[phase4] deriving dataset provenance (measured, not declared)...');
    const eraProvenance = await loadEraProvenance(prisma);
    const venueProvenance = await loadVenueProvenance(prisma, eras);
    const provenance: DatasetProvenance = {
      chainId: BASE_CHAIN_ID,
      multicall3Address: BASE.multicall3,
      gasOracleAddress: BASE.gasOracle,
      ethUsdFeedAddress: BASE.ethUsdFeed,
      usdcUsdFeedAddress: BASE.usdcUsdFeed,
      usdcAddress: BASE.usdc,
      usdcDecimals: 6,
      eras: eraProvenance,
      venues: venueProvenance,
      costByEra,
    };

    const markdown = renderReport({
      generatedAt: new Date().toISOString(),
      runs,
      notObserved: NOT_OBSERVED,
      provenance,
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
        `[phase4] ${r.era}: forecast ${r.evaluation.forecastGate.pass ? 'PASS' : 'FAIL'}, ` +
          `policy ${r.gate.pass ? 'PASS' : 'FAIL'} — result hash ${r.provenance.resultHash}`,
      );
    }
    // A blocked gate is a failed run. Exiting 0 would let CI, and a reader,
    // treat "did not verify" as "verified".
    if (runs.some((r) => !r.gate.pass || !r.evaluation.forecastGate.pass)) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[phase4] FAILED:', err);
  process.exit(1);
});
