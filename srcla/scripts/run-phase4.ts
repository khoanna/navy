#!/usr/bin/env tsx
/**
 * Phase 4's registered run, end to end, in one process.
 *
 * Runs the §11 protocol over BOTH held-out eras against the frozen registered
 * artifact, gates each, and renders `SRCLA-REPORT.{md,json}` from
 * `src/evaluation/report/` — replacing the untracked `evaluation-v2/*.mjs`
 * harness that produced every earlier version of that file (defect V5).
 *
 * BOTH sealed design eras are reported, and the report says why:
 *   heldout-c  86d, the v0.6 VALIDATION era. LESS BURNED, NOT PRISTINE: its
 *              aggregate statistics were read while diagnosing v0.5, so it is
 *              used because the alternative, heldout-b alone, is too short
 *              and too dominated by one venue's liquidity failure to
 *              adjudicate a yield claim -- not because it is clean.
 *   heldout-b  SECONDARY, chronologically after everything including the
 *              burned window; closed by Amendment P37 at P37_FREEZE_SECONDS
 *              and now DESIGN DATA for it (the fourth burned-window
 *              declaration) -- low power; reported alongside heldout-c for
 *              the registered v0.10 verdict, not for release.
 * Neither alone is sufficient evidence for the registered v0.10 verdict.
 * Reporting only the flattering one would be the choice this whole phase
 * exists to make impossible. Release itself is decided by `heldout-d` alone
 * (see `--eras` below), which carries no design knowledge and grows only as
 * origins are backfilled -- R30 refuses live-collector rows in a sealed era.
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
 *     [--eras heldout-c,heldout-b]      (add heldout-d for the P37 release verdict) \
 *     [--out-dir .]
 *
 * UNITS: money is bigint USDC base units (6 dp); rates WAD annualized.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { loadEra, loadWarmup } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import {
  REGISTERED_ERAS,
  ERAS_IN_ORDER,
  eraBounds,
  hourlyOriginGaps,
  type EraTag,
} from '../src/evaluation/eras.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import {
  runRegisteredEvaluation,
  runRegisteredForkReplays,
  REGISTERED_TIERS,
} from '../src/evaluation/kernel/harness.js';
import { NOT_OBSERVED, type HarnessConfig } from '../src/evaluation/kernel/decision-input.js';
import { buildRunRecord, manifestConfigForRun } from '../src/evaluation/kernel/provenance.js';
import { evaluateRegisteredRelease } from '../src/evaluation/kernel/gates.js';
import {
  FIGURE_TIERS,
  PLOTTED,
  buildFigureSweep,
  reportFigures,
  venueFailureWarning,
} from '../src/evaluation/report/charts.js';
import { REGISTERED_S2_COVERAGE_FLOOR } from '../src/evaluation/kernel/sustainability.js';
import { forkReplayOptionsFromEnv, registeredForkBench } from '../src/evaluation/fork-runner.js';
import type { ArtifactRegistration } from '../src/evaluation/kernel/forecast-gate.js';
import { generateManifest, signManifest } from '../src/evaluation/manifest/generator.js';
import {
  renderReport,
  threeVerdicts,
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

/**
 * Facts about this repository's history that the run cannot derive from its
 * own inputs, and that a reader must have to weigh the numbers. They live
 * here — next to the run that publishes them — rather than inside the pure
 * renderer, which must stay free of one-off history.
 *
 * Each entry states the defect, its MEASURED magnitude, and the decision
 * taken. An entry is removed only when the underlying fact stops being true,
 * never because it is inconvenient.
 */
function registeredDisclosures(artifact: PolicyArtifact) {
  const rel = artifact.relativeResidualQuantileWadByMarket ?? {};
  const q = (id: string): string => (rel[id] === undefined ? 'absent' : (Number(rel[id]) / 1e18).toFixed(3));
  const abs = artifact.residualQuantileWadByMarket;
  // P29's crossover: the rate at which the relative haircut `mu * |q_rel|` equals the
  // annualised absolute haircut. Above it the relative bound is stricter; below it, looser.
  const crossover = (id: string): string => {
    if (abs[id] === undefined || rel[id] === undefined) return 'n/a';
    const annualAbsHaircut = (-Number(abs[id]) / 1e18) * (31_536_000 / artifact.horizonSeconds);
    return `${((annualAbsHaircut / (-Number(rel[id]) / 1e18)) * 100).toFixed(2)}%`;
  };
  const crossovers =
    `aave ${crossover(MARKET_IDS.aave)}, compound ${crossover(MARKET_IDS.compound)}, ` +
    `moonwell ${crossover(MARKET_IDS.moonwell)}`;
  return {
    artifactFreeze: [
      'The artifact was frozen by `pnpm phase4:freeze` against the corrected archive — the ' +
        'one in which every venue rate map reproduces chain and per-origin IRM attribution ' +
        'is present for all five eras. It selects `state-space` at a 1-day horizon on a ' +
        'selection margin of 0.4095 over the runner-up, so the choice is not a coin flip ' +
        'between near-ties.',
      "P1's residual quantile is carried in RELATIVE form " +
        `(\`relativeResidualQuantileWadByMarket\`: aave ${q(MARKET_IDS.aave)}, compound ` +
        `${q(MARKET_IDS.compound)}, moonwell ${q(MARKET_IDS.moonwell)}), applied as ` +
        '`mu * (1 + q)` rather than `mu + q`. The absolute map is ' +
        'retained and still reported. The re-specification was derived from ' +
        'CALIBRATION-era measurements alone — the 5% lower quantile of absolute forecast ' +
        'error varies 2.9x-5.9x across utilization bands while the relative error varies ' +
        '1.8x-2.9x and tracks the level being forecast. It is not uniformly stricter: it is ' +
        "STRICTER than the absolute form only above each venue's crossover rate (annualised " +
        `absolute haircut ÷ |relative quantile|: ${crossovers}) and LOOSER below it. The ` +
        'typical venue rates both sealed eras observed sit below every crossover — only peak ' +
        "rates and Moonwell's failed state on `heldout-b` exceed them — so on those eras the " +
        'relative form is the LOOSER of the two.',
      "P8's significance multiplier `k` did NOT resolve on the calibration sweep and is " +
        'carried at its registered default. Every result that depends on it is provisional.',
      'AMENDMENT P37 (paper v0.11) IS POST-HOC. It was designed after both sealed eras had ' +
        'been opened and read, so its verdict on `heldout-c` and `heldout-b` is labelled post-hoc ' +
        'and is not a test of P37. It moves no registered threshold value. It implements P34 in ' +
        "the gates (a residual whose label window saw its venue at zero withdrawable cash is " +
        "outside the forecast's domain; an S2 breach fully explained by a position trapped in " +
        'such a venue, with no deposit into it, is a VENUE FAILURE rather than an allocator ' +
        'error), makes the coverage tests one-sided for a lower bound, gates the fork replay on ' +
        "SRCLA's own plans, and scopes the release to vaults up to 1,000,000 USDC. `heldout-b`, " +
        'registered open-ended, now ends at P37_FREEZE_SECONDS; the release verdict rests on ' +
        '`heldout-d`, sealed from the next second, and only once it holds 2,064 origins with ' +
        'zero gaps.',
    ],
    archive: [
      '**31 spurious single-hour Aave regime boundaries** survive in the `burned` (17 rows) ' +
        'and `heldout-c` (14 rows) eras. Each is an isolated one-hour flip of ' +
        '`irmSlopeLowWad` (450 bps → 460 bps → 450 bps) at an IDENTICAL block number and an ' +
        'identical strategy address, reverting at the next hourly sample — the signature of ' +
        'an inconsistent archive read against a lagging RPC replica, not of governance ' +
        'action. The controls are direct: `burned-a` shows zero such flips, and ' +
        "calibration's 1,082 Aave regime changes are 100% genuine rate-model ADDRESS swaps " +
        'with zero same-address flicker. Measured effect on the Aave rate-model mean ' +
        'absolute error is 5.8e-4 percentage points. The rows were NOT re-read: the ' +
        'magnitude is immaterial to every reported result, and re-reading archive data once ' +
        'a sealed era is open is itself a hazard. Disclosed, not repaired.',
      'An earlier account of this defect — that Aave V3.2 mutates rate parameters in place — ' +
        'was WRONG and is retracted. Row-level diffing showed isolated same-block, ' +
        'same-address flicker, which no in-place governance mutation produces.',
    ],
    reproducibility: [
      '**THIS IS NOT A CLEAN PRE-REGISTERED TEST OF `heldout-c`, and must not be cited as ' +
        'one.** An earlier registered run opened both sealed eras and returned FAIL. Its ' +
        'results then informed two changes made before this run: a re-specification of ' +
        "P1's uncertainty term, and a revision of four release thresholds. `heldout-c` has " +
        'therefore INFORMED THE DESIGN and is design data by §2.2\'s own standard. This run ' +
        'is a CONFIRMATORY RE-RUN. The only era carrying no design knowledge of this ' +
        'controller is a future one.',
      'The mitigating facts, stated so a reader can weigh them rather than take the above as ' +
        "boilerplate: P1's re-specification was derived from CALIBRATION-era measurements " +
        'only (per-band forecast-error dispersion), and it was chosen before its effect on any ' +
        'sealed era was known. It is not a conservative choice on these eras: it is stricter ' +
        `than what it replaces only above each venue's crossover (${crossovers}) and looser ` +
        "below it, where the sealed eras' typical venue rates sit. " +
        'The threshold revisions were NOT: each is justified on its own terms below, but ' +
        'each was made after seeing which checks blocked.',
      '**Revised release thresholds** (previous → current): demonstration floor 0.80 → 0.70; ' +
        'S2 stressed coverage 0.99 → 0.95; regime purity zero-tolerance → a 10% share; ' +
        '"no inert ablation" from BLOCKING to REPORTED. The non-inferiority margin was left ' +
        'at 43 bps precisely because raising it could only have been justified by the result ' +
        'it would produce. S2\'s grading floor was also SEPARATED from the constant the ' +
        "optimiser filters candidate allocations with, so relaxing the release bar does not " +
        "silently relax the controller's own safety filter.",
      '**Decision hashes from this version are not comparable to v0.6 ones.** The hashed ' +
        'decision component is now `legs` where it was a permanently-constant empty `costs` ' +
        'object, and the bootstrap `artifactHash` moved. An externally recorded decision hash ' +
        'from before this change will not reproduce; that is a documented format change ' +
        'rather than evidence of non-determinism.',
      '**P36 — the movement hurdles now read the relative bound. This change is POST-HOC and ' +
        'is disclosed under P32.** P29 made the uncertainty haircut multiplicative in the ' +
        "optimiser's objective, but §9.1.2/§9.1.3's hurdles kept computing `rate + q_abs·year/H` " +
        'from the absolute map — −4.09 pp (Aave), −2.11 pp (Compound) and −3.12 pp (Moonwell) ' +
        'annualised at the registered 1-day horizon — so a vault large enough to compress a ' +
        "venue's post-deposit rate below that haircut could not deploy into it at all. The defect " +
        "was FOUND by reading the previous run's `heldout-c` ablation rows, where H3d restored " +
        'capital at work at ten million. It is justified by P29\'s own calibration-era ' +
        'measurements and by conformance to §7.1, not by any held-out number. Its go/no-go ' +
        'was a calibration-era sweep (2025-03-03 → 2025-05-31, sixteen vault sizes) with ' +
        'three criteria fixed before it ran. Two passed: stressed coverage held at 1.000 at ' +
        'every size, and net APY at or below one million USDC moved by +0.3 to +1.4 bps. ' +
        'The third — capital at work and net APY no lower after the change at every size of ' +
        '$3M or more, with no tolerance — FAILED at $3M, $5M, $6.5M, $8M and $10M, by at ' +
        'most 0.72 percentage points of capital at work and 1.4 bps of APY (mean APY change ' +
        'at $3M or more: −0.03 bps). That window never exhibited the ten-million collapse ' +
        '(capital at work was already at least 0.917 before the change), so it could test ' +
        'for harm but not for benefit. **The repository owner overrode the failed criterion ' +
        'after seeing these numbers; that override is itself post-hoc.** The frozen artifact ' +
        "is unchanged (same hash, no refit). H2's switch now also removes the hurdle's haircut, " +
        'which changes H2 and B3. Both sealed eras are therefore CONFIRMATORY RE-RUNS for P36.',
    ],
  };
}

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
    // §11.1's pinned-prestate fork replay, as DATA. Omitting it left the
    // machine-readable half of the deliverable knowing about §11.1 only
    // through a prose sentence inside a check detail — the same omission
    // class already closed for the sustainability verdicts. `null` is the
    // NOT PRODUCED case and is written explicitly, never left absent.
    forkReplay:
      run.forkResults === undefined
        ? null
        : run.forkResults.map((f) => ({
            policyId: f.policyId,
            tier: f.tier.toString(),
            prestateBlock: f.prestateBlock,
            executed: f.executed,
            // A HOLD is `executed: true` with NO chain interaction. Both
            // fields are serialised so a reader cannot count holds as
            // executions, which is what the console line used to do.
            held: f.held === true,
            detail: f.detail,
          })),
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
    // P37 (paper v0.11). `null` is NOT PRODUCED, never a pass.
    policyGateP37:
      run.gateP37 === undefined
        ? null
        : {
            amendment: run.gateP37.amendment,
            pass: run.gateP37.pass,
            blockedReasons: run.gateP37.blockedReasons,
            checks: run.gateP37.checks,
            sustainability: run.gateP37.sustainability,
            outOfScopeSustainability: run.gateP37.outOfScopeSustainability ?? [],
          },
    forecastGateP37:
      run.evaluation.forecastGateP37 === undefined
        ? null
        : {
            pass: run.evaluation.forecastGateP37.pass,
            blockedReasons: run.evaluation.forecastGateP37.blockedReasons,
            checks: run.evaluation.forecastGateP37.checks,
          },
    originGaps: run.originGaps ?? null,
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
  // `--policies` is for DIAGNOSTIC runs only (e.g. reproducing one fork
  // refusal). A restricted run is incomplete, and §11.5's completeness checks
  // block it, so it can never stand in for a registered result.
  const policyIds = arg('policies')?.split(',').map((p) => p.trim());
  const evaluation = runRegisteredEvaluation({
    dataset,
    config,
    artifact,
    tiers,
    decideOpts: DEFAULT_DECIDE_OPTS,
    calibrationFraction: CALIBRATION_FRACTION,
    warmupSnapshots,
    registration,
    ...(policyIds === undefined ? {} : { policyIds }),
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

  // Figures. Written next to the report and referenced relatively, so the
  // markdown, the SVGs and any LaTeX/Word import all resolve the same paths.
  // FIGURE-ONLY sweep at a denser set of vault sizes. §11.1's four registered
  // tiers are unchanged and remain the only ones any gate is scored on; this
  // exists because four points across three decades cannot locate a capacity
  // limit that lives entirely inside the 1M-10M step. Only the plotted
  // policies are run, and every Nth origin, because a capacity curve is about
  // the level rather than the fine time structure -- disclosed in the caption.
  const figureStride = Number(arg('figure-stride') ?? 3);
  const figureDataset = {
    ...dataset,
    snapshots: dataset.snapshots.filter((_, i) => i % figureStride === 0),
  };
  console.error(
    `    figure sweep: ${FIGURE_TIERS.length} vault sizes x ${PLOTTED.length} policies ` +
      `on every ${figureStride}${figureStride === 3 ? 'rd' : 'th'} origin ` +
      `(${figureDataset.snapshots.length} of ${dataset.snapshots.length})`,
  );
  const figureEval = runRegisteredEvaluation({
    dataset: figureDataset,
    config,
    artifact,
    tiers: FIGURE_TIERS,
    policyIds: PLOTTED,
    decideOpts: DEFAULT_DECIDE_OPTS,
    calibrationFraction: CALIBRATION_FRACTION,
    warmupSnapshots,
    registration,
  });
  // A venue that was DRY — zero withdrawable cash — for a material share of the
  // era makes every yield figure over that period unattainable, because the
  // rate accrues on a position nobody can exit. Measured per venue and drawn
  // on the figure itself; see `venueFailureWarning`.
  const dryByVenue: Record<string, { dryOrigins: number; total: number; maxApy: number }> = {};
  for (const o of dataset.snapshots) {
    for (const m of o.snapshots) {
      const v = (dryByVenue[m.marketId] ??= { dryOrigins: 0, total: 0, maxApy: 0 });
      v.total += 1;
      // `cashBase` is the venue's own withdrawable cash at the origin.
      // `maxWithdrawableBase` does not exist on the archive snapshot — it is
      // derived from exactly this field later, in `decision-input.ts`.
      if (m.cashBase === 0n) v.dryOrigins += 1;
      const apy = Number(m.supplyRateE18) / 1e18;
      if (apy > v.maxApy) v.maxApy = apy;
    }
  }
  // OBSERVED days, not the registered bound. `heldout-d` is open-ended and its
  // registered end is a far-future sentinel, so `eraBounds().days` is 26,793 --
  // which would have printed "annualized from 26793 days" on a figure whose
  // whole point is that the window is SHORT.
  const spanSeconds =
    (dataset.snapshots[dataset.snapshots.length - 1]!.timestamp.getTime() -
      dataset.snapshots[0]!.timestamp.getTime()) /
    1000;
  const warning = venueFailureWarning(dryByVenue, Math.max(1, Math.round(spanSeconds / 86_400)));
  if (warning !== undefined) console.error(`    ${warning}`);
  // The figures are drawn from the sweep object that is persisted below, so the
  // published numbers and the pictures cannot disagree. Everything lands under
  // report/: the figures in report/figures/, the sweep in report/chart/, where
  // `pnpm figures:render` can redraw the figures from it without a replay.
  const sweep = buildFigureSweep(era, figureStride, figureEval, REGISTERED_S2_COVERAGE_FLOOR, warning);
  const figures = reportFigures(sweep);
  const figuresDir = join(outDir, 'report', 'figures');
  mkdirSync(figuresDir, { recursive: true });
  for (const f of figures) writeFileSync(join(figuresDir, f.filename), f.svg + '\n');
  console.error(`    figures -> ${figuresDir}: ${figures.map((f) => f.filename).join(', ')}`);
  // The figures' numbers, machine-readable. An SVG carries only pixel
  // coordinates, so without this file the dense-grid table in the paper
  // (Appendix F.7) could not be rebuilt from the run that drew it.
  const chartDir = join(outDir, 'report', 'chart');
  mkdirSync(chartDir, { recursive: true });
  const sweepPath = join(chartDir, `SRCLA-FIGURE-SWEEP-${era}.json`);
  writeFileSync(sweepPath, JSON.stringify(sweep, null, 2) + '\n');
  console.error(`    figure data -> ${sweepPath}`);
  const universeLiquidity = worstTotalCashLiquidity(dataset);
  console.error(
    `    worst-case venue universe: $${(universeLiquidity.worstTotalCashBase / 1_000_000n).toString()} ` +
      `(observed ${universeLiquidity.observedAtIso})`,
  );
  // §11.1's pinned-prestate fork replay. Produced only when the environment
  // names a live Base fork with the vault deployed; otherwise NOTHING is
  // passed and the completeness check reports NOT PRODUCED and blocks. There
  // is deliberately no default that lets the gate pass without the evidence.
  const forkOpts = await forkReplayOptionsFromEnv();
  // The bench is checked against the SAME `config` the evaluation ran on, over
  // the markets its dataset holds: a tier vault that does not carry those values
  // is NOT PRODUCED rather than replayed.
  const forkResults =
    forkOpts === null
      ? undefined
      : await runRegisteredForkReplays(evaluation, {
          ...forkOpts,
          registeredBench: registeredForkBench(config, [
            ...new Set(dataset.snapshots.flatMap((o) => o.snapshots.map((m) => m.marketId))),
          ]),
        });
  console.error(
    forkResults === undefined
      ? '    §11.1 fork replay: NOT PRODUCED (set SRCLA_FORK_REPLAY_RPC_URL / ' +
          '_VAULT_ADDRESS / _ALLOCATOR_KEY / _ADAPTERS to produce one) — the release gate blocks'
      : `    §11.1 fork replay: ${forkResults.filter((f) => f.executed && f.held !== true).length}` +
          `/${forkResults.length} EXECUTED (${forkResults.filter((f) => f.held === true).length} ` +
          `HOLD — no chain interaction) against ${forkOpts!.rpcUrl} at pinned block ` +
          `${forkOpts!.prestateBlock}`,
  );
  const gate = evaluateRegisteredRelease(evaluation, {
    universeLiquidity,
    ...(forkResults === undefined ? {} : { forkResults }),
  });
  // P37 (paper v0.11): the same run graded under the amendment — post-hoc on
  // heldout-c/heldout-b, the release verdict on heldout-d. The registered gate
  // above is unchanged and still decides this script's exit code.
  const gateP37 = evaluateRegisteredRelease(evaluation, {
    universeLiquidity,
    ...(forkResults === undefined ? {} : { forkResults }),
    amendment: 'p37',
  });
  const originGaps = hourlyOriginGaps(
    dataset.snapshots.map((s) => Math.floor(s.timestamp.getTime() / 1000)),
    REGISTERED_ERAS[era].startSeconds,
  );
  console.error(
    `    P37: forecast ${evaluation.forecastGateP37?.pass === true ? 'PASS' : 'FAIL'}, ` +
      `policy ${gateP37.pass ? 'PASS' : 'FAIL'}` +
      (gateP37.pass ? '' : ` — blocked on ${gateP37.blockedReasons.join(', ')}`) +
      `; ${dataset.snapshots.length} origins, ${originGaps} gap(s)`,
  );

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
      gateP37,
      originGaps,
      datasetOrigins: dataset.snapshots.length,
      // Relative to report/SRCLA-REPORT.md, which links them.
      figures: figures.map((f) => ({ filename: `figures/${f.filename}`, caption: f.caption })),
      // Carried onto the run summary so `serialisableRun` can put §11.1 in
      // the JSON as data. `undefined` here IS the NOT PRODUCED case.
      forkResults,
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
  // Default to the REPOSITORY ROOT, not the cwd: writing to srcla/ produced a
  // fresh report sitting beside a stale one, which is the shape of mistake
  // where someone later cites the wrong file. The report and everything it
  // shows go under <out-dir>/report/ (figures/, chart/); SRCLA-REPORT.json and
  // the run records stay at <out-dir>.
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
      disclosures: registeredDisclosures(artifact),
    });

    const verdicts = threeVerdicts(runs);

    mkdirSync(join(outDir, 'report'), { recursive: true });
    const mdPath = join(outDir, 'report', 'SRCLA-REPORT.md');
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
          verdicts,
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
    console.error(
      `[phase4] verdicts: registered v0.10 ${verdicts.registered.status}, P37 post-hoc ` +
        `${verdicts.p37PostHoc.status}, release ${verdicts.release.status}`,
    );
    // A blocked gate is a failed run. Exiting 0 would let CI, and a reader,
    // treat "did not verify" as "verified". The registered v0.10 gate decides
    // this script's exit code; P37 is reported alongside it, never in place of it.
    if (runs.some((r) => !r.gate.pass || !r.evaluation.forecastGate.pass)) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[phase4] FAILED:', err);
  process.exit(1);
});
