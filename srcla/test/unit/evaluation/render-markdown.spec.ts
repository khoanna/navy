/**
 * The report must not be able to under-state what it is reporting.
 *
 * These assert the DISCLOSURES, not the layout: a renderer that drops the
 * era table, the withdrawal-source caveat, the NOT PRODUCED distinction or
 * the inert-ablation marking produces a document that reads as stronger
 * evidence than the run supports, which is the specific failure the previous
 * SRCLA-REPORT.md exhibited.
 */
import { renderReport, type RunSummary } from '../../../src/evaluation/report/render-markdown.js';
import type { RegisteredGateResult } from '../../../src/evaluation/kernel/gates.js';
import type { RegisteredEvaluationResult } from '../../../src/evaluation/kernel/harness.js';

function fakeRun(era: 'heldout-c' | 'heldout-b', pass: boolean): RunSummary {
  const evaluation = {
    results: [
      {
        policy: { id: 'srcla', section: '§8', deployable: true, disable: {} },
        tier: 1_000_000_000_000n,
        rebalances: 12,
        inertVsSrcla: false,
        replay: {
          realizedNetApy: 0.0421,
          totalCosts: 1_234_000n,
          totalTurnover: 890_000_000_000n,
          withdrawalSuccessRate: 1,
          minStressedLiquidCoverage: 1,
          coverageDistribution: { min: 1, p05: 1, median: 1 },
          withdrawals: [],
          snapshots: [],
        },
      },
      {
        policy: { id: 'h5', section: '§11.3', deployable: false, disable: {} },
        tier: 1_000_000_000_000n,
        rebalances: 12,
        inertVsSrcla: true,
        replay: {
          realizedNetApy: 0.0421,
          totalCosts: 1_234_000n,
          totalTurnover: 890_000_000_000n,
          withdrawalSuccessRate: null,
          minStressedLiquidCoverage: 1,
          coverageDistribution: { min: 1, p05: 1, median: 1 },
          withdrawals: [],
          snapshots: [],
        },
      },
    ],
    withdrawalSource: 'registered-schedule',
    artifact: { artifactHash: 'abc' },
    provisional: false,
    missingPolicyIds: [],
    missingTiers: [],
  } as unknown as RegisteredEvaluationResult;

  const gate = {
    pass,
    checks: [
      { name: 'Calibrated artifact', passed: true, detail: 'abc' },
      { name: '§11.1 pinned-prestate fork replay', passed: null, detail: 'NOT PRODUCED: no fork replay' },
    ],
    comparisons: [],
    blockedReasons: pass ? [] : ['§11.1 pinned-prestate fork replay'],
  } as unknown as RegisteredGateResult;

  return {
    era,
    evaluation,
    gate,
    datasetOrigins: 6400,
    provenance: {
      codeCommit: 'deadbeef',
      manifestHash: 'm1',
      datasetHash: 'd1',
      resultHash: 'r1',
      gasSeriesDigest: '0xgas',
    },
  };
}

const params = {
  generatedAt: '2026-09-08T00:00:00.000Z',
  runs: [fakeRun('heldout-c', false), fakeRun('heldout-b', false)],
  notObserved: ['dependency group registry (id, capBps, absoluteCapBase, members)'],
  artifactSummary: {
    hash: 'abc',
    method: 'rolling',
    horizonDays: 14,
    coverageTarget: 0.95,
    noTradeBandK: 1,
    noTradeBandKResolved: false,
    calibrationEra: { start: '2024-09-01T00:00:00.000Z', end: '2025-08-31T23:59:59.000Z', days: 365 },
    perVenueCoverage: { 'aave-v3-usdc': 0.95, 'compound-v3-usdc': 0.95 },
  },
};

describe('renderReport — mandatory disclosures', () => {
  const md = renderReport(params);

  it('leads with the verdict, and says a FAIL is a result', () => {
    expect(md.indexOf('## Verdict')).toBeLessThan(md.indexOf('## Results'));
    expect(md).toMatch(/A `FAIL` here is a result, not an error/);
  });

  it('prints the era table with every registered era and marks the sealed ones', () => {
    for (const era of ['calibration', 'heldout-c', 'burned', 'heldout-b']) {
      expect(md).toContain(`\`${era}\``);
    }
    expect(md).toMatch(/\*\*sealed\*\*/);
  });

  it('states BOTH disclosed era deviations', () => {
    expect(md).toMatch(/lies in \*\*neither\*\* era/);
    expect(md).toMatch(/Held-out A \*\*precedes\*\* the burned window/);
    expect(md).toMatch(/A for statistical power, B for temporal purity/);
  });

  it('says withdrawals are a registered schedule, not observed', () => {
    expect(md).toMatch(/registered-schedule/);
    expect(md).toMatch(/no claim in this report is\s+evidence about real user redemption behaviour/i);
  });

  it('lists every surviving NOT_OBSERVED entry and says gas is no longer among them', () => {
    expect(md).toContain('dependency group registry');
    expect(md).toMatch(/Gas and oracle observations are \*\*no longer\*\* on this list/);
    expect(md).toContain('0xgas');
  });

  it('says plainly when P8 k did NOT resolve', () => {
    expect(md).toMatch(/\*\*P8's `k` did not resolve\.\*\*/);
    expect(md).toMatch(/chosen because it moves a gate would not be a registration/);
  });

  it('distinguishes NOT PRODUCED from FAIL in the gate table', () => {
    expect(md).toContain('**NOT PRODUCED**');
    expect(md).toContain('§11.1 pinned-prestate fork replay');
  });

  it('marks an INERT ablation rather than reporting its delta as a contribution', () => {
    expect(md).toContain('**INERT**');
    expect(md).toMatch(/attributing it\s+to the removed component would be a misattribution/);
  });

  it('marks an unmeasured withdrawal rate rather than printing a number for it', () => {
    expect(md).toContain('**not measured**');
  });

  it('reports every run it was given, not only the best one', () => {
    expect(md).toContain('## Results — era `heldout-c`');
    expect(md).toContain('## Results — era `heldout-b`');
  });

  it('carries the provenance a reader needs to reproduce it', () => {
    expect(md).toContain('deadbeef');
    expect(md).toContain('evaluation:verify');
    expect(md).toContain('pnpm backfill:history');
  });

  it('says a coverage figure for every venue the artifact calibrated', () => {
    expect(md).toContain('aave-v3-usdc');
    expect(md).toContain('95.00%');
  });

  it('refuses to render with no run at all', () => {
    expect(() => renderReport({ ...params, runs: [] })).toThrow(/no run to report/i);
  });
});

describe('renderReport — a passing run', () => {
  it('does not print a blocked-reasons clause when the gate passed', () => {
    const md = renderReport({ ...params, runs: [fakeRun('heldout-c', true)] });
    expect(md).toMatch(/release gate \*\*PASS\*\*/);
    expect(md).not.toMatch(/PASS\*\* — blocked on/);
  });
});
