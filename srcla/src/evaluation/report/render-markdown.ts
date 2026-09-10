/**
 * Render `SRCLA-REPORT.md` from a registered run record.
 *
 * WHY THIS EXISTS. `SRCLA-REPORT.md` was produced by `evaluation-v2/*.mjs`,
 * an untracked harness that is not the code this repository ships (defect
 * V5), and CLAUDE.md says outright: *"`SRCLA-REPORT.md` is stale... Do not
 * cite it; regenerate it."* Rendering from `src/evaluation/report/` means the
 * prose and the numbers come from one place and cannot drift.
 *
 * WHAT IT MUST SAY, near the top, in its own words rather than as a footnote:
 * the era table and both disclosed deviations; that withdrawals are a
 * registered schedule and not observed; every surviving `NOT_OBSERVED` entry;
 * whether `noTradeBandK` resolved; and every gate line, with NOT PRODUCED
 * distinguished from FAILED. A report that omits any of these reads as
 * stronger evidence than the run supports.
 *
 * PURE: no I/O, no Date.now() beyond what the caller passes in.
 * UNITS: money is USDC base units (6 dp); APYs are dimensionless fractions.
 */
import { ERAS_IN_ORDER, eraBounds, isOpenEnded, type EraTag } from '../eras.js';
import {
  ablationContributions,
  type RegisteredGateCheck,
  type RegisteredGateResult,
  type SkillWindow,
} from '../kernel/gates.js';
import type { ForecastGateResult, VenueCalibration } from '../kernel/forecast-gate.js';
import {
  REGISTERED_DEMONSTRATION_FLOOR,
  type SustainabilityVerdict,
} from '../kernel/sustainability.js';
import type { PolicyRunResult, RegisteredEvaluationResult } from '../kernel/harness.js';
import { REGISTERED_ABLATIONS } from '../kernel/registry.js';

export interface RunSummary {
  /** Which registered era this run opened. */
  era: EraTag;
  evaluation: RegisteredEvaluationResult;
  gate: RegisteredGateResult;
  provenance: {
    codeCommit: string;
    manifestHash: string;
    datasetHash: string;
    resultHash: string;
    gasSeriesDigest?: string;
  };
  datasetOrigins: number;
}

/** One row of the DERIVED (measured) per-era coverage table — distinct from
 * the STATIC registered-era table above: this one reports what the archive
 * actually holds, not what was declared. */
export interface EraProvenanceRow {
  era: EraTag;
  /** `—` when the era holds no rows yet (e.g. a growing open-ended era). */
  firstDate: string;
  lastDate: string;
  firstBlock: string;
  lastBlock: string;
  origins: number;
  days: number;
  sealed: boolean;
}

/** One row of the venue registry, measured over the evaluated era(s). */
export interface VenueProvenanceRow {
  marketId: string;
  displayName: string;
  address: string;
  apyMin: number;
  apyMean: number;
  apyMax: number;
  configRegimes: number;
  irmContracts: number;
}

/** Measured execution-cost inputs over one era's window. */
export interface CostRangeRow {
  era: EraTag;
  observations: number;
  l2BaseFeeMinWei: string;
  l2BaseFeeMaxWei: string;
  l1BaseFeeMinWei: string;
  l1BaseFeeMaxWei: string;
  ethUsdMinE8: string;
  ethUsdMaxE8: string;
  usdcUsdMinE8: string;
  usdcUsdMaxE8: string;
  gasSeriesDigest: string;
}

export interface DatasetProvenance {
  chainId: number;
  multicall3Address: string;
  gasOracleAddress: string;
  ethUsdFeedAddress: string;
  usdcUsdFeedAddress: string;
  usdcAddress: string;
  usdcDecimals: number;
  eras: readonly EraProvenanceRow[];
  venues: readonly VenueProvenanceRow[];
  costByEra: readonly CostRangeRow[];
}

export interface ReportParams {
  generatedAt: string;
  /** Primary run (held-out A) and any secondary runs (held-out B). */
  runs: RunSummary[];
  /** Entries still listed in NOT_OBSERVED after the measured-gas work. */
  notObserved: readonly string[];
  artifactSummary: {
    hash: string;
    method: string;
    horizonDays: number;
    coverageTarget: number;
    noTradeBandK: number;
    noTradeBandKResolved: boolean;
    calibrationEra: { start: string; end: string; days: number };
    perVenueCoverage: Record<string, number>;
  };
  /** Chain, collection method, block ranges, venue registry and measured
   * cost inputs — derived from the dataset, never hardcoded here. */
  provenance: DatasetProvenance;
}

const pct = (x: number, dp = 3): string => `${(x * 100).toFixed(dp)}%`;
const usdc = (base: bigint): string =>
  (Number(base) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Thousands-separate an integer given as a decimal string (block numbers,
 * wei amounts) without routing it through `Number`, which loses precision
 * well before a wei figure does. */
const commas = (intStr: string): string => {
  const neg = intStr.startsWith('-');
  const digits = neg ? intStr.slice(1) : intStr;
  const withSep = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${withSep}` : withSep;
};

/** An 8-dp Chainlink answer (ETH/USD, USDC/USD) as a dollar figure. */
const usdE8 = (e8: string): string =>
  `$${(Number(BigInt(e8)) / 1e8).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

function datasetProvenanceSection(p: DatasetProvenance): string {
  const out: string[] = [];
  out.push('## Dataset and provenance');
  out.push('');
  out.push(
    `Every figure below is read directly from **Base mainnet** (chainId **${p.chainId}**) at ` +
      'historical blocks, never simulated or assumed. Each hourly origin is one Multicall3 ' +
      `\`aggregate3\` batch against \`${p.multicall3Address}\`, calling Compound III Comet, the ` +
      'Aave V3 Pool and the Moonwell mToken directly rather than through the Navy adapters, ' +
      'which have no Base mainnet history of their own. **A venue that could not be read at an ' +
      'origin is recorded as a gap and never interpolated** — a missing observation stays ' +
      'missing rather than being filled from a neighbour.',
  );
  out.push('');

  out.push('### Per-era dataset coverage (measured, not declared)');
  out.push('');
  out.push(
    'The registered era boundaries above are what was *declared*; this table is what the ' +
      'archive actually *holds* for each — derived from every `MarketSnapshot` row\'s own ' +
      '`blockNumber` and `timestamp`, not from the boundary dates.',
  );
  out.push('');
  out.push('| Era | First date | Last date | First block | Last block | Origins | Days | Sealed |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const e of p.eras) {
    out.push(
      `| \`${e.era}\` | ${e.firstDate} | ${e.lastDate} | ${e.firstBlock === '—' ? '—' : commas(e.firstBlock)} | ` +
        `${e.lastBlock === '—' ? '—' : commas(e.lastBlock)} | ${e.origins.toLocaleString('en-US')} | ${e.days} | ` +
        `${e.sealed ? '**sealed**' : '—'} |`,
    );
  }
  out.push('');

  out.push('### Venue registry');
  out.push('');
  out.push(
    'The three allowlisted yield venues, and the asset moved between them. Addresses are ' +
      'verified on-chain, not copied from memory. Rate figures are the observed Comet/Aave/' +
      'Moonwell supply rate at every origin over the evaluated era(s), annualized.',
  );
  out.push('');
  out.push('| Venue | Market ID | Contract address | APY min | APY mean | APY max | Config regimes | IRM contracts |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const v of p.venues) {
    out.push(
      `| ${v.displayName} | \`${v.marketId}\` | \`${v.address}\` | ${pct(v.apyMin, 2)} | ` +
        `${pct(v.apyMean, 2)} | ${pct(v.apyMax, 2)} | ${v.configRegimes} | ${v.irmContracts} |`,
    );
  }
  out.push('');
  out.push(
    `**Asset:** Circle native USDC \`${p.usdcAddress}\`, ${p.usdcDecimals} decimals — the one ` +
      'unified USDC across every venue above.',
  );
  out.push('');

  out.push('### Measured execution-cost inputs');
  out.push('');
  out.push(
    'Gas and oracle values are **measured per origin, not assumed**: the L2 base fee comes ' +
      `from each block's own header; L1 fee parameters come from the OP-Stack GasPriceOracle ` +
      `predeploy at \`${p.gasOracleAddress}\`; ETH/USD and USDC/USD come from Chainlink at ` +
      `\`${p.ethUsdFeedAddress}\` and \`${p.usdcUsdFeedAddress}\` respectively. Ranges below are ` +
      'the min/max actually observed over each evaluated era, not a registered constant.',
  );
  out.push('');
  out.push(
    '| Era | Observations | L2 base fee (wei) | L1 base fee (wei) | ETH/USD | USDC/USD | Gas-series digest |',
  );
  out.push('|---|---|---|---|---|---|---|');
  for (const c of p.costByEra) {
    out.push(
      `| \`${c.era}\` | ${c.observations.toLocaleString('en-US')} | ${commas(c.l2BaseFeeMinWei)}–` +
        `${commas(c.l2BaseFeeMaxWei)} | ${commas(c.l1BaseFeeMinWei)}–${commas(c.l1BaseFeeMaxWei)} | ` +
        `${usdE8(c.ethUsdMinE8)}–${usdE8(c.ethUsdMaxE8)} | ${usdE8(c.usdcUsdMinE8)}–${usdE8(c.usdcUsdMaxE8)} | ` +
        `\`${c.gasSeriesDigest}\` |`,
    );
  }
  out.push('');

  return out.join('\n');
}

/**
 * A registered era's role text, made safe to emit as one markdown list item.
 *
 * The roles in `eras.ts` are prose: they contain `--`, balanced backticks and
 * (as source strings) hard line wraps. Collapsing whitespace keeps each role
 * on one list line; the `|` escape means a role could later gain a pipe
 * without silently splitting a cell if this text is ever reused in a table.
 * Nothing is truncated — the whole point of the list is that it is lossless.
 */
const eraRoleLine = (role: string): string =>
  role.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/**
 * The registered-era block: a table of the MECHANICAL columns, then every
 * era's FULL role beneath it.
 *
 * WHY THE ROLE IS NOT A TABLE CELL. It used to be `role.split('.')[0]`,
 * intended as "the first sentence". `heldout-c`'s role opens with the version
 * string `v0.6`, so the split landed inside it and the published report said
 * the era's role was, in full, `v0.` — deleting the "LESS BURNED, NOT
 * PRISTINE" caveat the run's credibility depends on. A 200-character caveat
 * does not belong in a table cell; it belongs in a list, whole.
 *
 * OPEN-ENDED ERAS. `heldout-b` ends at the far-future sentinel, so rendering
 * `eraBounds().end` and `.days` printed "2099-12-31" and "26793 days" in a
 * published document. Such an era's End and Days are reported as `open`.
 */
function eraTable(): string {
  const rows = ERAS_IN_ORDER.map((e) => {
    const b = eraBounds(e.tag);
    const open = isOpenEnded(e.tag);
    return (
      `| \`${e.tag}\` | ${b.start.slice(0, 10)} | ${open ? 'open' : b.end.slice(0, 10)} | ` +
      `${open ? 'open' : b.days} | ${e.sealed ? '**sealed**' : '—'} |`
    );
  });
  const roles = ERAS_IN_ORDER.map((e) => `- \`${e.tag}\` — ${eraRoleLine(e.role)}`);
  return [
    '| Era | Start | End | Days | Sealed |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    'An era with an End of `open` grows with the live collector; its effective end is ' +
      'whenever collection last ran, reported per era in the measured-coverage table below.',
    '',
    'Each era\'s registered role, in full — none of this is abbreviated, because the caveats ' +
      'are the point:',
    '',
    ...roles,
  ].join('\n');
}

/** How much of a gate's detail a table cell carries before it is cut. */
const GATE_DETAIL_MAX = 600;

/**
 * Truncate a gate detail VISIBLY. The old `.slice(0, 300)` cut mid-token with
 * no marker, so a reader could not tell that a detail naming, say, four
 * offending runs had been cut after two. Cutting back to the last space and
 * appending an ellipsis says "there was more".
 *
 * Truncation happens BEFORE pipe-escaping so a cut can never land between a
 * `\` and the `|` it escapes.
 */
function gateDetail(detail: string): string {
  const cut =
    detail.length <= GATE_DETAIL_MAX
      ? detail
      : (() => {
          const head = detail.slice(0, GATE_DETAIL_MAX);
          const lastSpace = head.lastIndexOf(' ');
          return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
        })();
  return cut.replace(/\|/g, '\\|');
}

/**
 * Both §11.5 gates render through this one table. It reads only `checks`, so
 * it is typed on that alone rather than on `RegisteredGateResult` — the
 * forecast gate deliberately does NOT carry the policy gate's comparison,
 * sustainability and skill-window fields (see `kernel/forecast-gate.ts`), and
 * widening it to fake them would be the absence-reads-as-success shape this
 * whole report exists to avoid.
 */
function gateTable(gate: { checks: readonly RegisteredGateCheck[] }): string {
  const rows = gate.checks.map((c) => {
    const mark = c.passed === true ? 'PASS' : c.passed === false ? '**FAIL**' : '**NOT PRODUCED**';
    // A REPORTED check is not part of the verdict. Printing it in the same
    // column as the gating ones without saying so would read as a block that
    // the `pass` line then contradicts.
    const gating = c.gating === false ? 'reported' : 'gates';
    return `| ${mark} | ${gating} | ${c.name} | ${gateDetail(c.detail)} |`;
  });
  return ['| Verdict | Role | Check | Detail |', '|---|---|---|---|', ...rows].join('\n');
}

/**
 * §11.5's FORECAST gate, and the per-venue calibration behind it.
 *
 * Rendered ABOVE the policy gate because that is the order §11.5 states them
 * in and the order the argument runs: a policy result computed from a forecast
 * that is not calibrated is not evidence about the policy. Until this release
 * the forecast gate was never evaluated at all, so every prior version of this
 * report published the policy half of a two-part criterion as though it were
 * the whole of it.
 */
function forecastVenueTable(venues: readonly VenueCalibration[]): string {
  if (venues.length === 0) {
    return '_No per-venue calibration was measured; see the gate lines above for why._';
  }
  const rows = venues.map((v) => {
    const kupiec = v.kupiec === null ? 'NOT PRODUCED' : v.kupiec.pValue.toFixed(4);
    const cc =
      v.christoffersen === null ? 'NOT PRODUCED' : v.christoffersen.pValue.toFixed(4);
    const ccN = v.christoffersen === null ? '—' : String(v.christoffersen.observations);
    return (
      `| ${v.marketId} | ${v.observations} | ${(v.achievedCoverage * 100).toFixed(2)}% | ` +
      `${v.exceedances} | ${kupiec} | ${cc} | ${ccN} |`
    );
  });
  return [
    '| Venue | Residuals | Achieved coverage | Exceedances | Kupiec p | Christoffersen p | Non-overlapping windows |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function forecastGateSection(gate: ForecastGateResult): string[] {
  const out: string[] = [];
  out.push('### §11.5 forecast gate');
  out.push('');
  out.push(
    `**${gate.pass ? 'PASS' : 'FAIL'}**` +
      (gate.pass ? '' : ` — blocked on: ${gate.blockedReasons.join('; ')}`),
  );
  out.push('');
  out.push(gateTable(gate));
  out.push('');
  out.push(
    'Coverage is recomputed OUT OF SAMPLE. The artifact\'s per-venue quantile was solved ' +
      'to hit the target on the calibration era, so its in-sample coverage is true by ' +
      'construction and says nothing; what follows is the same quantile measured against ' +
      'the labels this era produced. Christoffersen\'s independence test runs on a stream ' +
      'thinned to NON-OVERLAPPING horizon windows — consecutive labels share most of their ' +
      'window, so on the raw stream the test would reject clustering the sampling grid ' +
      'created rather than clustering the forecast did.',
  );
  out.push('');
  out.push(forecastVenueTable(gate.venues));
  return out;
}

/**
 * P22 — the skill window, published as a POWER DISCLOSURE beside both yield
 * statements.
 *
 * It is the whole budget any allocation skill could have captured: bounded
 * hindsight (B5, §11.2's non-deployable upper bound) minus the best
 * SUSTAINABLE baseline, on the same era. It qualifies the two yield
 * statements in OPPOSITE directions, which is why it is printed once, here,
 * rather than folded into either check's prose:
 *
 *   - a SUPERIORITY claim inside the window is NOT INFORMATIVE — no policy
 *     could have demonstrated it at that resolution;
 *   - a NON-INFERIORITY pass inside the window still stands, because a narrow
 *     window makes non-inferiority EASIER — but it is weak evidence of
 *     allocation quality, since deploy-and-hold would satisfy it too.
 */
function skillWindowTable(gate: RegisteredGateResult): string {
  const windows: SkillWindow[] = gate.skillWindows ?? [];
  const marginBps = (gate.nonInferiorityMarginApy * 10_000).toFixed(1);
  if (windows.length === 0) return '_No skill window was produced._';

  const rows = windows
    .slice()
    .sort((a, b) => (BigInt(a.tier || '0') < BigInt(b.tier || '0') ? -1 : 1))
    .map(
      (w) =>
        `| ${w.tier === '' ? '—' : usdc(BigInt(w.tier))} | ` +
        `${w.hindsightApy === null ? '—' : pct(w.hindsightApy)} | ` +
        `${w.bestBaselineId ?? '—'} | ` +
        `${w.bestBaselineApy === null ? '—' : pct(w.bestBaselineApy)} | ` +
        `${w.windowApy === null ? '—' : `${(w.windowApy * 10_000).toFixed(1)} bps`} | ` +
        `${w.informative === true ? 'INFORMATIVE' : w.informative === false ? '**NOT INFORMATIVE**' : '**NOT PRODUCED**'} |`,
    );

  return [
    `Registered non-inferiority margin: **${marginBps} bps** annualized (` +
      '`REGISTERED_NONINFERIORITY_MARGIN`, an **unconfirmed** registration the paper owner ' +
      'must confirm before the freeze). The window below is bounded hindsight minus the best ' +
      'SUSTAINABLE baseline — the entire return reallocation could have earned.',
    '',
    '| Tier | Bounded hindsight (B5) | Best sustainable baseline | its net APY | Skill window | Superiority resolvable? |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    'A window narrower than the margin means **no policy could have demonstrated yield ' +
      'superiority at this resolution**, so the superiority line is reported NOT INFORMATIVE ' +
      'and gates nothing. It does **not** excuse the non-inferiority test: a narrow window ' +
      'makes non-inferiority *easier*, so a pass there is disclosed as weak evidence of ' +
      'allocation quality — deploy-and-hold would satisfy it too. The window never touches ' +
      'the demonstration, completeness or sustainability checks: yield can be beyond reach, ' +
      'redeemability cannot.',
  ].join('\n');
}

/**
 * §11.4's three P28 measurements, one cell each. They are reported PER POLICY
 * PER TIER — not only inside a failing check's prose, which is where they
 * lived when the criteria were first wired and which left SRCLA's own rows
 * silent about all three.
 */
function exitCell(r: PolicyRunResult): string {
  const origins = r.replay.timeToFullExitOrigins;
  if (origins !== null && origins !== undefined) return `${origins}`;
  return r.replay.timeToFullExitCensored ? '**censored**' : '**NEVER**';
}

function maxVenueShareCell(r: PolicyRunResult): string {
  const shares: number[] = Object.values(r.replay.venueStressContribution ?? {});
  if (shares.length === 0) return '—';
  const worst = Math.max(...shares);
  const venue = Object.entries(r.replay.venueStressContribution).find(([, v]) => v === worst)?.[0];
  return `${pct(worst, 1)} (\`${venue ?? '?'}\`)`;
}

function gapCell(r: PolicyRunResult): string {
  const gap = r.replay.displayedVsRealizedGapApy;
  return gap === undefined ? '—' : pct(gap);
}

function resultsTable(out: RegisteredEvaluationResult): string {
  const tiers = [...new Set(out.results.map((r) => r.tier.toString()))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  const sections: string[] = [];
  for (const tier of tiers) {
    const rows = out.results
      .filter((r) => r.tier.toString() === tier)
      .map(
        (r) =>
          `| \`${r.policy.id}\` | ${r.policy.section} | ${pct(r.replay.realizedNetApy)} | ` +
          `${r.rebalances} | ${usdc(r.replay.totalTurnover)} | ${usdc(r.replay.totalCosts)} | ` +
          `${r.replay.withdrawalSuccessRate === null ? '**not measured**' : pct(r.replay.withdrawalSuccessRate, 1)} | ` +
          `${pct(r.replay.coverageDistribution.min, 3)} | ${pct(r.replay.coverageDistribution.p05, 3)} | ` +
          `${pct(r.replay.coverageDistribution.median, 3)} | ` +
          `${exitCell(r)} | ${maxVenueShareCell(r)} | ${gapCell(r)} | ` +
          `${r.inertVsSrcla ? '**INERT**' : '—'} |`,
      );
    sections.push(
      `#### Tier ${usdc(BigInt(tier))} USDC\n\n` +
        [
          '| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | ' +
            'Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | ' +
            'Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |',
          '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
          ...rows,
        ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

/**
 * §11.3's H1–H7 each remove exactly one component from SRCLA. This section
 * makes each removal's measured effect legible: `contribution = SRCLA net
 * APY − ablation net APY` at the same tier. Positive means the component
 * earned its keep (removing it hurt); negative means the component cost more
 * than it earned on THIS data (removing it helped) — the report's single
 * most important signal, so a negative row gets an explicit callout rather
 * than sitting quietly in a table column.
 *
 * INERT is a different statement from "measured a zero": an inert ablation's
 * decisions are byte-identical to SRCLA's, so its contribution is zero BY
 * CONSTRUCTION, not because the removed component happened to net out.
 */
function ablationContributionsSection(evaluation: RegisteredEvaluationResult): string {
  const out: string[] = [];
  out.push('## Ablation contributions');
  out.push('');
  out.push(
    'Each row below removes exactly one component from SRCLA (§11.3) and reports what that ' +
      'component was measured to be worth: `contribution = SRCLA net APY − ablation net APY` ' +
      'at the same tier. **Positive** means removing the component made the policy worse — the ' +
      "component was earning its keep. **Negative** means removing it made the policy BETTER — " +
      'the component cost more than it earned on this data.',
  );
  out.push('');

  const tiers = [...new Set(evaluation.results.map((r) => r.tier.toString()))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );

  // The single source of truth for the verdict and the pp delta (P21) --
  // this section only formats it.
  const contributions = ablationContributions(evaluation);
  const negatives: Array<{ tier: string; id: string; description: string; contributionPp: number }> = [];

  for (const tier of tiers) {
    const srclaResult = evaluation.results.find(
      (r) => r.policy.id === 'srcla' && r.tier.toString() === tier,
    );
    if (srclaResult === undefined) continue;

    const rows: string[] = [];
    for (const ablation of REGISTERED_ABLATIONS) {
      const r = evaluation.results.find(
        (x) => x.policy.id === ablation.id && x.tier.toString() === tier,
      );
      if (r === undefined) continue;
      const contrib = contributions.find((c) => c.policyId === ablation.id && c.tier === tier);
      if (contrib === undefined) continue;

      const { contributionPp, verdict } = contrib;
      const sign = contributionPp >= 0 ? '+' : '';
      const valueStr = `${sign}${contributionPp.toFixed(3)} pp`;
      const contributionCell =
        verdict === 'INERT'
          ? '**INERT** (identical decisions — not a measured contribution)'
          : verdict === 'NEGATIVE'
            ? `**${valueStr}**`
            : valueStr;

      rows.push(
        `| \`${ablation.id}\` | ${ablation.paperDefinition} | ${pct(srclaResult.replay.realizedNetApy)} | ` +
          `${pct(r.replay.realizedNetApy)} | ${contributionCell} | ${r.rebalances} | ${srclaResult.rebalances} |`,
      );

      if (verdict === 'NEGATIVE') {
        negatives.push({ tier, id: ablation.id, description: ablation.paperDefinition, contributionPp });
      }
    }
    if (rows.length === 0) continue;

    out.push(`#### Tier ${usdc(BigInt(tier))} USDC`);
    out.push('');
    out.push(
      '| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | ' +
        'SRCLA rebalances |',
    );
    out.push('|---|---|---|---|---|---|---|');
    out.push(...rows);
    out.push('');
  }

  if (negatives.length > 0) {
    out.push(
      '> **Negative contribution: removing the component helped, not hurt.** This is the ' +
        "report's most important measured signal — the component cost more than it earned on " +
        'this data.',
    );
    out.push('>');
    for (const n of negatives) {
      out.push(
        `> - \`${n.id}\` (${n.description}) at tier ${usdc(BigInt(n.tier))} USDC: contribution ` +
          `**${n.contributionPp.toFixed(3)} pp**.`,
      );
    }
    out.push('');
  }

  return out.join('\n');
}

/**
 * §11.5's PRIMARY criterion, rendered BEFORE the yield tables because that
 * is the claim's order: a policy that is not sustainable is not a comparator
 * whose return is worth reading, it is a counterexample whose return is the
 * price of the thing being ruled out.
 *
 * Three-valued throughout. `NOT DEMONSTRATED` is printed as itself and never
 * collapsed into either a tick or a cross, because the distinction between
 * "held up under stress while deployed" and "held cash and was never tested"
 * is the entire point of the demonstration floor.
 */
function sustainabilityTable(gate: RegisteredGateResult): string {
  const verdicts: SustainabilityVerdict[] = gate.sustainability ?? [];
  if (verdicts.length === 0) return '_No sustainability verdict was produced._';

  const mark = (v: boolean | null): string =>
    v === true ? 'PASS' : v === false ? '**FAIL**' : '**ND**';
  const rows = verdicts
    .slice()
    .sort((a, b) => (BigInt(a.tier) < BigInt(b.tier) ? -1 : 1))
    .map(
      (v) =>
        `| ${usdc(BigInt(v.tier))} | ${v.demonstrated ? 'yes' : '**NOT DEMONSTRATED**'} | ` +
        `${mark(v.s1)} | ${mark(v.s2)} | ${mark(v.s3)} | ${mark(v.s4)} | ` +
        `${v.sustainable === true ? '**SUSTAINABLE**' : v.sustainable === false ? '**BREACH**' : '**NOT DEMONSTRATED**'} | ` +
        `${pct(v.realizedNetApy)} | ${v.breach ?? '—'} |`,
    );
  const invariant = gate.scaleInvariant;
  return [
    `Demonstration floor: capital at work >= **${REGISTERED_DEMONSTRATION_FLOOR}**. Below it a run ` +
      'is trivially redeemable and demonstrates nothing, so every criterion reports **ND** (NOT ' +
      'DEMONSTRATED) and no sustainability claim may be drawn from it.',
    '',
    '| Tier | Demonstrated | S1 redeem | S2 coverage | S3 capacity | S4 continuity | Verdict | Net APY | Breach |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `**Scale invariance (P26):** ${
      invariant === true
        ? 'sustainable at EVERY registered tier.'
        : invariant === false
          ? '**NOT scale invariant** — a breach at any tier is a breach, and no average over tiers may stand in for it.'
          : '**NOT DEMONSTRATED** — at least one tier proved nothing, and a tier that proved nothing cannot be counted as invariant.'
    }`,
  ].join('\n');
}

/**
 * §11.5 part 3 — the price of unsustainability. Every comparator excluded
 * from the yield comparison appears here with what it EARNED and what it was
 * DISPLAYING while it earned it. Dropping a breaching policy from the
 * comparison and then not printing its return would hide the study's own
 * headline number.
 */
function counterexampleTable(gate: RegisteredGateResult): string {
  const verdicts: SustainabilityVerdict[] = gate.comparatorSustainability ?? [];
  const breaching = verdicts.filter((v) => v.sustainable !== true);
  if (breaching.length === 0) return '_No comparator breached: there is nothing to price._';

  const rows = breaching
    .slice()
    .sort((a, b) => (a.policyId === b.policyId ? (BigInt(a.tier) < BigInt(b.tier) ? -1 : 1) : a.policyId < b.policyId ? -1 : 1))
    .map(
      (v) =>
        `| \`${v.policyId}\` | ${usdc(BigInt(v.tier))} | ${pct(v.realizedNetApy)} | ` +
        `${pct(v.displayedVsRealizedGapApy)} | ${v.sustainable === false ? '**BREACH**' : '**NOT DEMONSTRATED**'} | ${v.breach ?? '—'} |`,
    );
  return [
    'These policies are **not comparators**. Each is a counterexample: the return below is what ' +
      'the policy earned while failing a criterion SRCLA is held to, i.e. the measured price of ' +
      'unsustainability rather than a benchmark SRCLA had to beat.',
    '',
    '| Policy | Tier | Net APY | Displayed − realized | Verdict | Why |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function comparisonTable(gate: RegisteredGateResult): string {
  if (gate.comparisons.length === 0) {
    return '_No SRCLA-vs-baseline comparison was produced._';
  }
  // The one-sided NON-INFERIORITY verdict decides §11.5's yield criterion, so
  // it must be in the table a Markdown reader actually reads. Showing only the
  // two-sided p and the bootstrap CI -- which is what this table did -- meant
  // the criterion was visible nowhere but inside a check's prose, and the
  // two-sided statistic that IS shown no longer gates anything.
  const verdict = (v: boolean | null): string =>
    v === true ? 'NON-INFERIOR' : v === false ? '**INFERIOR**' : '**UNRESOLVED**';
  const rows = gate.comparisons.map(
    (c) =>
      `| ${usdc(BigInt(c.tier))} | \`${c.baselineId}\` | ${pct(c.srclaNetApy)} | ${pct(c.baselineNetApy)} | ` +
      `${verdict(c.nonInferiority.nonInferior)} | ` +
      `${c.nonInferiority.usable ? c.nonInferiority.pValue.toFixed(4) : `not usable (${c.nonInferiority.reason})`} | ` +
      `${c.test.usable ? c.test.pValue.toFixed(4) : `not usable (${c.test.reason})`} | ` +
      `${c.bootstrap.usable ? `[${c.bootstrap.lower.toExponential(2)}, ${c.bootstrap.upper.toExponential(2)}]` : 'not usable'} |`,
  );
  const marginBps = (gate.nonInferiorityMarginApy * 10_000).toFixed(1);
  return [
    `**Non-inferiority** is §11.5's yield criterion: one-sided at a ${marginBps} bps annualized ` +
      'margin, HAC-corrected, and cross-checked by a seeded moving-block bootstrap that may ' +
      'downgrade a pass to UNRESOLVED but may never upgrade a failure. The two-sided p and the ' +
      'bootstrap CI are **reported diagnostics** and gate nothing.',
    '',
    `| Tier | Baseline | SRCLA | Baseline | Non-inferior (${marginBps} bps) | one-sided p | two-sided HAC p | bootstrap 95% CI of difference |`,
    '|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

export function renderReport(params: ReportParams): string {
  const { artifactSummary: a } = params;
  const primary = params.runs[0];
  if (primary === undefined) throw new Error('renderReport: no run to report');

  const out: string[] = [];

  out.push('# SRCLA Evaluation Report');
  out.push('');
  out.push(
    `**Generated:** ${params.generatedAt} · **Code:** \`${primary.provenance.codeCommit}\` · ` +
      `**Artifact:** \`${a.hash}\``,
  );
  out.push('');
  out.push(
    '> Regenerated from `src/evaluation/report/`. It supersedes every earlier ' +
      'version of this file, which was produced by an untracked `evaluation-v2/*.mjs` ' +
      'harness that is not the code this repository ships.',
  );
  out.push('');

  // ---- Verdict first. -----------------------------------------------------
  out.push('## Verdict');
  out.push('');
  for (const run of params.runs) {
    // Same sentinel problem as the era table: an open-ended era has no day
    // count to print, only the origins actually collected.
    const span = isOpenEnded(run.era) ? 'open-ended' : `${eraBounds(run.era).days}d`;
    out.push(
      `- **${run.era}** (${span}, ${run.datasetOrigins} origins): ` +
        `§11.5 forecast gate **${run.evaluation.forecastGate.pass ? 'PASS' : 'FAIL'}**` +
        (run.evaluation.forecastGate.pass
          ? ''
          : ` — blocked on: ${run.evaluation.forecastGate.blockedReasons.join('; ')}`) +
        `; §11.5 policy gate **${run.gate.pass ? 'PASS' : 'FAIL'}**` +
        (run.gate.pass ? '' : ` — blocked on: ${run.gate.blockedReasons.join('; ')}`),
    );
  }
  out.push('');
  out.push(
    'A `FAIL` here is a result, not an error. §11.5 requires publishing a negative ' +
      'result rather than retuning against held-out data.',
  );
  out.push('');

  // ---- What the reader must know before reading a number. -----------------
  out.push('## Read this before citing any number');
  out.push('');
  out.push('### Registered eras');
  out.push('');
  out.push(eraTable());
  out.push('');
  out.push('**Three deviations are disclosed, not buried:**');
  out.push('');
  out.push(
    '1. Paper §4.1 says the burned window "lies inside the calibration era". Here it ' +
      'lies in **neither** era. Putting it in calibration would place fitting data *after* ' +
      '`heldout-c` in time, inverting walk-forward order and creating exactly the look-ahead ' +
      '§7.3 forbids. Excluding it satisfies §4.1\'s purpose — the window must never be ' +
      'held-out — strictly more than including it would. This is a paper-owner decision.',
  );
  out.push(
    '2. `heldout-c` (Mar–May 2026) **precedes** the burned window in time. The amendments ' +
      'P1–P8 and the code were designed with knowledge of May–Aug 2026, so a designer who ' +
      'knew the later period could in principle have chosen mechanisms that suit the ' +
      'earlier one. `heldout-b` is chronologically after everything, including the burned ' +
      'window, and carries no such caveat — but it is only 16 days. **Both sealed eras are ' +
      'reported: `heldout-c` for what statistical power exists, `heldout-b` for temporal ' +
      'purity. Neither alone is sufficient.**',
  );
  out.push(
    '3. `heldout-c` is **less burned, not pristine.** It was carved out of the era this ' +
      "project called held-out A in v0.5. That era's *aggregate* statistics — net APY, " +
      'worst stressed coverage, total cost and turnover — were read while diagnosing v0.5, ' +
      'which is why the remainder of it is now `burned-a` and is reported by nothing. What ' +
      "was learned is that era's overall direction, not this 86-day period's structure, so " +
      '`heldout-c` is weaker evidence than a never-seen era would be and stronger than ' +
      '`burned-a`. It is used because `heldout-b` alone cannot adjudicate a yield claim.',
  );
  out.push('');

  out.push('### Withdrawals are a registered schedule, not observed');
  out.push('');
  out.push(
    `\`withdrawalSource\` = \`${primary.evaluation.withdrawalSource}\`. The Navy vault has no ` +
      'Base mainnet history, so §8.1\'s `W_H` has no real series over this window and ' +
      '`Q_β(W_H)` is computed against a registered schedule. No claim in this report is ' +
      'evidence about real user redemption behaviour.',
  );
  out.push('');

  out.push('### Quantities the decision needs that the dataset does not carry');
  out.push('');
  if (params.notObserved.length === 0) {
    out.push('_None: every input is measured._');
  } else {
    for (const n of params.notObserved) out.push(`- ${n}`);
    out.push('');
    out.push(
      'Each is supplied as a registered constant, never inferred from data. Gas and ' +
        'oracle observations are **no longer** on this list: they are measured per origin ' +
        'from the block header, the OP-Stack GasPriceOracle and the two Chainlink feeds' +
        (primary.provenance.gasSeriesDigest !== undefined
          ? ` (series digest \`${primary.provenance.gasSeriesDigest}\`)`
          : '') +
        '.',
    );
  }
  out.push('');

  // ---- The artifact. ------------------------------------------------------
  out.push('## The registered forecast artifact');
  out.push('');
  out.push(
    `Fit on the calibration era only (${a.calibrationEra.start.slice(0, 10)} → ` +
      `${a.calibrationEra.end.slice(0, 10)}, ${a.calibrationEra.days}d). Selected by the ` +
      `registered grid: **${a.method}**, horizon **${a.horizonDays}d**, coverage target ` +
      `**${a.coverageTarget}**.`,
  );
  out.push('');
  out.push('Per-venue achieved coverage (amendment P1 — the quantile is solved per venue to the target):');
  out.push('');
  out.push('| Venue | Achieved coverage |');
  out.push('|---|---|');
  for (const [venue, c] of Object.entries(a.perVenueCoverage).sort()) {
    out.push(`| \`${venue}\` | ${pct(c, 2)} |`);
  }
  out.push('');
  out.push(
    a.noTradeBandKResolved
      ? `P8's significance multiplier \`k\` — the standard-error scalar in §9.1.3's rotation ` +
          `hurdle, formerly the \`k*sigma\` no-trade band's multiplier — resolved to ` +
          `**${a.noTradeBandK}** on the calibration era.`
      : `**P8's \`k\` did not resolve.** The sweep was inconclusive, so \`k\` — the ` +
          `standard-error scalar in §9.1.3's rotation hurdle, formerly the \`k*sigma\` ` +
          `no-trade band's multiplier — remains at ${a.noTradeBandK} as a registered default ` +
          `and every P8 result is provisional. A value chosen because it moves a gate would ` +
          `not be a registration.`,
  );
  out.push('');

  // ---- Dataset and provenance, BEFORE the results. -------------------------
  out.push(datasetProvenanceSection(params.provenance));
  out.push('');

  // ---- Results. -----------------------------------------------------------
  for (const run of params.runs) {
    out.push(`## Results — era \`${run.era}\``);
    out.push('');
    out.push(
      `${run.datasetOrigins} origins. Manifest \`${run.provenance.manifestHash}\`, dataset ` +
        `\`${run.provenance.datasetHash}\`, result \`${run.provenance.resultHash}\`. ` +
        `Reproduce with \`pnpm run evaluation:verify\`.`,
    );
    out.push('');
    // §11.5's order, and it is the argument: sustainability is the PRIMARY
    // criterion, so it is reported BEFORE the per-policy yield table and
    // before any comparison. A reader who meets the league table first reads
    // the study as a yield contest, which is the framing P24 exists to
    // invert.
    out.push('### Sustainability — the primary release criterion (§11.5)');
    out.push('');
    out.push(sustainabilityTable(run.gate));
    out.push('');
    out.push('### The price of unsustainability (§11.5 part 3)');
    out.push('');
    out.push(counterexampleTable(run.gate));
    out.push('');
    out.push('### Per-policy results');
    out.push('');
    out.push(
      '`stressedLiquidCoverage` is measured every origin; the §11.5 gate tests only the ' +
        '**minimum** over the whole run, so one market-wide dry hour scores identically to ' +
        'chronic illiquidity. The p05 and median columns below distinguish the two — neither ' +
        'is what the gate tests.',
    );
    out.push('');
    out.push(
      '§11.4\'s three sustainability measurements are reported per policy per tier in the same ' +
        'table. **Full exit** is the origins needed to redeem 100% of NAV from the run\'s worst ' +
        'coverage origin, executing only same-transaction exits — a LOWER BOUND, because each ' +
        'origin\'s capacity is read from a replay in which the vault did not exit, and marked ' +
        '`censored` where the era ended before the bound could be tested (a missing measurement, ' +
        'not a failure). **Max venue share** is the largest fraction of a venue the vault itself ' +
        'was, at any origin. **Displayed − realized** is the deployed-weighted advertised rate ' +
        'minus what the vault actually kept.',
    );
    out.push('');
    out.push(resultsTable(run.evaluation));
    out.push('');
    out.push('### The skill window (P22) — is either yield statement informative?');
    out.push('');
    out.push(skillWindowTable(run.gate));
    out.push('');
    out.push('### SRCLA against each deployable baseline');
    out.push('');
    out.push(comparisonTable(run.gate));
    out.push('');
    out.push(ablationContributionsSection(run.evaluation));
    out.push('');
    out.push(...forecastGateSection(run.evaluation.forecastGate));
    out.push('');
    out.push('### §11.5 policy gate');
    out.push('');
    out.push(gateTable(run.gate));
    out.push('');
  }

  // ---- Limitations. -------------------------------------------------------
  out.push('## Limitations');
  out.push('');
  // The fork-replay limitation is CONDITIONAL: once a run supplies replays,
  // printing "not produced" beneath a gate line that says otherwise would be
  // a false limitation, which is as misleading as a missing one.
  const forkChecks = params.runs
    .map((r) => r.gate.checks.find((c) => c.name === '§11.1 pinned-prestate fork replay'))
    .filter((c): c is RegisteredGateCheck => c !== undefined);
  const forkProduced = forkChecks.length > 0 && forkChecks.every((c) => c.passed === true);
  out.push(
    forkProduced
      ? '- **§11.1\'s pinned-prestate fork replay covers ONE origin per (policy, tier)** — the ' +
          'first origin at which each policy proposed a move — not every origin of the era. It ' +
          'shows the chain accepts each policy\'s proposal from the pinned prestate; it does not ' +
          're-derive the era\'s returns on chain.'
      : '- **§11.1\'s pinned-prestate fork replay is not produced.** ' +
          '`src/evaluation/fork-runner.ts#runForkReplays` produces it and needs a live Base ' +
          'fork with the vault deployed; this run supplied none, so the gate reports NOT ' +
          'PRODUCED and blocks. No allocation in this report has been shown to be one the ' +
          'chain would have accepted.',
  );
  out.push(
    '- **Withdrawals are synthetic** (see above), so the withdrawal-success and ' +
      'stressed-coverage figures describe the registered schedule, not observed demand.',
  );
  out.push(
    '- **An INERT ablation removed nothing** on this dataset: its decision sequence is ' +
      'byte-identical to SRCLA\'s, so any delta reported for it is noise and attributing it ' +
      'to the removed component would be a misattribution. Inert rows are marked in the ' +
      'tables above.',
  );
  out.push(
    '- **Reward emissions** contribute whatever the measured probe found, which may be ' +
      'zero. A zero is reported as zero rather than omitted.',
  );
  out.push('');

  out.push('## Reproducing this report');
  out.push('');
  out.push('```bash');
  out.push('cd srcla && docker compose up -d');
  out.push("DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm prisma:push");
  out.push("DATABASE_URL='...' pnpm backfill:history            # ~18k hourly origins");
  out.push("DATABASE_URL='...' pnpm exec tsx scripts/freeze-artifact.ts");
  for (const run of params.runs) {
    out.push(
      `DATABASE_URL='...' pnpm evaluation:run --era ${run.era} ` +
        `--artifact config/registered-artifact.json --out evaluation-${run.era}.json`,
    );
  }
  out.push('```');
  out.push('');

  return out.join('\n') + '\n';
}
