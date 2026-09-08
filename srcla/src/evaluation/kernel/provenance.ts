/**
 * The reproducibility record for one registered evaluation run
 * (paper §2.2, §7.3, §11.1, Appendix C).
 *
 * Appendix C promises that a reader can re-run `pnpm run evaluation:verify`
 * and reproduce the manifest and result hashes. Before this module:
 *
 *   - there was no `evaluation:verify` script;
 *   - **no result hash was computed anywhere in the repo** — a result could
 *     be edited after the fact and nothing would notice;
 *   - `scripts/run-evaluation-full.ts` printed a "Content hash" built out of
 *     `Date.now()`, which is a timestamp wearing a hash's clothes.
 *
 * A run record binds four things together: the code commit, the manifest
 * (which now hashes the observation series — see `manifest/generator.ts`),
 * the frozen policy artifact, and a hash of the results themselves. Break any
 * one and `verifyRunRecord` says which.
 *
 * ABSENCE IS FAILURE throughout: a missing hash, a missing commit, or a leg
 * that could not be checked is reported as unverified and never as a pass.
 *
 * UNITS: money is bigint USDC base units (6 dp); rates are WAD annualized.
 */
import { hashData } from '../../domain/hashing.js';
import {
  computeContentHash,
  UNKNOWN_CODE_COMMIT,
  type DatasetObservations,
} from '../manifest/generator.js';
import type { EvaluationManifest, ManifestConfig } from '../manifest/types.js';
import type { EvaluationDataset } from '../dataset.js';
import type { PolicyArtifact } from '../../policy/types.js';
import { DEFAULT_DECIDE_OPTS } from '../../policy/decide.js';
import type { HarnessConfig } from './decision-input.js';
import { gasAt, isGasSeries } from '../gas-series.js';
import { REGISTERED_BASELINES, REGISTERED_ABLATIONS } from './registry.js';
import { verifyManifest, type VerificationResult } from '../manifest/verifier.js';
import type { PolicyRunResult, RegisteredEvaluationResult } from './harness.js';

/**
 * The citable content of one (policy, tier) row.
 *
 * Everything a reader would quote from SRCLA-REPORT.md is here, and nothing
 * that varies between two runs over the same data is: no wall clock, no
 * hostname, no run id.
 */
export interface HashedPolicyResult {
  policyId: string;
  tier: string;
  realizedNetApy: number;
  totalCostsBase: string;
  totalTurnoverBase: string;
  rebalances: number;
  withdrawalsAttempted: number;
  /** `null` means never measured. Preserved as null — see ReplayResult. */
  withdrawalSuccessRate: number | null;
  minStressedLiquidCoverage: number;
  inertVsSrcla: boolean;
  /** One kernel decision hash per origin: the finest-grained evidence there is. */
  decisionHashes: string[];
  /** Per-period after-cost share prices, WAD. The significance test's input. */
  sharePricesWad: string[];
}

/** The full run payload the result hash covers. */
export interface HashedResults {
  artifactHash: string;
  provisional: boolean;
  withdrawalSource: string;
  missingPolicyIds: string[];
  missingTiers: string[];
  results: HashedPolicyResult[];
}

export interface EvaluationRunRecord {
  /** Schema version of this record, so a verifier can refuse a shape it does not know. */
  recordVersion: 1;
  /** `git rev-parse HEAD` at the time of the run. */
  codeCommit: string;
  manifest: EvaluationManifest;
  results: HashedResults;
  /** SHA-256 over `results`, canonicalized with sorted keys. */
  resultHash: string;
  /**
   * Wall-clock stamp. Deliberately OUTSIDE every hash: it is provenance for a
   * human, not content, and folding it in would make two runs over identical
   * data disagree.
   */
  runAt: string;
}

function hashedRow(r: PolicyRunResult): HashedPolicyResult {
  return {
    policyId: r.policy.id,
    tier: r.tier.toString(),
    realizedNetApy: r.replay.realizedNetApy,
    totalCostsBase: r.replay.totalCosts.toString(),
    totalTurnoverBase: r.replay.totalTurnover.toString(),
    rebalances: r.rebalances,
    withdrawalsAttempted: r.replay.withdrawals.length,
    withdrawalSuccessRate: r.replay.withdrawalSuccessRate,
    minStressedLiquidCoverage: r.replay.minStressedLiquidCoverage,
    inertVsSrcla: r.inertVsSrcla,
    decisionHashes: r.decisionHashes,
    sharePricesWad: r.replay.snapshots.map((s) => s.sharePriceWad.toString()),
  };
}

/**
 * Reduce a registered evaluation to the payload the result hash covers.
 *
 * Rows are sorted by (policyId, tier) so the hash does not depend on the
 * order the harness happened to iterate in.
 */
export function hashableResults(out: RegisteredEvaluationResult): HashedResults {
  const results = out.results.map(hashedRow).sort((a, b) => {
    if (a.policyId !== b.policyId) return a.policyId < b.policyId ? -1 : 1;
    return BigInt(a.tier) < BigInt(b.tier) ? -1 : BigInt(a.tier) > BigInt(b.tier) ? 1 : 0;
  });

  return {
    artifactHash: out.artifact.artifactHash,
    provisional: out.provisional,
    withdrawalSource: out.withdrawalSource,
    missingPolicyIds: [...out.missingPolicyIds].sort(),
    missingTiers: out.missingTiers.map((t) => t.toString()).sort(),
    results,
  };
}

/**
 * SHA-256 over the canonical result payload.
 *
 * `hashData` sorts object keys, so this is stable under key reordering and
 * moves whenever any reported value moves.
 */
export function computeResultHash(results: HashedResults): string {
  return hashData(results);
}

/**
 * Build the record that goes next to a published number.
 *
 * @throws when the code commit is unrecorded. A result nobody can tie to a
 *   revision is not reproducible, and emitting it with `codeCommit: 'unknown'`
 *   would let the run look complete while being unciteable.
 */
export function buildRunRecord(args: {
  codeCommit: string;
  manifest: EvaluationManifest;
  evaluation: RegisteredEvaluationResult;
  runAt?: Date;
}): EvaluationRunRecord {
  if (!args.codeCommit || args.codeCommit === UNKNOWN_CODE_COMMIT) {
    throw new Error(
      `buildRunRecord: code commit is '${args.codeCommit}'. A result that is not tied to a ` +
        'revision cannot be reproduced; set GIT_COMMIT_HASH or run inside the git worktree.',
    );
  }

  const results = hashableResults(args.evaluation);
  return {
    recordVersion: 1,
    codeCommit: args.codeCommit,
    manifest: args.manifest,
    results,
    resultHash: computeResultHash(results),
    runAt: (args.runAt ?? new Date()).toISOString(),
  };
}

/** One checked property of a run record. */
export interface ProvenanceCheck {
  name: string;
  /**
   * `true` verified, `false` FAILED, `null` NOT CHECKED. `null` is never a
   * pass: `verified` below is true only when every check is exactly `true`.
   */
  passed: boolean | null;
  detail: string;
}

export interface ProvenanceReport {
  verified: boolean;
  checks: ProvenanceCheck[];
  manifestVerification?: VerificationResult;
}

/**
 * Re-derive every hash in a run record and say which legs actually verified.
 *
 * @param observations - the dataset the manifest pinned. When omitted, the
 *   dataset leg is reported NOT CHECKED and the overall verdict is NOT
 *   verified. That is the point: "I could not check it" and "it is fine" are
 *   different answers, and the previous verifier returned the second for
 *   both.
 * @param currentCommit - `git rev-parse HEAD` in the tree doing the
 *   verification. A mismatch fails: the record's numbers were produced by
 *   other code.
 */
export async function verifyRunRecord(
  record: EvaluationRunRecord,
  opts: { observations?: DatasetObservations; currentCommit?: string } = {},
): Promise<ProvenanceReport> {
  const checks: ProvenanceCheck[] = [];

  if (record.recordVersion !== 1) {
    checks.push({
      name: 'Record schema',
      passed: false,
      detail: `unknown recordVersion ${String(record.recordVersion)}`,
    });
  } else {
    checks.push({ name: 'Record schema', passed: true, detail: 'recordVersion 1' });
  }

  const recomputedResult = computeResultHash(record.results);
  checks.push(
    !record.resultHash
      ? { name: 'Result hash', passed: false, detail: 'record carries no result hash' }
      : {
          name: 'Result hash',
          passed: record.resultHash === recomputedResult,
          detail:
            record.resultHash === recomputedResult
              ? record.resultHash
              : `recorded ${record.resultHash}, recomputed ${recomputedResult}`,
        },
  );

  const recomputedManifest = computeContentHash(record.manifest);
  checks.push(
    !record.manifest.contentHashes.manifest
      ? { name: 'Manifest hash', passed: false, detail: 'manifest is unsigned' }
      : {
          name: 'Manifest hash',
          passed: record.manifest.contentHashes.manifest === recomputedManifest,
          detail:
            record.manifest.contentHashes.manifest === recomputedManifest
              ? recomputedManifest
              : `recorded ${record.manifest.contentHashes.manifest}, recomputed ${recomputedManifest}`,
        },
  );

  checks.push(
    record.manifest.contentHashes.codeCommit === record.codeCommit
      ? { name: 'Commit consistency', passed: true, detail: record.codeCommit }
      : {
          name: 'Commit consistency',
          passed: false,
          detail: `record says ${record.codeCommit}, manifest says ${record.manifest.contentHashes.codeCommit}`,
        },
  );

  checks.push(
    opts.currentCommit === undefined
      ? {
          name: 'Code commit',
          passed: null,
          detail: 'not checked: no current commit supplied',
        }
      : {
          name: 'Code commit',
          passed: opts.currentCommit === record.codeCommit,
          detail:
            opts.currentCommit === record.codeCommit
              ? record.codeCommit
              : `record was produced at ${record.codeCommit}, this tree is at ${opts.currentCommit}`,
        },
  );

  let manifestVerification: VerificationResult | undefined;
  if (opts.observations === undefined) {
    checks.push({
      name: 'Dataset hash',
      passed: null,
      detail:
        'not checked: no observation series supplied. Re-run with DATABASE_URL set to verify ' +
        'the manifest against the dataset it pins.',
    });
  } else {
    manifestVerification = await verifyManifest(record.manifest, opts.observations);
    checks.push({
      name: 'Dataset hash',
      passed: manifestVerification.valid,
      detail: manifestVerification.valid
        ? record.manifest.contentHashes.dataset
        : manifestVerification.errors.join('; '),
    });
  }

  const report: ProvenanceReport = {
    // `=== true`, not truthiness: a `null` (unchecked) leg must not verify.
    verified: checks.every((c) => c.passed === true),
    checks,
  };
  if (manifestVerification !== undefined) report.manifestVerification = manifestVerification;
  return report;
}

/**
 * The `ManifestConfig` describing a registered run, derived from what the run
 * ACTUALLY used rather than from a hand-maintained JSON file.
 *
 * `config/evaluation-manifest.json` declares horizons `[1, 7, 30]` days where
 * §7.2's registered set is `[1, 7, 14]`, and neither it nor
 * `src/policy/registered.ts` was read by the harness that produced
 * SRCLA-REPORT.md. A manifest that is written by hand next to the run it
 * describes will drift from it; one derived from the run cannot.
 *
 * `snapshotCadenceMinutes` is MEASURED (the median gap between consecutive
 * snapshots), not declared.
 */
export function manifestConfigForRun(args: {
  version: string;
  dataset: EvaluationDataset;
  tiers: readonly bigint[];
  artifact: PolicyArtifact;
  config: HarnessConfig;
  calibrationFraction: number;
  codeCommit: string;
}): ManifestConfig {
  const { dataset } = args;
  const first = dataset.snapshots[0];
  const last = dataset.snapshots[dataset.snapshots.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('manifestConfigForRun: the dataset has no snapshots to describe');
  }

  const marketIds = [
    ...new Set(dataset.snapshots.flatMap((s) => s.snapshots.map((m) => m.marketId))),
  ].sort();

  // The manifest's three cost scalars are the observation in force at the
  // run's FIRST origin, so a series and a constant record the same shape.
  const firstGas = gasAt(args.config.gas, Math.floor(first.timestamp.getTime() / 1000));

  const splitIndex = Math.floor(dataset.snapshots.length * args.calibrationFraction);
  const boundary =
    splitIndex > 0 && splitIndex < dataset.snapshots.length
      ? dataset.snapshots[splitIndex]!.timestamp
      : last.timestamp;

  return {
    version: args.version,
    dataset: {
      startDate: first.timestamp,
      endDate: last.timestamp,
      snapshotCadenceMinutes: medianCadenceMinutes(dataset),
      marketIds,
    },
    calibrationWindows: [
      {
        startDate: first.timestamp,
        endDate: boundary,
        heldOutStart: boundary,
        heldOutEnd: last.timestamp,
      },
    ],
    vaultTiers: args.tiers.map((t) => t.toString()),
    markets: Object.fromEntries(
      marketIds.map((id) => [
        id,
        {
          adapters: [id],
          coldStartDays: 0,
          minObservations: args.artifact.minObservations,
        },
      ]),
    ),
    policies: {
      baselines: REGISTERED_BASELINES.map((p) => p.id),
      ablations: REGISTERED_ABLATIONS.map((p) => p.id),
      srcla: true,
    },
    // The three scalars are the observation in force at the run's FIRST
    // origin. When the run used a measured series they under-describe it by
    // construction, so `measuredSeries` carries its digest and range -- the
    // dataset hash covers snapshots and withdrawals only, and a swapped gas
    // series would otherwise be invisible while changing every cost-gate
    // decision.
    costs: {
      l2GasPrice: firstGas.l2BaseFeeWei.toString(),
      l1GasPrice: firstGas.l1BaseFeeWei.toString(),
      ethPrice: firstGas.ethUsdE8.toString(),
      slippageBps: DEFAULT_DECIDE_OPTS.cost.slippageBps,
      mevBps: DEFAULT_DECIDE_OPTS.cost.mevBps,
      ...(isGasSeries(args.config.gas)
        ? { measuredSeries: { digest: args.config.gas.digest, ...args.config.gas.summary } }
        : {}),
    },
    codeCommit: args.codeCommit,
  };
}

/** Median gap between consecutive snapshots, in whole minutes (>= 1). */
export function medianCadenceMinutes(dataset: EvaluationDataset): number {
  const gaps: number[] = [];
  for (let i = 1; i < dataset.snapshots.length; i++) {
    const dt =
      dataset.snapshots[i]!.timestamp.getTime() - dataset.snapshots[i - 1]!.timestamp.getTime();
    if (dt > 0) gaps.push(dt);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)]!;
  return Math.max(1, Math.round(mid / 60_000));
}
