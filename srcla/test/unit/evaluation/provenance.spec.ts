/**
 * The run record: result hash, manifest hash, code commit, dataset hash
 * (paper §2.2, §7.3, §11.1, Appendix C).
 *
 * The repo previously computed NO result hash anywhere, so a published
 * figure could be edited after the fact and nothing would notice. These
 * tests are written so that reverting any part of that — dropping a field
 * from the hashed payload, letting an unchecked leg count as a pass,
 * accepting an unrecorded commit — makes one of them fail.
 */
import {
  buildRunRecord,
  computeResultHash,
  hashableResults,
  manifestConfigForRun,
  medianCadenceMinutes,
  verifyRunRecord,
  type EvaluationRunRecord,
} from '../../../src/evaluation/kernel/provenance.js';
import {
  generateManifest,
  signManifest,
  type DatasetObservations,
} from '../../../src/evaluation/manifest/generator.js';
import type { RegisteredEvaluationResult, PolicyRunResult } from '../../../src/evaluation/kernel/harness.js';
import { SRCLA_POLICY, REGISTERED_BASELINES } from '../../../src/evaluation/kernel/registry.js';
import type { EvaluationDataset, TimeOrderedSnapshot } from '../../../src/evaluation/dataset.js';
import type { MarketSnapshot } from '../../../src/domain/snapshots.js';
import type { PolicyArtifact } from '../../../src/policy/types.js';
import type { HarnessConfig } from '../../../src/evaluation/kernel/decision-input.js';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

function market(marketId: string, timestamp: Date): MarketSnapshot {
  return {
    marketId,
    blockHash: '0x' + 'b'.repeat(64),
    timestamp,
    totalAssetsBase: 1_000_000_000_000n,
    idleBase: 100_000_000_000n,
    supplyRateE18: 50_000_000_000_000_000n,
    utilizationE18: 800_000_000_000_000_000n,
    cashBase: 200_000_000_000n,
    borrowsBase: 800_000_000_000n,
    reservesBase: 10_000_000_000n,
    capBps: 5000,
    paused: false,
    configDigest: '0x' + 'a'.repeat(64),
  };
}

/** `count` daily snapshots over two markets. */
function dataset(count = 10, stepMs = 86_400_000): EvaluationDataset {
  const snapshots: TimeOrderedSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(Date.UTC(2026, 5, 1) + i * stepMs);
    snapshots.push({
      index: i,
      timestamp,
      blockHash: '0x' + i.toString(16).padStart(64, '0'),
      snapshots: [market('aave', timestamp), market('compound', timestamp)],
    });
  }
  return { manifestId: 'registered', snapshots, labels: [], withdrawals: [] };
}

function observations(d: EvaluationDataset = dataset()): DatasetObservations {
  return { snapshots: d.snapshots, withdrawals: d.withdrawals ?? [] };
}

function artifact(): PolicyArtifact {
  return {
    artifactHash: '0xartifact',
    policyVersion: 1,
    horizonSeconds: 604_800,
    coverageTarget: 0.95,
    method: 'ew-residual',
    methodParams: {},
    residualQuantileWadByMarket: {},
    portfolioResidualQuantileWad: -1n * 10n ** 13n,
    minObservations: 30,
    availabilityLagSeconds: 900,
    noTradeBandK: 1,
    configDigest: '0xcfg',
    pinnedConfigDigests: {},
  } as PolicyArtifact;
}

function harnessConfig(): HarnessConfig {
  return {
    vault: { adminReserveBase: 0n, minIdleBps: 500, configurationDigest: '0x' + '00'.repeat(32) },
    markets: {},
    defaultMarket: { capBps: 5000, absoluteCapBase: 10n ** 15n, maxLossBps: 50, dependencyGroupIds: [] },
    dependencyGroups: [],
    gas: {
      l2BaseFeeWei: 30_000_000n,
      l1BaseFeeWei: 8_000_000_000n,
      l1BlobBaseFeeWei: 10_000_000n,
      ethUsdE8: 350_000_000_000n,
      usdcUsdE8: 100_000_000n,
    },
    horizonSeconds: 604_800,
    availabilityLagSeconds: 900,
  };
}

function row(policyId: string, tier: bigint, apy: number): PolicyRunResult {
  const policy =
    policyId === SRCLA_POLICY.id
      ? SRCLA_POLICY
      : REGISTERED_BASELINES.find((p) => p.id === policyId) ?? SRCLA_POLICY;
  return {
    policy,
    tier,
    decisionHashes: [`0xdecision-${policyId}-0`],
    rebalances: 2,
    inertVsSrcla: false,
    replay: {
      policyId,
      tier,
      cohortId: `tier-${tier}`,
      snapshots: [
        {
          timestamp: new Date(Date.UTC(2026, 5, 1)),
          totalAssets: tier,
          totalShares: tier,
          sharePriceWad: 10n ** 18n,
          totalReturn: 0,
          idleBase: tier,
          stressedLiquidCoverage: 1,
        },
        {
          timestamp: new Date(Date.UTC(2026, 5, 2)),
          totalAssets: tier,
          totalShares: tier,
          sharePriceWad: 10n ** 18n + 5n * 10n ** 14n,
          totalReturn: 0.0005,
          idleBase: tier,
          stressedLiquidCoverage: 1,
        },
      ],
      realizedNetApy: apy,
      totalTurnover: 1_000_000n,
      withdrawalSuccessRate: 1,
      withdrawals: [
        {
          snapshotIndex: 1,
          requestedBase: 500_000n,
          grantedBase: 500_000n,
          success: true,
          reason: 'FILLED',
          divestedFrom: [],
        },
      ],
      totalCosts: 12_345n,
      minStressedLiquidCoverage: 1,
    },
  } as PolicyRunResult;
}

function evaluation(overrides: Partial<RegisteredEvaluationResult> = {}): RegisteredEvaluationResult {
  return {
    results: [row('srcla', 10_000_000_000n, 0.041), row('b0', 10_000_000_000n, 0.0)],
    withdrawalSource: 'registered-schedule',
    artifact: artifact(),
    provisional: true,
    missingPolicyIds: [],
    missingTiers: [],
    ...overrides,
  };
}

function manifestFor(d: EvaluationDataset = dataset()) {
  return signManifest(
    generateManifest(
      manifestConfigForRun({
        version: '1.0.0',
        dataset: d,
        tiers: [10_000_000_000n, 100_000_000_000n],
        artifact: artifact(),
        config: harnessConfig(),
        calibrationFraction: 0.7,
        codeCommit: COMMIT,
      }),
    ),
    observations(d),
  );
}

function record(overrides: Partial<RegisteredEvaluationResult> = {}): EvaluationRunRecord {
  return buildRunRecord({
    codeCommit: COMMIT,
    manifest: manifestFor(),
    evaluation: evaluation(overrides),
    runAt: new Date('2026-09-08T12:00:00.000Z'),
  });
}

describe('computeResultHash', () => {
  it('is stable across two hashings of the same results', () => {
    expect(computeResultHash(hashableResults(evaluation()))).toBe(
      computeResultHash(hashableResults(evaluation())),
    );
  });

  it('does not depend on the order the harness produced rows in', () => {
    const forward = evaluation();
    const reversed = evaluation({ results: [...forward.results].reverse() });

    expect(computeResultHash(hashableResults(reversed))).toBe(
      computeResultHash(hashableResults(forward)),
    );
  });

  // Each of these is a figure a reader would cite. Dropping any one from the
  // hashed payload would leave it editable after publication.
  it.each([
    ['realizedNetApy', (e: RegisteredEvaluationResult) => { e.results[0]!.replay.realizedNetApy = 0.99; }],
    ['totalCosts', (e: RegisteredEvaluationResult) => { e.results[0]!.replay.totalCosts += 1n; }],
    ['totalTurnover', (e: RegisteredEvaluationResult) => { e.results[0]!.replay.totalTurnover += 1n; }],
    ['rebalances', (e: RegisteredEvaluationResult) => { e.results[0]!.rebalances += 1; }],
    ['withdrawalSuccessRate', (e: RegisteredEvaluationResult) => { e.results[0]!.replay.withdrawalSuccessRate = 0.5; }],
    ['minStressedLiquidCoverage', (e: RegisteredEvaluationResult) => { e.results[0]!.replay.minStressedLiquidCoverage = 0.2; }],
    ['inertVsSrcla', (e: RegisteredEvaluationResult) => { e.results[0]!.inertVsSrcla = true; }],
    ['a decision hash', (e: RegisteredEvaluationResult) => { e.results[0]!.decisionHashes[0] = '0xother'; }],
    ['a share price', (e: RegisteredEvaluationResult) => { e.results[0]!.replay.snapshots[1]!.sharePriceWad += 1n; }],
    ['the artifact hash', (e: RegisteredEvaluationResult) => { e.artifact = { ...e.artifact, artifactHash: '0xother' }; }],
    ['the provisional flag', (e: RegisteredEvaluationResult) => { e.provisional = false; }],
    ['the withdrawal source', (e: RegisteredEvaluationResult) => { e.withdrawalSource = 'observed'; }],
    ['a missing tier', (e: RegisteredEvaluationResult) => { e.missingTiers = [10_000_000_000_000n]; }],
    ['a missing policy', (e: RegisteredEvaluationResult) => { e.missingPolicyIds = ['h7']; }],
  ])('changes when %s changes', (_name, mutate) => {
    const base = computeResultHash(hashableResults(evaluation()));
    const changed = evaluation();
    mutate(changed);

    expect(computeResultHash(hashableResults(changed))).not.toBe(base);
  });

  it('preserves an unmeasured withdrawal rate as null rather than coercing it to a number', () => {
    const e = evaluation();
    e.results[0]!.replay.withdrawalSuccessRate = null;

    expect(hashableResults(e).results.find((r) => r.policyId === 'srcla')!.withdrawalSuccessRate).toBeNull();
  });
});

describe('buildRunRecord', () => {
  it('records the commit, the manifest and a result hash', () => {
    const r = record();

    expect(r.codeCommit).toBe(COMMIT);
    expect(r.resultHash).toHaveLength(64);
    expect(r.manifest.contentHashes.manifest).toHaveLength(64);
  });

  it('leaves the wall clock out of every hash', () => {
    const a = buildRunRecord({
      codeCommit: COMMIT,
      manifest: manifestFor(),
      evaluation: evaluation(),
      runAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const b = buildRunRecord({
      codeCommit: COMMIT,
      manifest: manifestFor(),
      evaluation: evaluation(),
      runAt: new Date('2027-01-01T00:00:00.000Z'),
    });

    expect(b.resultHash).toBe(a.resultHash);
    expect(b.manifest.contentHashes.manifest).toBe(a.manifest.contentHashes.manifest);
    expect(b.runAt).not.toBe(a.runAt);
  });

  it.each([['', 'empty'], ['unknown', 'the unknown sentinel']])(
    'refuses to build a record when the commit is %s (%s)',
    (commit) => {
      expect(() =>
        buildRunRecord({ codeCommit: commit, manifest: manifestFor(), evaluation: evaluation() }),
      ).toThrow(/code commit/);
    },
  );
});

describe('verifyRunRecord', () => {
  it('verifies a record against the data and the commit that produced it', async () => {
    const report = await verifyRunRecord(record(), {
      observations: observations(),
      currentCommit: COMMIT,
    });

    expect(report.checks.filter((c) => c.passed !== true)).toEqual([]);
    expect(report.verified).toBe(true);
  });

  // The whole point of a result hash.
  it('detects an edited result', async () => {
    const r = record();
    r.results.results[0]!.realizedNetApy = 0.42;

    const report = await verifyRunRecord(r, { observations: observations(), currentCommit: COMMIT });

    expect(report.verified).toBe(false);
    expect(report.checks.find((c) => c.name === 'Result hash')!.passed).toBe(false);
  });

  it('detects a stripped result hash, and says it is MISSING rather than mismatched', async () => {
    const r = record();
    (r as { resultHash: string }).resultHash = '';

    const check = (
      await verifyRunRecord(r, { observations: observations(), currentCommit: COMMIT })
    ).checks.find((c) => c.name === 'Result hash')!;

    expect(check.passed).toBe(false);
    // An absent hash and a wrong hash are different failures; reporting the
    // second for the first sends a reader looking for a tamper that is not
    // there.
    expect(check.detail).toBe('record carries no result hash');
  });

  it('detects an unsigned manifest', async () => {
    const r = record();
    r.manifest.contentHashes.manifest = '';

    const report = await verifyRunRecord(r, { observations: observations(), currentCommit: COMMIT });

    expect(report.checks.find((c) => c.name === 'Manifest hash')!.passed).toBe(false);
  });

  it('detects a dataset that is not the one the manifest pinned', async () => {
    const other = dataset();
    other.snapshots[3]!.snapshots[0]!.supplyRateE18 += 1n;

    const report = await verifyRunRecord(record(), {
      observations: observations(other),
      currentCommit: COMMIT,
    });

    expect(report.verified).toBe(false);
    expect(report.checks.find((c) => c.name === 'Dataset hash')!.passed).toBe(false);
  });

  it('fails when the verifying tree is at a different commit', async () => {
    const report = await verifyRunRecord(record(), {
      observations: observations(),
      currentCommit: 'ffffffffffffffffffffffffffffffffffffffff',
    });

    expect(report.verified).toBe(false);
    expect(report.checks.find((c) => c.name === 'Code commit')!.passed).toBe(false);
  });

  it('rejects a record shape it does not know', async () => {
    const r = record();
    (r as { recordVersion: number }).recordVersion = 2;

    const report = await verifyRunRecord(r, { observations: observations(), currentCommit: COMMIT });

    expect(report.checks.find((c) => c.name === 'Record schema')!.passed).toBe(false);
  });

  // ABSENCE IS NOT SUCCESS. A leg that was not run is `null`, and `null` must
  // not roll up into `verified: true`.
  it('reports an unchecked dataset leg as NOT CHECKED and does not verify', async () => {
    const report = await verifyRunRecord(record(), { currentCommit: COMMIT });

    expect(report.checks.find((c) => c.name === 'Dataset hash')!.passed).toBeNull();
    expect(report.verified).toBe(false);
  });

  it('reports an unchecked commit leg as NOT CHECKED and does not verify', async () => {
    const report = await verifyRunRecord(record(), { observations: observations() });

    expect(report.checks.find((c) => c.name === 'Code commit')!.passed).toBeNull();
    expect(report.verified).toBe(false);
  });

  it('does not verify when nothing at all was supplied', async () => {
    expect((await verifyRunRecord(record())).verified).toBe(false);
  });
});

describe('manifestConfigForRun', () => {
  it('derives the window and market set from the dataset the run used', () => {
    const config = manifestConfigForRun({
      version: '1.0.0',
      dataset: dataset(),
      tiers: [10_000_000_000n, 100_000_000_000n],
      artifact: artifact(),
      config: harnessConfig(),
      calibrationFraction: 0.7,
      codeCommit: COMMIT,
    });

    expect(config.dataset.startDate.toISOString()).toBe(new Date(Date.UTC(2026, 5, 1)).toISOString());
    expect(config.dataset.marketIds).toEqual(['aave', 'compound']);
    expect(config.vaultTiers).toEqual(['10000000000', '100000000000']);
    expect(config.codeCommit).toBe(COMMIT);
  });

  it('records the registered policy set including B2u, H6 and H7', () => {
    const config = manifestConfigForRun({
      version: '1.0.0',
      dataset: dataset(),
      tiers: [10_000_000_000n],
      artifact: artifact(),
      config: harnessConfig(),
      calibrationFraction: 0.7,
      codeCommit: COMMIT,
    });

    expect(config.policies.baselines).toContain('b2u');
    expect(config.policies.ablations).toEqual(expect.arrayContaining(['h6', 'h7']));
  });

  it('records the MEASURED snapshot cadence, not a declared constant', () => {
    // `config/evaluation-manifest.json` declares a cadence by hand; a
    // hand-declared one drifts from the series it describes. Two datasets
    // with different real cadences must produce different manifests.
    const cadence = (stepMs: number): number =>
      manifestConfigForRun({
        version: '1.0.0',
        dataset: dataset(6, stepMs),
        tiers: [10_000_000_000n],
        artifact: artifact(),
        config: harnessConfig(),
        calibrationFraction: 0.7,
        codeCommit: COMMIT,
      }).dataset.snapshotCadenceMinutes;

    expect(cadence(900_000)).toBe(15);
    expect(cadence(3_600_000)).toBe(60);
  });

  it('places the held-out boundary exactly at the calibration split', () => {
    const d = dataset(10);
    const config = manifestConfigForRun({
      version: '1.0.0',
      dataset: d,
      tiers: [10_000_000_000n],
      artifact: artifact(),
      config: harnessConfig(),
      calibrationFraction: 0.7,
      codeCommit: COMMIT,
    });
    const w = config.calibrationWindows[0]!;

    expect(w.heldOutStart.getTime()).toBe(w.endDate.getTime());
    expect(w.endDate.toISOString()).toBe(d.snapshots[7]!.timestamp.toISOString());
  });

  it('refuses to describe an empty dataset', () => {
    expect(() =>
      manifestConfigForRun({
        version: '1.0.0',
        dataset: { manifestId: 'x', snapshots: [], labels: [] },
        tiers: [10_000_000_000n],
        artifact: artifact(),
        config: harnessConfig(),
        calibrationFraction: 0.7,
        codeCommit: COMMIT,
      }),
    ).toThrow(/no snapshots/);
  });
});

describe('medianCadenceMinutes', () => {
  it('measures the cadence rather than declaring it', () => {
    expect(medianCadenceMinutes(dataset(5, 900_000))).toBe(15);
    expect(medianCadenceMinutes(dataset(5, 3_600_000))).toBe(60);
  });

  it('is robust to a single gap in the series', () => {
    const d = dataset(6, 900_000);
    d.snapshots[3]!.timestamp = new Date(d.snapshots[3]!.timestamp.getTime() + 10 * 3_600_000);

    expect(medianCadenceMinutes(d)).toBe(15);
  });

  it('reports 0 when there is no gap to measure', () => {
    expect(medianCadenceMinutes(dataset(1))).toBe(0);
  });
});
