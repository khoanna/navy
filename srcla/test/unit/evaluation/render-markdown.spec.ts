/**
 * The report must not be able to under-state what it is reporting.
 *
 * These assert the DISCLOSURES, not the layout: a renderer that drops the
 * era table, the withdrawal-source caveat, the NOT PRODUCED distinction or
 * the inert-ablation marking produces a document that reads as stronger
 * evidence than the run supports, which is the specific failure the previous
 * SRCLA-REPORT.md exhibited.
 */
import {
  renderReport,
  threeVerdicts,
  type RunSummary,
} from '../../../src/evaluation/report/render-markdown.js';
import { eraBounds } from '../../../src/evaluation/eras.js';
import type { RegisteredGateResult } from '../../../src/evaluation/kernel/gates.js';
import type { RegisteredEvaluationResult } from '../../../src/evaluation/kernel/harness.js';
import type { ForecastGateResult } from '../../../src/evaluation/kernel/forecast-gate.js';

/** §11.5's forecast gate, as the run record carries it. */
function fakeForecastGate(pass: boolean): ForecastGateResult {
  return pass
    ? {
        pass: true,
        checks: [
          {
            name: 'Per-venue coverage — aave-v3-usdc',
            passed: true,
            detail: 'achieved 99.04% against target 99.00%',
            gating: true,
          },
        ],
        blockedReasons: [],
        venues: [
          {
            marketId: 'aave-v3-usdc',
            observations: 870,
            achievedCoverage: 0.9904,
            exceedances: 8,
            kupiec: { lr: 0.02, pValue: 0.88 },
            christoffersen: { lrCc: 0.5, lrInd: 0.1, pValue: 0.78, observations: 36 },
          },
        ],
      }
    : {
        pass: false,
        checks: [
          {
            name: 'Selection margin',
            passed: false,
            detail: 'margin 1.2740e-7 against the registered floor 1e-3',
            gating: true,
          },
        ],
        blockedReasons: ['Selection margin'],
        venues: [],
      };
}

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
          timeToFullExitOrigins: 4,
          timeToFullExitCensored: false,
          venueStressContribution: { 'compound-v3-usdc': 0.12 },
          displayedVsRealizedGapApy: 0.0123,
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
          timeToFullExitOrigins: 4,
          timeToFullExitCensored: false,
          venueStressContribution: { 'compound-v3-usdc': 0.12 },
          displayedVsRealizedGapApy: 0.0123,
          withdrawals: [],
          snapshots: [],
        },
      },
      // h3 "removes the complete-cost gate and the no-trade band" and here
      // OUTPERFORMS srcla (0.0755 > 0.0421) — a clearly NEGATIVE contribution
      // (contribution = 0.0421 - 0.0755 = -3.34pp), i.e. removing the cost
      // gate helped on this fixture. Exercises the negative-contribution
      // callout.
      {
        policy: { id: 'h3', section: '§11.3', deployable: true, disable: {} },
        tier: 1_000_000_000_000n,
        rebalances: 288,
        inertVsSrcla: false,
        replay: {
          realizedNetApy: 0.0755,
          totalCosts: 9_876_000n,
          totalTurnover: 12_340_000_000_000n,
          withdrawalSuccessRate: 1,
          minStressedLiquidCoverage: 1,
          coverageDistribution: { min: 1, p05: 1, median: 1 },
          timeToFullExitOrigins: 4,
          timeToFullExitCensored: false,
          venueStressContribution: { 'compound-v3-usdc': 0.12 },
          displayedVsRealizedGapApy: 0.0123,
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
    forecastGate: fakeForecastGate(pass),
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

const provenance = {
  chainId: 8453,
  multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  gasOracleAddress: '0x420000000000000000000000000000000000000F',
  ethUsdFeedAddress: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  usdcUsdFeedAddress: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  usdcDecimals: 6,
  eras: [
    {
      era: 'calibration' as const,
      firstDate: '2024-03-15',
      lastDate: '2025-05-31',
      firstBlock: '11707031',
      lastBlock: '19999999',
      origins: 10632,
      days: 443,
      sealed: false,
    },
    {
      era: 'heldout-c' as const,
      firstDate: '2026-03-01',
      lastDate: '2026-05-25',
      firstBlock: '25000000',
      lastBlock: '26234567',
      origins: 2064,
      days: 86,
      sealed: true,
    },
    {
      era: 'heldout-b' as const,
      firstDate: '2026-08-24',
      lastDate: '2026-09-08',
      firstBlock: '27000000',
      lastBlock: '27123456',
      origins: 384,
      sealed: true,
      days: 16,
    },
  ],
  venues: [
    {
      marketId: 'aave-v3-usdc',
      displayName: 'Aave V3 Pool',
      address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      apyMin: 0.021,
      apyMean: 0.034,
      apyMax: 0.051,
      configRegimes: 3,
      irmContracts: 1,
    },
    {
      marketId: 'compound-v3-usdc',
      displayName: 'Compound III Comet',
      address: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
      apyMin: 0.018,
      apyMean: 0.029,
      apyMax: 0.047,
      configRegimes: 2,
      irmContracts: 1,
    },
    {
      marketId: 'moonwell-usdc',
      displayName: 'Moonwell mUSDC',
      address: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
      apyMin: 0.015,
      apyMean: 0.026,
      apyMax: 0.044,
      configRegimes: 4,
      irmContracts: 2,
    },
  ],
  costByEra: [
    {
      era: 'heldout-c' as const,
      observations: 2064,
      l2BaseFeeMinWei: '714160',
      l2BaseFeeMaxWei: '3869277',
      l1BaseFeeMinWei: '10000000',
      l1BaseFeeMaxWei: '55000000',
      ethUsdMinE8: '245000000000',
      ethUsdMaxE8: '429000000000',
      usdcUsdMinE8: '99980000',
      usdcUsdMaxE8: '100020000',
      gasSeriesDigest: '0xgas',
    },
    {
      era: 'heldout-b' as const,
      observations: 384,
      l2BaseFeeMinWei: '800000',
      l2BaseFeeMaxWei: '2900000',
      l1BaseFeeMinWei: '12000000',
      l1BaseFeeMaxWei: '40000000',
      ethUsdMinE8: '250000000000',
      ethUsdMaxE8: '410000000000',
      usdcUsdMinE8: '99990000',
      usdcUsdMaxE8: '100010000',
      gasSeriesDigest: '0xgas2',
    },
  ],
};

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
  provenance,
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

  // FINAL-REVIEW FIX 1. The role column used to be `e.role.split('.')[0]`,
  // meant as "the first sentence". `heldout-c`'s role opens `v0.6 VALIDATION
  // era...`, so the split landed inside the version string and the published
  // report gave that era's role as the literal text `v0.` — silently deleting
  // the "LESS BURNED, NOT PRISTINE" caveat the plan REQUIRED it to surface.
  it('prints each era\u2019s FULL role, including heldout-c\u2019s LESS BURNED caveat', () => {
    expect(md).toMatch(/less burned, not pristine/i);
    expect(md).toContain('see disclosure 3');
    // The other roles survive whole too, not just the one with the caveat.
    expect(md).toContain('The ONLY data any artifact, quantile, grid point or no-trade band may be fit on.');
    expect(md).toContain('Paper \u00a74.1 DESIGN DATA.');
    // Regression guard: restoring `split('.')[0]` renders `heldout-c`'s role
    // as the bare stub `v0` (as a table cell, `v0.`). Both shapes must fail
    // here if the truncation ever comes back.
    const heldoutCRole = md
      .split('\n')
      .find((l) => l.includes('`heldout-c` \u2014'))!
      .replace('- `heldout-c` \u2014 ', '');
    expect(heldoutCRole).not.toMatch(/^v0\.?$/);
    expect(md).not.toMatch(/\bv0\.\s*\|/); // the table-cell variant
    expect(md).not.toMatch(/\u2014\s*v0\.?\s*$/m); // the list variant
  });

  // FINAL-REVIEW FIX 2. `heldout-b` ends at the OPEN_ENDED sentinel
  // (2099-12-31), so `eraBounds` reported a 26,793-day era. A sentinel must
  // never reach a published document.
  it('reports an open-ended era as open rather than leaking the 2099 sentinel', () => {
    expect(md).not.toContain('2099');
    expect(md).not.toContain('26793');
    expect(md).not.toContain('26,793');
    // P37 closed heldout-b at P37_FREEZE_SECONDS; heldout-d is the open-ended era now.
    expect(md).toMatch(/\| `heldout-d` \| \d{4}-\d{2}-\d{2} \| open \| open \|/);
    const b = eraBounds('heldout-b');
    expect(md).toContain(`| \`heldout-b\` | 2026-08-24 | ${b.end.slice(0, 10)} | ${b.days} |`);
    // The Verdict heading for that era prints its real span, never a sentinel.
    expect(md).toContain(`\`heldout-b\` — ${b.days}d,`);
  });

  // v0.6 re-cut the eras. This test previously PINNED the v0.5 text, so it
  // required the report to keep publishing claims about `heldout-a` -- an era
  // `eras.ts` no longer defines -- including the assertion that nobody had
  // looked at Sep 2025 - May 2026, which reading v0.5's diagnosis made false.
  // A test that pins prose is only as honest as the prose it pinned, so this
  // one now also asserts the retired claims are GONE.
  it('states all THREE disclosed era deviations against the v0.6 era set', () => {
    expect(md).toMatch(/\*\*Three deviations are disclosed, not buried:\*\*/);
    expect(md).toMatch(/lies in \*\*neither\*\* era/);
    expect(md).toMatch(/`heldout-c` \(Mar–May 2026\) \*\*precedes\*\* the burned window/);
    expect(md).toMatch(/`heldout-c` for what statistical power exists/);
    expect(md).toMatch(/`heldout-b` for temporal purity/);
    expect(md).toMatch(/`heldout-c` is \*\*less burned, not pristine\.\*\*/);
  });

  it('no longer publishes the retired v0.5 held-out-A claims', () => {
    // `heldout-a` does not exist in eras.ts; and the era it covered was read
    // while diagnosing v0.5, so "nobody has looked at" it is now untrue.
    expect(md).not.toMatch(/Nobody has looked at/i);
    expect(md).not.toMatch(/Held-out A \*\*precedes\*\*/);
    expect(md).not.toMatch(/A for statistical power, B for temporal purity/);
    expect(md).not.toMatch(/Two deviations are disclosed/);
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

  // FINAL-REVIEW FIX 3. `.slice(0, 300)` cut a gate detail mid-token with no
  // marker at all, so a reader could not tell anything had been dropped.
  it('marks a truncated gate detail with an ellipsis and does not cut mid-word', () => {
    const long = `${'liquiditycheck '.repeat(80)}TRAILING`;
    const longDetailRun: RunSummary = {
      ...fakeRun('heldout-c', false),
      gate: {
        pass: false,
        checks: [
          { name: 'Long detail', passed: false, detail: long },
          { name: 'Short detail', passed: true, detail: 'all four tiers ran' },
        ],
        comparisons: [],
        blockedReasons: ['Long detail'],
      } as unknown as RegisteredGateResult,
    };
    const rendered = renderReport({ ...params, runs: [longDetailRun] });
    // The gate table carries a Role column (P22 added one REPORTED check, and
    // a reported NOT PRODUCED must not read as a block).
    const prefix = '| **FAIL** | gates | Long detail | ';
    const row = rendered.split('\n').find((l) => l.startsWith(prefix))!;
    expect(row).toBeDefined();
    expect(row).toMatch(/\u2026 \|$/);
    // Cut back to a word boundary: the last surviving token is WHOLE, not a
    // prefix of one. Every token in the fixture is the same 14-char word, so
    // a mid-word cut would leave a shorter fragment here.
    const shown = row.slice(prefix.length, -' |'.length).slice(0, -1);
    expect(shown.split(' ').every((t) => t === 'liquiditycheck')).toBe(true);
    // More than the old 300-char cap survives, and the tail is still dropped.
    expect(row.length).toBeGreaterThan(400);
    expect(row).not.toContain('TRAILING');
    // A short detail is untouched and gains no ellipsis.
    expect(rendered).toContain('| PASS | gates | Short detail | all four tiers ran |');
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

  it('places dataset and provenance before the results', () => {
    expect(md.indexOf('## Dataset and provenance')).toBeGreaterThan(-1);
    expect(md.indexOf('## Dataset and provenance')).toBeLessThan(md.indexOf('## Results'));
  });

  it('states the chain, chainId and Multicall3 collection method, and the gap policy', () => {
    expect(md).toMatch(/Base mainnet/);
    expect(md).toContain('8453');
    expect(md).toContain('aggregate3');
    expect(md).toContain('0xcA11bde05977b3631167028862bE2a173976CA11');
    expect(md).toMatch(/recorded as a gap and never interpolated/);
  });

  it('prints the measured per-era block range with thousands separators', () => {
    expect(md).toContain('11,707,031');
    expect(md).toContain('19,999,999');
    expect(md).toContain('25,000,000');
    expect(md).toContain('26,234,567');
  });

  it('prints the venue registry with contract addresses and market ids', () => {
    expect(md).toContain('Aave V3 Pool');
    expect(md).toContain('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5');
    expect(md).toContain('aave-v3-usdc');
    expect(md).toContain('Compound III Comet');
    expect(md).toContain('0xb125E6687d4313864e53df431d5425969c15Eb2F');
    expect(md).toContain('Moonwell mUSDC');
    expect(md).toContain('0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22');
    expect(md).toContain('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('shows per-venue observed APY range and regime/IRM-contract counts', () => {
    expect(md).toMatch(/2\.10%/); // aave apyMin
    expect(md).toMatch(/5\.10%/); // aave apyMax
  });

  it('states measured execution-cost inputs and their sources', () => {
    expect(md).toMatch(/GasPriceOracle/);
    expect(md).toContain('0x420000000000000000000000000000000000000F');
    expect(md).toMatch(/Chainlink/);
    expect(md).toContain('0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70');
    expect(md).toContain('0x7e860098F58bBFC8648a4311b374B1D669a2bc6B');
    expect(md).toContain('0xgas');
    expect(md).toContain('0xgas2');
  });

  it('places Ablation contributions after the results table and before the gate table', () => {
    const resultsIdx = md.indexOf('## Results — era `heldout-c`');
    const ablationIdx = md.indexOf('## Ablation contributions');
    // The forecast gate is the FIRST of §11.5's two gate tables.
    const gateIdx = md.indexOf('### §11.5 forecast gate');
    expect(resultsIdx).toBeGreaterThan(-1);
    expect(ablationIdx).toBeGreaterThan(resultsIdx);
    expect(ablationIdx).toBeLessThan(gateIdx);
  });

  it('explains the contribution sign convention in plain terms', () => {
    expect(md).toMatch(/component was earning its keep/);
    expect(md).toMatch(/component cost more than it earned on this data/);
  });

  it('tables the ablation, what it removes, both APYs, the contribution and both rebalance counts', () => {
    expect(md).toContain('`h3`');
    expect(md).toContain('remove the complete-cost gate and the no-trade band');
    expect(md).toMatch(/\|\s*`h3`\s*\|.*\|\s*7\.550%\s*\|/); // h3 (ablation) APY column
    expect(md).toMatch(/\|\s*288\s*\|\s*12\s*\|/); // ablation rebalances (288) next to SRCLA's (12)
  });

  it('marks a NEGATIVE ablation contribution with an explicit, un-missable callout', () => {
    // h3's ablation APY (7.55%) exceeds SRCLA's (4.21%) in the fixture, so
    // removing the cost gate measured as an improvement here.
    expect(md).toMatch(/\*\*Negative contribution: removing the component helped, not hurt\.\*\*/);
    expect(md).toMatch(/`h3`.*contribution \*\*-3\.340 pp\*\*/);
  });

  it('marks the INERT ablation as a construction-zero, not a measured contribution', () => {
    expect(md).toMatch(
      /`h5`.*\*\*INERT\*\* \(identical decisions — not a measured contribution\)/,
    );
  });
});

describe('renderReport — §11.5 has TWO gates', () => {
  it('renders the forecast gate ABOVE the policy gate', () => {
    const md = renderReport({ ...params, runs: [fakeRun('heldout-c', true)] });
    const forecastIdx = md.indexOf('### §11.5 forecast gate');
    const policyIdx = md.indexOf('### §11.5 policy gate');
    expect(forecastIdx).toBeGreaterThan(-1);
    expect(policyIdx).toBeGreaterThan(forecastIdx);
  });

  it('publishes the per-venue calibration behind the forecast gate', () => {
    const md = renderReport({ ...params, runs: [fakeRun('heldout-c', true)] });
    expect(md).toContain('| Venue | Residuals | Achieved coverage |');
    expect(md).toMatch(/\|\s*aave-v3-usdc\s*\|\s*870\s*\|\s*99\.04%\s*\|/);
  });

  it('states a forecast-gate FAIL in the verdict line, separately from the policy gate', () => {
    const md = renderReport({ ...params, runs: [fakeRun('heldout-c', false)] });
    // The gate's own line says FAIL, and every blocked reason is itemised
    // beneath it rather than joined into one unreadable paragraph.
    expect(md).toMatch(/\*\*Forecast gate: FAIL\*\*/);
    expect(md).toMatch(/^- Selection margin/m);
  });

  it('does not let a passing policy gate stand in for an unrun forecast gate', () => {
    const run = fakeRun('heldout-c', true);
    const md = renderReport({
      ...params,
      runs: [
        {
          ...run,
          evaluation: {
            ...run.evaluation,
            forecastGate: fakeForecastGate(false),
          } as unknown as RegisteredEvaluationResult,
        },
      ],
    });
    expect(md).toMatch(/\*\*Forecast gate: FAIL\*\*/);
    expect(md).toMatch(/\*\*Policy gate: PASS\*\*/);
    // A single blocked gate must reach the top-line decision.
    expect(md).toContain('**DO NOT RELEASE.**');
  });
});

describe('renderReport — a passing run', () => {
  it('does not print a blocked-reasons clause when the gate passed', () => {
    const md = renderReport({ ...params, runs: [fakeRun('heldout-c', true)] });
    expect(md).toMatch(/\*\*Forecast gate: PASS\*\*/);
    expect(md).toMatch(/\*\*Policy gate: PASS\*\*/);
    // A passing run must not emit a bullet list of reasons, and must reach
    // the affirmative top-line decision.
    expect(md).not.toMatch(/PASS\*\* — blocked on/);
    expect(md).toContain('**RELEASE.**');
    expect(md).not.toContain('**DO NOT RELEASE.**');
  });
});

describe('renderReport — ablation contributions edge cases', () => {
  it('renders the section header and lead sentence even with no ablation results', () => {
    const bareRun: RunSummary = {
      ...fakeRun('heldout-c', true),
      evaluation: {
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
        ],
        withdrawalSource: 'registered-schedule',
        artifact: { artifactHash: 'abc' },
        provisional: false,
        missingPolicyIds: [],
        missingTiers: [],
        forecastGate: fakeForecastGate(true),
      } as unknown as RegisteredEvaluationResult,
    };
    const md = renderReport({ ...params, runs: [bareRun] });
    expect(md).toContain('## Ablation contributions');
    expect(md).not.toMatch(/Negative contribution/);
  });

  it('does not print the negative-contribution callout when every contribution is non-negative', () => {
    const positiveOnlyRun: RunSummary = {
      ...fakeRun('heldout-c', true),
      evaluation: {
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
            // h1 underperforms srcla here (0.03 < 0.0421), a POSITIVE
            // contribution: removing capacity curves hurt.
            policy: { id: 'h1', section: '§11.3', deployable: true, disable: {} },
            tier: 1_000_000_000_000n,
            rebalances: 20,
            inertVsSrcla: false,
            replay: {
              realizedNetApy: 0.03,
              totalCosts: 1_000_000n,
              totalTurnover: 500_000_000_000n,
              withdrawalSuccessRate: 1,
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
        forecastGate: fakeForecastGate(true),
      } as unknown as RegisteredEvaluationResult,
    };
    const md = renderReport({ ...params, runs: [positiveOnlyRun] });
    expect(md).toContain('## Ablation contributions');
    expect(md).toContain('`h1`');
    expect(md).not.toMatch(/Negative contribution/);

    // Sanity: the same assertion DOES fire against the shared fixture (h3
    // negative), proving this spec is discriminating and not vacuous.
    const negativeMd = renderReport({ ...params, runs: [fakeRun('heldout-c', true)] });
    expect(negativeMd).toMatch(/Negative contribution/);
  });
});

describe('renderReport — §11.5 sustainability sections', () => {
  const verdict = (over: Record<string, unknown>) => ({
    policyId: 'srcla',
    tier: '1000000000000',
    demonstrated: true,
    s1: true,
    s2: true,
    s3: true,
    s4: true,
    sustainable: true,
    breach: null,
    realizedNetApy: 0.0755,
    displayedVsRealizedGapApy: 0.011,
    ...over,
  });

  const withVerdicts = (over: Record<string, unknown>) => {
    const base = fakeRun('heldout-c', false);
    return {
      ...params,
      runs: [{ ...base, gate: { ...base.gate, ...over } }],
    } as unknown as Parameters<typeof renderReport>[0];
  };

  // P22 — the skill window is a POWER DISCLOSURE, so it must be rendered
  // rather than left inside a check's detail string, and it must say the two
  // opposite things it does to the two yield statements.
  it('renders the skill window, the registered margin, and both directions of P22', () => {
    const md = renderReport(
      withVerdicts({
        nonInferiorityMarginApy: 0.0043,
        skillWindows: [
          {
            tier: '1000000000000',
            hindsightApy: 0.051,
            bestBaselineApy: 0.05,
            bestBaselineId: 'b2',
            windowApy: 0.001,
            marginApy: 0.0043,
            informative: false,
            detail: 'narrow',
          },
        ],
      }),
    );
    expect(md).toContain('### The skill window (P22)');
    expect(md).toContain('43.0 bps');
    expect(md).toContain('**NOT INFORMATIVE**');
    expect(md).toMatch(/does \*\*not\*\* excuse the non-inferiority test/);
    expect(md).toMatch(/deploy-and-hold would satisfy it too/);
    // The window may never reach the redeemability half of the gate.
    expect(md).toMatch(/yield can be beyond reach,\s+redeemability cannot/);
  });

  it('says NOT PRODUCED rather than inventing a window when none was measured', () => {
    const md = renderReport(withVerdicts({ nonInferiorityMarginApy: 0.0043, skillWindows: [] }));
    expect(md).toContain('_No skill window was produced._');
  });

  it('reports sustainability BEFORE the per-policy table and the yield comparison', () => {
    const md = renderReport(withVerdicts({ sustainability: [verdict({})], scaleInvariant: true }));
    expect(md.indexOf('Sustainability — the primary release criterion')).toBeLessThan(
      md.indexOf('### Per-policy results'),
    );
    expect(md.indexOf('The price of unsustainability')).toBeLessThan(
      md.indexOf('### Per-policy results'),
    );
    expect(md.indexOf('### Per-policy results')).toBeLessThan(
      md.indexOf('SRCLA against each deployable baseline'),
    );
  });

  // §11.4 requires all three P28 measurements per policy per tier — not only
  // inside a failing check's prose.
  it('reports the three P28 measurements per policy per tier, with the exit caveat', () => {
    const md = renderReport(withVerdicts({ sustainability: [verdict({})], scaleInvariant: true }));
    expect(md).toContain('Full exit (origins, lower bound)');
    expect(md).toContain('Max venue share');
    expect(md).toContain('Displayed − realized');
    expect(md).toMatch(/LOWER BOUND/);
    expect(md).toContain('12.0% (`compound-v3-usdc`)');
    expect(md).toContain('1.230%');
  });

  it('prints NOT DEMONSTRATED as itself, never as a pass', () => {
    const md = renderReport(
      withVerdicts({
        sustainability: [
          verdict({
            demonstrated: false,
            s1: null,
            s2: null,
            s3: null,
            s4: null,
            sustainable: null,
            breach: 'NOT DEMONSTRATED: capital at work 0.000 < 0.8',
            realizedNetApy: 0,
          }),
        ],
        scaleInvariant: null,
      }),
    );
    expect(md).toContain('**NOT DEMONSTRATED**');
    expect(md).toMatch(/Scale invariance \(P26\):\*\* \*\*NOT DEMONSTRATED\*\*/);
  });

  it('publishes an excluded comparator as a counterexample with its return', () => {
    const md = renderReport(
      withVerdicts({
        sustainability: [verdict({})],
        scaleInvariant: true,
        comparatorSustainability: [
          verdict({
            policyId: 'b1',
            sustainable: false,
            s2: false,
            breach: 'S2 stressed coverage 0.878',
            realizedNetApy: 0.39,
          }),
        ],
      }),
    );
    expect(md).toContain('The price of unsustainability');
    expect(md).toContain('`b1`');
    expect(md).toContain('39.000%');
    expect(md).toMatch(/not comparators/);
  });

  // ABSENCE IS NOT A FINDING. An empty `comparatorSustainability` used to
  // render "No comparator breached: there is nothing to price." — a positive
  // claim about the paper's headline quantity, drawn from a measurement that
  // was never produced.
  it('reports NOT PRODUCED, not "nothing to price", when no comparator was graded', () => {
    const md = renderReport(
      withVerdicts({ sustainability: [verdict({})], scaleInvariant: true, comparatorSustainability: [] }),
    );
    expect(md).toContain('**NOT PRODUCED.** No comparator sustainability verdict was graded');
    expect(md).not.toContain('No comparator breached');
  });

  // ...and the graded-and-all-sustainable case is still reported as the
  // measured claim it is, distinguishable from the absence above.
  it('distinguishes "every graded comparator was sustainable" from "none was graded"', () => {
    const md = renderReport(
      withVerdicts({
        sustainability: [verdict({})],
        scaleInvariant: true,
        comparatorSustainability: [verdict({ policyId: 'b0', sustainable: true })],
      }),
    );
    expect(md).toContain('graded comparator run(s) were sustainable');
    expect(md).not.toContain('NOT PRODUCED.** No comparator');
  });

  // §11.5 S3 has two clauses and S4 names five violation classes; this run
  // measures one clause and none of the five. The columns are named for what
  // they measure and the omission is stated, so a PASS cannot be read as
  // evidence about a ceiling, a cap or a reserve.
  it('discloses the S3 and S4 clauses this run does NOT evaluate', () => {
    const md = renderReport(withVerdicts({ sustainability: [verdict({})], scaleInvariant: true }));
    expect(md).toContain('S3 venue stress');
    expect(md).toContain('S4 action validity');
    expect(md).toContain('registered utilization ceiling');
    expect(md).toContain('unrecoverable plan state');
    expect(md).toMatch(/What S3 and S4 do \*\*NOT\*\* cover|What S3 and S4 do NOT cover/);
  });
});

describe('renderReport — P37 three verdicts', () => {
  const withP37 = (run: RunSummary, pass: boolean): RunSummary => ({
    ...run,
    gateP37: {
      ...run.gate,
      pass,
      blockedReasons: pass ? [] : ['Safety: stressed liquid coverage'],
    } as RegisteredGateResult,
    evaluation: {
      ...run.evaluation,
      forecastGateP37: fakeForecastGate(pass),
    } as unknown as RegisteredEvaluationResult,
  });

  it('prints all three verdicts, after the registered verdict and without changing it', () => {
    const md = renderReport(params);
    expect(md).toContain('## Verdicts under Amendment P37 (paper v0.11)');
    expect(md).toMatch(/\*\*1\. Registered v0\.10: FAIL\*\*/);
    expect(md).toMatch(/\*\*2\. P37, post-hoc: FAIL\*\*/);
    expect(md).toMatch(/\*\*3\. Release \(`heldout-d`\): NOT RUN\*\*/);
    expect(md.indexOf('## Verdict\n')).toBeLessThan(md.indexOf('## Verdicts under Amendment P37'));
  });

  it('labels the P37 verdict on the design eras post-hoc', () => {
    const v = threeVerdicts([
      withP37(fakeRun('heldout-c', true), true),
      withP37(fakeRun('heldout-b', true), true),
    ]);
    expect(v.p37PostHoc.status).toBe('PASS');
    expect(v.p37PostHoc.note).toMatch(/POST-HOC/);
    expect(v.release.status).toBe('NOT RUN');
  });

  it('reads NOT YET POWERED below 2,064 origins or with a gap, and grades only once powered', () => {
    const d = (origins: number, gaps: number, pass: boolean): RunSummary => ({
      ...withP37(fakeRun('heldout-c', pass), pass),
      era: 'heldout-d',
      datasetOrigins: origins,
      originGaps: gaps,
    });
    expect(threeVerdicts([d(2_063, 0, true)]).release.status).toBe('NOT YET POWERED');
    expect(threeVerdicts([d(2_064, 1, true)]).release.status).toBe('NOT YET POWERED');
    expect(threeVerdicts([d(2_064, 0, true)]).release.status).toBe('PASS');
    expect(threeVerdicts([d(2_064, 0, false)]).release.status).toBe('FAIL');
  });

  it('never lets a missing P37 gate read as a pass', () => {
    const v = threeVerdicts([fakeRun('heldout-c', true), fakeRun('heldout-b', true)]);
    expect(v.registered.status).toBe('PASS');
    expect(v.p37PostHoc.status).toBe('FAIL');
    expect(v.p37PostHoc.eras[0]!.policy).toBe('NOT PRODUCED');
  });

  it('prints the P37 gate tables beneath the registered ones', () => {
    const md = renderReport({ ...params, runs: [withP37(fakeRun('heldout-c', false), false)] });
    expect(md.indexOf('### §11.5 policy gate under P37')).toBeGreaterThan(
      md.indexOf('### §11.5 policy gate\n'),
    );
    expect(md).toContain('### §11.5 forecast gate under P37');
  });

  // Controller ruling T1.7-a: the out-of-scope 10M rows render under a label
  // that says they are outside the release scope, WITHOUT the in-scope
  // scale-invariance footer that `sustainabilityTable` normally appends — P37
  // never decides scale invariance over a tier it excludes from the release.
  it('renders the out-of-scope 10M rows without the in-scope scale-invariance footer (T1.7-a)', () => {
    const base = withP37(fakeRun('heldout-c', false), false);
    const run: RunSummary = {
      ...base,
      gateP37: {
        ...(base.gateP37 as RegisteredGateResult),
        outOfScopeSustainability: [
          {
            policyId: 'srcla',
            tier: '10000000000000',
            demonstrated: true,
            s1: true,
            s2: true,
            s3: true,
            s4: true,
            sustainable: true,
            realizedNetApy: 0.031,
            breach: null,
          },
        ],
      } as RegisteredGateResult,
    };
    const md = renderReport({ ...params, runs: [run] });
    const heading = md.indexOf('Outside the release scope');
    expect(heading).toBeGreaterThan(-1);
    const nextHeading = md.indexOf('\n### ', heading);
    const block = md.slice(heading, nextHeading === -1 ? md.length : nextHeading);
    expect(block).not.toContain('Scale invariance (P26)');
  });

  // Controller ruling T1.7-c: the P37 gate carries no 10M comparator results
  // (comparisons, comparator sustainability, skill windows, price of
  // unsustainability), because P37 decides over the release tiers only. The
  // per-era P37 section must say so, so the report does not imply those
  // results are absent — they are in the registered (v0.10) tables above.
  it('states that 10M comparator results live in the registered tables above (T1.7-c)', () => {
    const md = renderReport({ ...params, runs: [withP37(fakeRun('heldout-c', false), false)] });
    const idx = md.indexOf('### §11.5 policy gate under P37');
    expect(idx).toBeGreaterThan(-1);
    const section = md.slice(idx, idx + 800);
    expect(section).toMatch(/10,000,000|10M/);
    expect(section).toMatch(/registered \(v0\.10\)|registered v0\.10/i);
    expect(section).toMatch(/above/i);
  });
});
