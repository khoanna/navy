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
import {
  ERAS_IN_ORDER,
  HELDOUT_D_MIN_ORIGINS,
  eraBounds,
  isOpenEnded,
  releasePowered,
  type EraTag,
} from '../eras.js';
import {
  ablationContributions,
  type ForkReplayResult,
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
  /**
   * §11.1's pinned-prestate fork replay outcomes, when one was produced.
   * `undefined` means NOT PRODUCED — the same fact the gate check reports —
   * and is serialised as such rather than omitted, so the machine-readable
   * half of the deliverable knows about §11.1 through data and not only
   * through a prose string inside a check detail.
   */
  forkResults?: readonly ForkReplayResult[] | undefined;
  /**
   * Figure files written alongside the report for this era, referenced by
   * relative path. Emitted as separate `.svg` rather than inline markup
   * because inline SVG is stripped by GitHub and by several editor previews,
   * and a figure that silently vanishes is worse than none.
   */
  figures?: readonly { filename: string; caption: string }[];
  /** P37 (paper v0.11): the policy gate graded under the amendment. Absent = NOT PRODUCED. */
  gateP37?: RegisteredGateResult | undefined;
  /** Missing hourly origins in the evaluated window; the release verdict needs 0. */
  originGaps?: number | undefined;
}

export type VerdictStatus = 'PASS' | 'FAIL' | 'NOT YET POWERED' | 'NOT RUN';

export interface EraVerdict {
  era: EraTag;
  forecast: 'PASS' | 'FAIL' | 'NOT PRODUCED';
  policy: 'PASS' | 'FAIL' | 'NOT PRODUCED';
  blocked: string[];
}

export interface VerdictLine {
  status: VerdictStatus;
  eras: EraVerdict[];
  note: string;
}

export interface ThreeVerdicts {
  /** The registered v0.10 gates on `heldout-c` + `heldout-b`. */
  registered: VerdictLine;
  /** P37's gates on the same two eras — POST-HOC, since P37 was designed after both were read. */
  p37PostHoc: VerdictLine;
  /** P37's gates on `heldout-d`, graded only once it is powered. */
  release: VerdictLine;
}

const DESIGN_ERAS: readonly EraTag[] = ['heldout-c', 'heldout-b'];

function eraVerdict(run: RunSummary, amended: boolean): EraVerdict {
  const fg = amended ? run.evaluation.forecastGateP37 : run.evaluation.forecastGate;
  const pg = amended ? run.gateP37 : run.gate;
  return {
    era: run.era,
    forecast: fg === undefined ? 'NOT PRODUCED' : fg.pass ? 'PASS' : 'FAIL',
    policy: pg === undefined ? 'NOT PRODUCED' : pg.pass ? 'PASS' : 'FAIL',
    blocked: [
      ...(fg === undefined ? ['forecast gate NOT PRODUCED'] : fg.blockedReasons.map((b) => `forecast: ${b}`)),
      ...(pg === undefined ? ['policy gate NOT PRODUCED'] : pg.blockedReasons.map((b) => `policy: ${b}`)),
    ],
  };
}

function designEraLine(runs: readonly RunSummary[], amended: boolean, note: string): VerdictLine {
  const present = DESIGN_ERAS.map((era) => runs.find((r) => r.era === era)).filter(
    (r): r is RunSummary => r !== undefined,
  );
  const eras = present.map((r) => eraVerdict(r, amended));
  const missing = DESIGN_ERAS.filter((era) => !present.some((r) => r.era === era));
  const pass = missing.length === 0 && eras.every((e) => e.forecast === 'PASS' && e.policy === 'PASS');
  return {
    status: pass ? 'PASS' : 'FAIL',
    eras,
    note: missing.length === 0 ? note : `${note} Missing era(s): ${missing.join(', ')}.`,
  };
}

/**
 * P37's three verdicts (paper v0.11). PURE, and the only place they are decided.
 *
 *  1. Registered v0.10 — the unchanged gates on `heldout-c` + `heldout-b`.
 *  2. P37, post-hoc — the amended gates on the same eras, which P37 was
 *     designed after reading; never a test of P37.
 *  3. Release — the amended gates on `heldout-d`, graded only once it holds
 *     HELDOUT_D_MIN_ORIGINS origins with zero gaps. A missing P37 gate is NOT
 *     PRODUCED and never passes.
 */
export function threeVerdicts(runs: readonly RunSummary[]): ThreeVerdicts {
  const d = runs.find((r) => r.era === 'heldout-d');
  let release: VerdictLine;
  if (d === undefined) {
    release = {
      status: 'NOT RUN',
      eras: [],
      note: '`heldout-d` was not evaluated in this run, so the release verdict blocks.',
    };
  } else if (!releasePowered(d.datasetOrigins, d.originGaps ?? Number.POSITIVE_INFINITY)) {
    release = {
      status: 'NOT YET POWERED',
      eras: [eraVerdict(d, true)],
      note:
        `\`heldout-d\` holds ${d.datasetOrigins} origins with ` +
        `${d.originGaps === undefined ? 'an unmeasured number of' : d.originGaps} gap(s); the ` +
        `release verdict needs ${HELDOUT_D_MIN_ORIGINS} with zero gaps, so it blocks.`,
    };
  } else {
    const v = eraVerdict(d, true);
    release = {
      status: v.forecast === 'PASS' && v.policy === 'PASS' ? 'PASS' : 'FAIL',
      eras: [v],
      note: 'The amended gates on data P37 has not seen.',
    };
  }
  return {
    registered: designEraLine(runs, false, 'The registered gates exactly as run.'),
    p37PostHoc: designEraLine(
      runs,
      true,
      'POST-HOC: P37 was designed after both eras were opened, so this line is not a test of P37.',
    ),
    release,
  };
}

function threeVerdictsSection(v: ThreeVerdicts): string[] {
  const out: string[] = ['## Verdicts under Amendment P37 (paper v0.11)', ''];
  out.push(
    'No registered threshold value moved. P37 changes what three gates measure — P34\'s forecast ' +
      'domain and redeemability attribution, one-sided coverage tests, and the fork replay scoped ' +
      'to SRCLA\'s own plans — and scopes the release to vaults up to 1,000,000 USDC.',
  );
  out.push('');
  const line = (title: string, l: VerdictLine): void => {
    out.push(`**${title}: ${l.status}** — ${l.note}`);
    out.push('');
    for (const e of l.eras) {
      out.push(
        `- \`${e.era}\`: forecast ${e.forecast}, policy ${e.policy}` +
          (e.blocked.length > 0 ? ` — blocked on ${e.blocked.join('; ')}` : ''),
      );
    }
    if (l.eras.length > 0) out.push('');
  };
  line('1. Registered v0.10', v.registered);
  line('2. P37, post-hoc', v.p37PostHoc);
  line('3. Release (`heldout-d`)', v.release);
  return out;
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
  /**
   * Disclosures the RUN cannot derive from its own inputs: how the registered
   * artifact came to be frozen, and known defects in the archive it was frozen
   * against. These are facts about this repository's history, so the caller
   * supplies them rather than the renderer hardcoding them — but they are
   * REQUIRED reading, so they render as their own sections and not footnotes.
   */
  disclosures?: {
    /** How and when the registered artifact was frozen, and against what. */
    artifactFreeze?: readonly string[];
    /** Known archive-read inconsistencies surviving in the evaluated data. */
    archive?: readonly string[];
    /** Reproducibility caveats — e.g. hash formats that changed. */
    reproducibility?: readonly string[];
  };
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
 * OPEN-ENDED ERAS. `heldout-d` (P37: paper v0.11) is now the open-ended era —
 * `heldout-b` was closed at `P37_FREEZE_SECONDS` — so rendering
 * `eraBounds().end` and `.days` for `heldout-d` would print the far-future
 * sentinel's date and day count in a published document. Such an era's End
 * and Days are reported as `open`.
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
    'An era with an End of `open` (`heldout-d`) is SEALED, so it grows only as new origins ' +
      'are backfilled (`pnpm backfill:history`) -- ruling R30 refuses live-collector rows in ' +
      'any sealed era. Its effective end is whenever the backfill last ran, reported per era ' +
      'in the measured-coverage table below.',
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

/**
 * WHY capital sits idle, attributed to a component rather than guessed.
 *
 * A low `capitalAtWorkFraction` is the single fact that decides §11.5's
 * demonstration check, and the run record alone cannot say WHICH mechanism
 * withheld the capital. Each registered ablation removes exactly one
 * component, so the difference between SRCLA and an ablation at the same tier
 * attributes the idleness to what that ablation removed. An ablation that
 * moves it materially is the cause; one that does not exonerates its
 * component, which is just as much a finding -- it rules out the explanations
 * a reader would otherwise reach for.
 */
function idleAttributionSection(evaluation: RegisteredEvaluationResult): string {
  const out: string[] = [];
  const tiers = [...new Set(evaluation.results.map((r) => r.tier.toString()))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  const at = (id: string, tier: string): PolicyRunResult | undefined =>
    evaluation.results.find((r) => r.policy.id === id && r.tier.toString() === tier);

  const srclaRows = tiers.map((t) => at('srcla', t));
  if (srclaRows.every((r) => r === undefined)) return '_No SRCLA run to attribute._';

  out.push(
    'Capital at work is what decides the demonstration check, and a bare number cannot say ' +
      'WHICH mechanism withheld the capital. Every registered ablation removes exactly one ' +
      'component, so the row-to-row difference below attributes the idleness. **An ablation ' +
      'that does not move the number exonerates its component** — that is a finding too, and ' +
      'it rules out the explanations a reader would otherwise reach for.',
  );
  out.push('');
  out.push(
    `| Policy | Removes | ${tiers.map((t) => `${usdc(BigInt(t))}`).join(' | ')} |`,
  );
  out.push(`|---|---|${tiers.map(() => '---').join('|')}|`);
  // `capitalAtWorkFraction` is absent on a run record written before §11.4's
  // deployment metrics existed. Render that as unmeasured rather than
  // throwing, and never as 0 -- an absent measurement is not an idle vault.
  const capAtWork = (r: PolicyRunResult | undefined): number | undefined =>
    r === undefined ? undefined : (r.replay.capitalAtWorkFraction as number | undefined);
  const cell = (r: PolicyRunResult | undefined): string => {
    const v = capAtWork(r);
    return v === undefined ? '—' : v.toFixed(3);
  };
  out.push(
    `| \`srcla\` | _nothing — the full controller_ | ` +
      `${tiers.map((t) => `**${cell(at('srcla', t))}**`).join(' | ')} |`,
  );
  for (const ab of REGISTERED_ABLATIONS) {
    const rows = tiers.map((t) => at(ab.id, t));
    if (rows.every((r) => r === undefined)) continue;
    // The largest gain this ablation produces at any tier. Anything at or
    // below a few points is inside the noise of a different rebalance path.
    const gains = tiers.map((t) => {
      const a = at(ab.id, t);
      const b = at('srcla', t);
      const av = capAtWork(a);
      const bv = capAtWork(b);
      return av === undefined || bv === undefined ? 0 : av - bv;
    });
    const best = Math.max(...gains);
    const mark = best >= 0.05 ? ' **← restores deployment**' : '';
    out.push(
      `| \`${ab.id}\` | ${ab.paperDefinition.replace(/\s+/g, ' ').slice(0, 70)} | ` +
        `${tiers.map((t) => cell(at(ab.id, t))).join(' | ')} |${mark}`,
    );
  }
  out.push('');
  return out.join('\n');
}

/**
 * Was the tier beyond what the venues could absorb, or did the policy simply
 * decline to use capacity that was there?
 *
 * These are opposite conclusions with the same symptom -- idle capital -- and
 * a report that does not separate them invites the reading that a cautious
 * policy was merely respecting a liquidity ceiling. The discriminating
 * evidence is other policies at the SAME tier: if one deployed materially
 * more while keeping stressed coverage at the floor and still exiting, the
 * capacity was there and the idleness was self-imposed. If every policy that
 * deployed further lost coverage, the ceiling is real.
 */
function capacityFrontierSection(evaluation: RegisteredEvaluationResult): string {
  const out: string[] = [];
  const tiers = [...new Set(evaluation.results.map((r) => r.tier.toString()))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  out.push(
    'Idle capital has two opposite explanations — the venues could not absorb the tier, or ' +
      'the policy declined capacity that was available — and they carry opposite verdicts. ' +
      'The discriminating evidence is the other policies at the SAME tier. Rows are sorted by ' +
      'how much each deployed; read down until stressed coverage collapses. **That is the ' +
      'frontier.** A policy sitting well below it with coverage intact was not constrained by ' +
      'the market.',
  );
  out.push('');
  for (const tier of tiers) {
    const rows = evaluation.results
      .filter((r) => r.tier.toString() === tier)
      .slice()
      .sort(
        (a, b) =>
          ((b.replay.capitalAtWorkFraction as number | undefined) ?? -1) -
          ((a.replay.capitalAtWorkFraction as number | undefined) ?? -1),
      );
    out.push(`**Tier ${usdc(BigInt(tier))} USDC**`);
    out.push('');
    out.push('| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |');
    out.push('|---|---|---|---|---|---|');
    for (const r of rows) {
      const isSrcla = r.policy.id === 'srcla';
      const name = isSrcla ? `**\`srcla\`**` : `\`${r.policy.id}\``;
      out.push(
        `| ${name} | ${(r.replay.capitalAtWorkFraction as number | undefined)?.toFixed(3) ?? '—'} | ` +
          `${pct(r.replay.coverageDistribution.min, 3)} | ${exitCell(r)} | ` +
          `${pct(r.replay.realizedNetApy)} | ${gapCell(r)} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
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
function sustainabilityTable(
  gate: RegisteredGateResult,
  opts: { scaleInvarianceFooter?: boolean } = {},
): string {
  const { scaleInvarianceFooter = true } = opts;
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
        // M-2: an S2 breach P37 attributed to a VENUE FAILURE clears S2 (a
        // bare `mark(v.s2)` PASS) with `v.breach` left null, so the out-of-
        // scope (10M) table -- and any other P37 row carrying an attribution
        // -- printed a plain PASS with no sign the floor was ever missed.
        // `s2Attribution.detail` names the attribution kind and the trapped
        // share whenever it is present; v0.10 never sets the field, so this
        // is byte-identical there.
        `${pct(v.realizedNetApy)} | ${v.s2Attribution?.detail ?? v.breach ?? '—'} |`,
    );
  const invariant = gate.scaleInvariant;
  const out = [
    `Demonstration floor: capital at work >= **${REGISTERED_DEMONSTRATION_FLOOR}**. Below it a run ` +
      'is trivially redeemable and demonstrates nothing, so every criterion reports **ND** (NOT ' +
      'DEMONSTRATED) and no sustainability claim may be drawn from it.',
    '',
    '**What S3 and S4 do NOT cover.** Two of §11.5 part 3\'s clauses are not measured by this ' +
      'run, and the columns are named for what they measure rather than for the clause:',
    '',
    '- **S3** grades only the venue-stress bound. §11.5 S3\'s first clause — that the vault\'s ' +
      'own deposits do not push a venue past its **registered utilization ceiling** — is **NOT ' +
      'EVALUATED**. A PASS in that column is not evidence about the ceiling.',
    '- **S4** grades **action validity**: no deploy into a paused or absent venue, and no divest ' +
      'from a venue holding nothing. §11.5 S4\'s named classes — **cap, dependency, reserve and ' +
      'loss violations, and unrecoverable plan state** — are **NOT EVALUATED**. A PASS in that ' +
      'column is not evidence that no cap or reserve was breached.',
    '',
    '| Tier | Demonstrated | S1 redeem | S2 coverage | S3 venue stress | S4 action validity | Verdict | Net APY | Breach |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ];
  if (scaleInvarianceFooter) {
    out.push('');
    out.push(
      `**Scale invariance (P26):** ${
        invariant === true
          ? 'sustainable at EVERY registered tier.'
          : invariant === false
            ? '**NOT scale invariant** — a breach at any tier is a breach, and no average over tiers may stand in for it.'
            : '**NOT DEMONSTRATED** — at least one tier proved nothing, and a tier that proved nothing cannot be counted as invariant.'
      }`,
    );
  }
  return out.join('\n');
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
  // ABSENCE IS NOT A RESULT. An empty verdict list means NO COMPARATOR WAS
  // GRADED, which is silence about the paper's headline quantity; an empty
  // BREACHING list drawn from a nonempty verdict list is the measured claim
  // that every graded comparator was sustainable. Rendering the first as the
  // second published a positive finding from a measurement never produced.
  if (verdicts.length === 0) {
    return (
      '**NOT PRODUCED.** No comparator sustainability verdict was graded for this run, so the ' +
      'price of unsustainability was not measured. This is an ABSENT measurement, not a finding ' +
      'that no comparator breached.'
    );
  }
  const breaching = verdicts.filter((v) => v.sustainable !== true);
  if (breaching.length === 0)
    return `_All ${verdicts.length} graded comparator run(s) were sustainable: there is nothing to price._`;

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

  // ---- What is being claimed, BEFORE any number. --------------------------
  // WHY THIS IS FIRST. Without it a reader arrives at a table of APYs and
  // reads the study as a yield contest, and every subsequent caveat reads as
  // an excuse for a number that lost. The claim is not that SRCLA earns the
  // most; it is that it stays redeemable while earning a rate that is not
  // materially worse. §11.5 is ordered to match, and so is this document.
  out.push('## What this study claims — and what it does not');
  out.push('');
  out.push(
    'This report evaluates **sustainability**, not yield superiority. The claim under test ' +
      'is that SRCLA remains **redeemable, liquid and within its own limits at every ' +
      'registered scale**, while earning a rate that is **not materially worse** than a ' +
      'baseline that is itself sustainable at that scale.',
  );
  out.push('');
  out.push(
    'The motivation is that the highest advertised APY is frequently the least redeemable ' +
      'one. A rate is quoted on a venue at a utilization the quote itself helped create; ' +
      'a depositor large enough to move that utilization is a depositor who cannot leave ' +
      'without moving it back. §11.4 measures three quantities that a yield table cannot ' +
      'show: how long a full exit takes, how much of a venue the vault itself became, and ' +
      'how far the **displayed** rate sat above the rate actually **realized**.',
  );
  out.push('');
  out.push('Concretely, this report does **not** claim, and must not be cited as claiming:');
  out.push('');
  out.push('- that SRCLA earns the highest return among the policies evaluated;');
  out.push(
    '- that a policy excluded from the yield comparison was outperformed — it was excluded ' +
      'for **breaching a sustainability criterion SRCLA is held to**, and its return is ' +
      'published in full as the measured price of that breach;',
  );
  out.push(
    '- that any figure here describes real user redemption behaviour (withdrawals are a ' +
      'registered schedule — see below).',
  );
  out.push('');
  out.push(
    'The release decision therefore reads in §11.5\'s order: **demonstration → completeness → ' +
      'sustainability → yield**. A run that is not sustainable at every registered tier does ' +
      'not reach the yield question at all, however well it scored on it.',
  );
  out.push('');

  // ---- Verdict. -----------------------------------------------------------
  // Every gate's blocked reasons used to be joined with '; ' into one
  // paragraph per era, which for a run that blocks on ten forecast checks and
  // eight policy checks is a wall of text nobody reads to the end. The
  // release decision is the single most important line in this document, so
  // it is stated once, in the imperative, and then itemised.
  const anyBlocked = params.runs.some((r) => !r.evaluation.forecastGate.pass || !r.gate.pass);
  // I-2: computed once and reused below (`threeVerdictsSection`) so the
  // banner and the "Verdicts under Amendment P37" section can never disagree
  // about what `heldout-d` did.
  const verdicts = threeVerdicts(params.runs);
  out.push('## Verdict');
  out.push('');
  if (verdicts.release.status !== 'NOT RUN') {
    // (a) `heldout-d` was evaluated: the release line is the ONLY verdict
    // this banner may be drawn from -- the registered v0.10 result on
    // `heldout-c`/`heldout-b` is frozen FAIL and would otherwise pin this
    // banner to DO NOT RELEASE forever, even once release itself passes.
    out.push(
      verdicts.release.status === 'PASS'
        ? '> **RELEASE.** The release verdict (`heldout-d`, Amendment P37) passed both §11.5 ' +
            'gates. The registered v0.10 and P37 post-hoc verdicts on `heldout-c`/`heldout-b` ' +
            'are reported beside it below and do not decide release.'
        : '> **DO NOT RELEASE.** The release verdict (`heldout-d`, Amendment P37) did not pass ' +
            'both §11.5 gates. The registered v0.10 and P37 post-hoc verdicts on ' +
            '`heldout-c`/`heldout-b` are reported beside it below and do not decide release.',
    );
  } else {
    // (b) No `heldout-d` run in this report. Keep the pre-P37 sentence pair
    // byte-identical -- it still decides between the two branches on
    // `anyBlocked` exactly as before -- and add ONE sentence, on its own
    // line, naming where the actual release decision lives.
    out.push(
      anyBlocked
        ? '> **DO NOT RELEASE.** At least one registered era blocked at least one §11.5 gate. ' +
            'The blocking checks are itemised below and evidenced in full further down.'
        : '> **RELEASE.** Every registered era passed both §11.5 gates at every registered tier.',
    );
    out.push('');
    out.push(
      'The release decision under Amendment P37 is the `heldout-d` line under "Verdicts ' +
        'under Amendment P37" below, which this run did not produce.',
    );
  }
  out.push('');
  for (const run of params.runs) {
    const span = isOpenEnded(run.era) ? 'open-ended' : `${eraBounds(run.era).days}d`;
    out.push(`### \`${run.era}\` — ${span}, ${run.datasetOrigins} origins`);
    out.push('');
    const fg = run.evaluation.forecastGate;
    out.push(`**Forecast gate: ${fg.pass ? 'PASS' : 'FAIL'}**`);
    if (!fg.pass) {
      out.push('');
      for (const b of fg.blockedReasons) out.push(`- ${b}`);
    }
    out.push('');
    out.push(`**Policy gate: ${run.gate.pass ? 'PASS' : 'FAIL'}**`);
    if (!run.gate.pass) {
      out.push('');
      for (const b of run.gate.blockedReasons) out.push(`- ${b}`);
    }
    out.push('');
  }
  out.push(
    'A `FAIL` here is a result, not an error. §11.5 requires publishing a negative ' +
      'result rather than retuning against held-out data, and nothing in this run was ' +
      'retuned after a sealed era was opened.',
  );
  out.push('');
  out.push(...threeVerdictsSection(verdicts));

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
  // I-1 fix: the sentence above describes `heldout-b` as it was registered
  // for the v0.10 verdict, before Amendment P37 existed to read it. It must
  // not stand alone once P37 (paper v0.11) makes `heldout-b` design data too
  // (the fourth burned-window declaration) -- the report otherwise contradicts
  // its own "Verdicts under Amendment P37" section a few paragraphs down.
  out.push(
    'That statement describes `heldout-b` as it was registered for the v0.10 verdict. Under ' +
      'Amendment P37 (paper v0.11), `heldout-b` is design data too — its per-venue and ' +
      'per-policy results were read to design G1, G3 and G5 — so only `heldout-d` carries no ' +
      'design knowledge. "Neither alone is sufficient" above applies to the registered v0.10 ' +
      'verdict; release itself is decided by `heldout-d` alone (see "Verdicts under Amendment ' +
      'P37" below).',
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

  // ---- Disclosures the run cannot derive from its own inputs. -------------
  const d = params.disclosures;
  if (d?.archive !== undefined && d.archive.length > 0) {
    out.push('### Known archive-read inconsistencies');
    out.push('');
    out.push(
      'The archive is read from Base mainnet at historical blocks, and a historical read can ' +
        'be wrong in ways a gap check does not catch. Every such defect found is listed here ' +
        'with its measured magnitude, whether or not it changes a result.',
    );
    out.push('');
    for (const n of d.archive) out.push(`- ${n}`);
    out.push('');
  }
  if (d?.reproducibility !== undefined && d.reproducibility.length > 0) {
    out.push('### Reproducibility caveats');
    out.push('');
    for (const n of d.reproducibility) out.push(`- ${n}`);
    out.push('');
  }

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

  if (d?.artifactFreeze !== undefined && d.artifactFreeze.length > 0) {
    out.push('### Freeze provenance');
    out.push('');
    out.push(
      'A registered artifact is frozen before any sealed era is opened and is never refit ' +
        'afterwards. How this one came to be frozen, and against what:',
    );
    out.push('');
    for (const n of d.artifactFreeze) out.push(`- ${n}`);
    out.push('');
  }

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
    if (run.figures !== undefined && run.figures.length > 0) {
      out.push('### Figures');
      out.push('');
      out.push(
        'Vault size is on a logarithmic axis in all three: the registered tiers span ' +
          'three decades, and a linear axis compresses 10k, 100k and 1M into the first ' +
          'tenth of the width — which is exactly the range where the controller behaves ' +
          'well.',
      );
      out.push('');
      for (const f of run.figures) {
        out.push(`![${f.filename}](${f.filename})`);
        out.push('');
        out.push(f.caption);
        out.push('');
      }
    }
    out.push('### Sustainability — the primary release criterion (§11.5)');
    out.push('');
    out.push(sustainabilityTable(run.gate));
    out.push('');
    out.push('### The price of unsustainability (§11.5 part 3)');
    out.push('');
    out.push(counterexampleTable(run.gate));
    out.push('');
    out.push('### Why capital sits idle — attributed to a component, not guessed');
    out.push('');
    out.push(idleAttributionSection(run.evaluation));
    out.push('');
    out.push('### The capacity frontier — was the tier beyond the venues, or was the capacity declined?');
    out.push('');
    out.push(capacityFrontierSection(run.evaluation));
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
    // P37 (paper v0.11): the same run under the amendment — post-hoc on
    // heldout-c and heldout-b, the release gates on heldout-d.
    if (run.evaluation.forecastGateP37 !== undefined) {
      out.push('### §11.5 forecast gate under P37');
      out.push('');
      out.push(gateTable(run.evaluation.forecastGateP37));
      out.push('');
    }
    if (run.gateP37 !== undefined) {
      out.push('### §11.5 policy gate under P37');
      out.push('');
      out.push(gateTable(run.gateP37));
      out.push('');
      out.push(
        'P37 decides its comparisons, comparator sustainability, excluded comparators, skill ' +
          'windows and price of unsustainability over the release tiers (10k/100k/1M) only — ' +
          'the 10M results for this era are the registered (v0.10) tables above, not repeated here.',
      );
      out.push('');
      const outOfScope = run.gateP37.outOfScopeSustainability ?? [];
      if (outOfScope.length > 0) {
        out.push('#### Outside the release scope (10M) — reported, never gating (G5)');
        out.push('');
        out.push(
          sustainabilityTable({ ...run.gateP37, sustainability: outOfScope }, { scaleInvarianceFooter: false }),
        );
        out.push('');
      }
    }
  }

  // ---- Limitations. -------------------------------------------------------
  out.push('## Limitations');
  out.push('');
  // The fork-replay limitation is CONDITIONAL: once a run supplies replays,
  // printing "not produced" beneath a gate line that says otherwise would be
  // a false limitation, which is as misleading as a missing one.
  //
  // I-3: a lookup keyed on the v0.10 check name alone never sees the P37
  // fork check (`'§11.1 pinned-prestate fork replay (SRCLA plans, P37)'`,
  // `gates.ts:788-789`), so a P37 run whose SRCLA plans DID execute still
  // published "this run supplied none" beneath a passing P37 fork line.
  // Branch three ways, reading BOTH names, and distinguish "no replay was
  // ever supplied" (the check detail starts with the literal prefix below)
  // from "a replay was supplied but did not fully execute" -- only the first
  // of those two is the pre-existing NOT-PRODUCED sentence.
  const NOT_SUPPLIED_PREFIX = 'NOT PRODUCED: no fork replay';
  interface ForkCheckRef {
    era: EraTag;
    amendment: 'v0.10' | 'p37';
    check: RegisteredGateCheck;
  }
  const forkCheckRefs: ForkCheckRef[] = [];
  for (const r of params.runs) {
    const v10 = r.gate.checks.find((c) => c.name === '§11.1 pinned-prestate fork replay');
    if (v10 !== undefined) forkCheckRefs.push({ era: r.era, amendment: 'v0.10', check: v10 });
    const p37Check = r.gateP37?.checks.find(
      (c) => c.name === '§11.1 pinned-prestate fork replay (SRCLA plans, P37)',
    );
    if (p37Check !== undefined) forkCheckRefs.push({ era: r.era, amendment: 'p37', check: p37Check });
  }
  const supplied = forkCheckRefs.filter((f) => !f.check.detail.startsWith(NOT_SUPPLIED_PREFIX));
  const everyRequiredExecuted = supplied.length > 0 && supplied.every((f) => f.check.passed === true);

  if (supplied.length === 0) {
    // (i) No replay was supplied anywhere in this report — byte-identical to
    // the sentence this report has always printed in that case.
    out.push(
      '- **§11.1\'s pinned-prestate fork replay is not produced.** ' +
        '`src/evaluation/fork-runner.ts#runForkReplays` produces it and needs a live Base ' +
        'fork with the vault deployed; this run supplied none, so the gate reports NOT ' +
        'PRODUCED and blocks. No allocation in this report has been shown to be one the ' +
        'chain would have accepted.',
    );
  } else if (everyRequiredExecuted) {
    // (iii) Every run executed — the pre-existing honest PARTIAL, unchanged.
    out.push(
      '- **§11.1\'s pinned-prestate fork replay is an honest PARTIAL.** What was shown: each ' +
        'registered (policy, tier)\'s FIRST proposed rebalance was submitted and executed ' +
        'against the deployed vault on a Base fork, from a pinned prestate verified restored ' +
        'before every candidate. What was NOT shown: the era\'s remaining origins and its ' +
        'returns were not replayed on chain; all four tiers were replayed against a SINGLE ' +
        'vault NAV, so `capBps`, `minIdleBps` and the reserve were evaluated at that NAV ' +
        'rather than at each tier\'s scale; and the pinned prestate is all-idle, which is why ' +
        'the first proposal is the origin selected — a later origin would contain divests ' +
        'that no unfunded prestate could execute.',
    );
  } else {
    // (ii) A replay was supplied, but not every required run executed. Name
    // what did not execute (from the check's own detail) and say whether
    // SRCLA's own plans executed, read from the P37 check when one exists —
    // a refused BASELINE plan does not mean SRCLA's own plan was refused.
    const notExecuted = supplied.filter((f) => f.check.passed !== true);
    const p37Refs = supplied.filter((f) => f.amendment === 'p37');
    const srclaExecuted = p37Refs.length === 0 ? undefined : p37Refs.every((f) => f.check.passed === true);
    out.push(
      '- **§11.1\'s pinned-prestate fork replay was supplied, but not every required run ' +
        'executed on chain.** ' +
        notExecuted.map((f) => `\`${f.era}\` (${f.amendment}): ${f.check.detail}`).join(' ') +
        ' ' +
        (srclaExecuted === undefined
          ? 'Whether SRCLA\'s own plans executed is not distinguished for this run: no P37 ' +
            'fork check (which scopes to SRCLA\'s own plans) was produced.'
          : srclaExecuted
            ? 'SRCLA\'s own plans DID execute at every release tier under Amendment P37 — the ' +
              'failure above belongs to a baseline or an out-of-scope tier, not to an SRCLA ' +
              'refusal.'
            : 'SRCLA\'s own plans did NOT execute at every release tier under Amendment P37 — ' +
              'see the P37 fork line above for which one.'),
    );
  }
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
