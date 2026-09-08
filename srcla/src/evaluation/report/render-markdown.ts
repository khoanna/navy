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
import { ERAS_IN_ORDER, eraBounds, type EraTag } from '../eras.js';
import type { RegisteredGateResult } from '../kernel/gates.js';
import type { RegisteredEvaluationResult } from '../kernel/harness.js';

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
}

const pct = (x: number, dp = 3): string => `${(x * 100).toFixed(dp)}%`;
const usdc = (base: bigint): string =>
  (Number(base) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 });

function eraTable(): string {
  const rows = ERAS_IN_ORDER.map((e) => {
    const b = eraBounds(e.tag);
    return `| \`${e.tag}\` | ${b.start.slice(0, 10)} | ${b.end.slice(0, 10)} | ${b.days} | ${e.sealed ? '**sealed**' : '—'} | ${e.role.split('.')[0]}. |`;
  });
  return [
    '| Era | Start | End | Days | Sealed | Role |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function gateTable(gate: RegisteredGateResult): string {
  const rows = gate.checks.map((c) => {
    const mark = c.passed === true ? 'PASS' : c.passed === false ? '**FAIL**' : '**NOT PRODUCED**';
    return `| ${mark} | ${c.name} | ${c.detail.replace(/\|/g, '\\|').slice(0, 300)} |`;
  });
  return ['| Verdict | Check | Detail |', '|---|---|---|', ...rows].join('\n');
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
          `${r.inertVsSrcla ? '**INERT**' : '—'} |`,
      );
    sections.push(
      `#### Tier ${usdc(BigInt(tier))} USDC\n\n` +
        [
          '| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Ablation |',
          '|---|---|---|---|---|---|---|---|',
          ...rows,
        ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

function comparisonTable(gate: RegisteredGateResult): string {
  if (gate.comparisons.length === 0) {
    return '_No SRCLA-vs-baseline comparison was produced._';
  }
  const rows = gate.comparisons.map(
    (c) =>
      `| ${usdc(BigInt(c.tier))} | \`${c.baselineId}\` | ${pct(c.srclaNetApy)} | ${pct(c.baselineNetApy)} | ` +
      `${c.test.usable ? c.test.pValue.toFixed(4) : `not usable (${c.test.reason})`} | ` +
      `${c.bootstrap.usable ? `[${c.bootstrap.lower.toExponential(2)}, ${c.bootstrap.upper.toExponential(2)}]` : 'not usable'} |`,
  );
  return [
    '| Tier | Baseline | SRCLA | Baseline | paired HAC p | bootstrap 95% CI of difference |',
    '|---|---|---|---|---|---|',
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
    out.push(
      `- **${run.era}** (${eraBounds(run.era).days}d, ${run.datasetOrigins} origins): ` +
        `§11.5 release gate **${run.gate.pass ? 'PASS' : 'FAIL'}**` +
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
  out.push('**Two deviations are disclosed, not buried:**');
  out.push('');
  out.push(
    '1. Paper §4.1 says the burned window "lies inside the calibration era". Here it ' +
      'lies in **neither** era. Putting it in calibration would place fitting data *after* ' +
      'held-out A in time, inverting walk-forward order and creating exactly the look-ahead ' +
      '§7.3 forbids. Excluding it satisfies §4.1\'s purpose — the window must never be ' +
      'held-out — strictly more than including it would. This is a paper-owner decision.',
  );
  out.push(
    '2. Held-out A **precedes** the burned window in time. The amendments P1–P8 and the ' +
      'code were designed with knowledge of May–Aug 2026. Nobody has looked at Sep 2025 – ' +
      'May 2026, so there is no direct contamination, but a designer who knew the later ' +
      'period could in principle have chosen mechanisms that suit the earlier one. ' +
      'Held-out B is chronologically clean and carries no such caveat. **Both are reported: ' +
      'A for statistical power, B for temporal purity. Neither alone is sufficient.**',
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
      ? `P8's no-trade band multiplier \`k\` resolved to **${a.noTradeBandK}** on the calibration era.`
      : `**P8's \`k\` did not resolve.** The sweep was inconclusive, so \`k\` remains at ` +
          `${a.noTradeBandK} as a registered default and every P8 result is provisional. A value ` +
          `chosen because it moves a gate would not be a registration.`,
  );
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
    out.push(resultsTable(run.evaluation));
    out.push('');
    out.push('### SRCLA against each deployable baseline');
    out.push('');
    out.push(comparisonTable(run.gate));
    out.push('');
    out.push('### §11.5 gate');
    out.push('');
    out.push(gateTable(run.gate));
    out.push('');
  }

  // ---- Limitations. -------------------------------------------------------
  out.push('## Limitations');
  out.push('');
  out.push(
    '- **§11.1\'s pinned-prestate fork replay is not produced.** ' +
      '`src/evaluation/fork-runner.ts` is the scaffold for it and is wired to nothing, so ' +
      'the gate reports NOT PRODUCED and blocks. No allocation in this report has been ' +
      'shown to be one the chain would have accepted.',
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
