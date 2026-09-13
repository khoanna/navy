/**
 * Figures for `SRCLA-REPORT.md`, emitted as standalone SVG files.
 *
 * WHY FILES AND NOT INLINE SVG. Inline `<svg>` in Markdown is stripped by
 * GitHub and by several editor previews, and a figure that silently vanishes
 * is worse than no figure. Separate `.svg` files referenced with `![](...)`
 * render everywhere and can be dropped straight into LaTeX or Word, which is
 * what a published version needs.
 *
 * THEME. The report is read on light and dark backgrounds. Strokes carry their
 * own colour, and text uses `currentColor` via an explicit fill that reads on
 * both, rather than relying on a background that may not be there.
 *
 * PURE: builds strings. The caller writes them.
 */
import type { PolicyRunResult, RegisteredEvaluationResult } from '../kernel/harness.js';

const W = 760;
const H = 420;
const PAD = { top: 34, right: 148, bottom: 54, left: 68 };

/** Colour-blind-safe, and distinguishable in greyscale print. */
const SERIES: Record<string, { colour: string; width: number; dash?: string }> = {
  srcla: { colour: '#0b5cad', width: 3.2 },
  b0: { colour: '#8c8c8c', width: 1.4, dash: '2 3' },
  b1: { colour: '#d1495b', width: 1.8 },
  b2: { colour: '#00798c', width: 1.8 },
  b2u: { colour: '#30638e', width: 1.6, dash: '5 3' },
  b3: { colour: '#edae49', width: 1.8 },
  b4: { colour: '#9b5de5', width: 1.8 },
};

/**
 * Round an axis maximum up to a value whose quarter-divisions read cleanly.
 * A raw `max * 1.15` produces ticks like 0.26 / 0.53 / 0.79, which a reader
 * has to decode rather than read.
 */
export function niceMax(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * mag >= raw) return step * mag;
  }
  return 10 * mag;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Vault tiers span three decades, so the size axis is logarithmic. A linear
 *  axis puts 10k, 100k and 1M inside the first 10% of the width and hides
 *  exactly the range where the controller behaves well. */
const xOf = (tier: number, lo: number, hi: number): number =>
  PAD.left +
  ((Math.log10(tier) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) *
    (W - PAD.left - PAD.right);

const usdShort = (base: number): string => {
  const u = base / 1e6;
  if (u >= 1e6) return `$${u / 1e6}M`;
  if (u >= 1e3) return `$${u / 1e3}k`;
  return `$${u}`;
};

export interface ChartSeries {
  policyId: string;
  points: { tier: number; value: number }[];
}

/**
 * One line chart: vault size (log) against a per-policy measure.
 *
 * `floor` draws a registered threshold as a dashed rule, because a coverage
 * number means nothing to a reader who cannot see the bar it must clear.
 */
export function lineChart(opts: {
  title: string;
  yLabel: string;
  series: ChartSeries[];
  yMax: number;
  yFormat: (v: number) => string;
  floor?: { value: number; label: string };
  /**
   * A warning drawn INSIDE the figure. Captions are separated from images the
   * moment a figure is imported into LaTeX or Word, so a caveat that only
   * exists in the caption is a caveat the reader of the figure does not get.
   */
  warning?: string;
}): string {
  const tiers = [...new Set(opts.series.flatMap((s) => s.points.map((p) => p.tier)))].sort((a, b) => a - b);
  if (tiers.length === 0) return '';
  const lo = tiers[0]!;
  const hi = tiers[tiers.length - 1]!;
  const yOf = (v: number): number =>
    H - PAD.bottom - (Math.max(0, Math.min(v, opts.yMax)) / opts.yMax) * (H - PAD.top - PAD.bottom);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">`);
  out.push(`<title>${esc(opts.title)}</title>`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="${PAD.left}" y="20" font-size="15" font-weight="600" fill="#111111">${esc(opts.title)}</text>`);
  if (opts.warning !== undefined) {
    out.push(`<text x="${PAD.left}" y="${PAD.top - 2}" font-size="11" font-weight="600" fill="#c1121f">${esc(opts.warning)}</text>`);
  }

  // Horizontal grid + y labels.
  for (let i = 0; i <= 4; i++) {
    const v = (opts.yMax / 4) * i;
    const y = yOf(v);
    out.push(`<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" stroke="#e3e3e3" stroke-width="1"/>`);
    out.push(`<text x="${PAD.left - 9}" y="${(y + 4).toFixed(1)}" font-size="11" fill="#555555" text-anchor="end">${esc(opts.yFormat(v))}</text>`);
  }
  // Vertical grid + tier labels.
  for (const t of tiers) {
    const x = xOf(t, lo, hi);
    out.push(`<line x1="${x.toFixed(1)}" y1="${PAD.top}" x2="${x.toFixed(1)}" y2="${H - PAD.bottom}" stroke="#f0f0f0" stroke-width="1"/>`);
    out.push(`<text x="${x.toFixed(1)}" y="${H - PAD.bottom + 18}" font-size="11" fill="#555555" text-anchor="middle">${esc(usdShort(t))}</text>`);
  }
  out.push(`<line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="#333333" stroke-width="1.2"/>`);
  out.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="#333333" stroke-width="1.2"/>`);
  out.push(`<text x="${(PAD.left + (W - PAD.right)) / 2}" y="${H - 12}" font-size="12" fill="#333333" text-anchor="middle">Vault size (USDC, log scale)</text>`);
  out.push(`<text x="16" y="${(PAD.top + H - PAD.bottom) / 2}" font-size="12" fill="#333333" text-anchor="middle" transform="rotate(-90 16 ${((PAD.top + H - PAD.bottom) / 2).toFixed(1)})">${esc(opts.yLabel)}</text>`);

  if (opts.floor !== undefined) {
    const y = yOf(opts.floor.value);
    out.push(`<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" stroke="#c1121f" stroke-width="1.4" stroke-dasharray="7 4"/>`);
    out.push(`<text x="${W - PAD.right - 6}" y="${(y - 6).toFixed(1)}" font-size="11" fill="#c1121f" text-anchor="end">${esc(opts.floor.label)}</text>`);
  }

  let legendY = PAD.top + 6;
  for (const s of opts.series) {
    const st = SERIES[s.policyId] ?? { colour: '#666666', width: 1.5 };
    const pts = s.points.slice().sort((a, b) => a.tier - b.tier);
    if (pts.length > 0) {
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.tier, lo, hi).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
      out.push(`<path d="${d}" fill="none" stroke="${st.colour}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} stroke-linejoin="round"/>`);
      for (const p of pts) {
        out.push(`<circle cx="${xOf(p.tier, lo, hi).toFixed(1)}" cy="${yOf(p.value).toFixed(1)}" r="${s.policyId === 'srcla' ? 4.5 : 3}" fill="${st.colour}"/>`);
      }
    }
    out.push(`<line x1="${W - PAD.right + 14}" y1="${legendY}" x2="${W - PAD.right + 40}" y2="${legendY}" stroke="${st.colour}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
    out.push(`<text x="${W - PAD.right + 46}" y="${legendY + 4}" font-size="12" fill="#111111"${s.policyId === 'srcla' ? ' font-weight="700"' : ''}>${esc(s.policyId)}</text>`);
    legendY += 19;
  }
  out.push('</svg>');
  return out.join('\n');
}

/** The policies worth plotting: SRCLA plus the deployable baselines. */
export const PLOTTED = ['srcla', 'b1', 'b2', 'b2u', 'b3', 'b4'];

/**
 * Vault sizes for the FIGURES only — a denser grid than §11.1's four
 * registered tiers.
 *
 * The registered tiers are 10k / 100k / 1M / 10M and are NOT changed by this:
 * §11.1 registers exactly those four, every gate is scored on them alone, and
 * adding tiers to the gate would alter the registration. These sixteen exist
 * because four points across three decades cannot show WHERE a capacity limit
 * falls -- the interesting behaviour is entirely inside the 1M-10M gap, which
 * the registered grid crosses in a single step.
 */
export const FIGURE_TIERS: bigint[] = [
  10_000n, 25_000n, 50_000n, 100_000n, 250_000n, 500_000n, 750_000n,
  1_000_000n, 1_500_000n, 2_000_000n, 3_000_000n, 4_000_000n, 5_000_000n,
  6_500_000n, 8_000_000n, 10_000_000n,
].map((t) => t * 1_000_000n);

function seriesOf(
  evaluation: RegisteredEvaluationResult,
  pick: (r: PolicyRunResult) => number | undefined,
): ChartSeries[] {
  const out: ChartSeries[] = [];
  for (const id of PLOTTED) {
    const points = evaluation.results
      .filter((r) => r.policy.id === id)
      .map((r) => ({ tier: Number(r.tier), value: pick(r) }))
      .filter((p): p is { tier: number; value: number } => p.value !== undefined && Number.isFinite(p.value));
    if (points.length > 0) out.push({ policyId: id, points });
  }
  return out;
}

/**
 * A warning for an era in which a venue was in a FAILED STATE — zero
 * withdrawable cash — for a material share of the run.
 *
 * Detected, not hard-coded to an era: a venue holding no cash while its
 * kinked rate model is in its jump region advertises an enormous APY that no
 * depositor can realize, and any policy holding it accrues that rate on a
 * position it cannot exit. Annualizing a short era containing such a window
 * magnifies it further. A yield figure drawn over that period is not a figure
 * about attainable return, and must say so on its face.
 *
 * Returns `undefined` when no venue was ever dry, which is the normal case.
 */
export function venueFailureWarning(
  originsByVenue: Readonly<Record<string, { dryOrigins: number; total: number; maxApy: number }>>,
  eraDays: number,
): string | undefined {
  const failed = Object.entries(originsByVenue)
    .filter(([, v]) => v.total > 0 && v.dryOrigins / v.total >= 0.05)
    .sort((a, b) => b[1].dryOrigins - a[1].dryOrigins);
  if (failed.length === 0) return undefined;
  const [venue, v] = failed[0]!;
  const share = ((v.dryOrigins / v.total) * 100).toFixed(0);
  return (
    `WARNING: ${venue} held ZERO withdrawable cash for ${share}% of this era ` +
    `(peak ${(v.maxApy * 100).toFixed(0)}% APY, unwithdrawable). Returns below are ` +
    `annualized from ${eraDays} days and are NOT attainable yield.`
  );
}

export interface ReportFigure {
  filename: string;
  svg: string;
  caption: string;
}

/**
 * The three figures the report's argument actually needs, in the order the
 * argument runs: what was earned, whether it could be withdrawn, and why the
 * earning fell off.
 */
export function reportFigures(
  era: string,
  evaluation: RegisteredEvaluationResult,
  s2Floor: number,
  stride = 1,
  warning?: string,
): ReportFigure[] {
  const provenance =
    stride > 1
      ? ` Computed on every ${stride}rd origin of the era over ${FIGURE_TIERS.length} vault ` +
        'sizes; §11.1\'s four registered tiers are unchanged and remain the only sizes any ' +
        'gate is scored on.'
      : '';
  const apy = seriesOf(evaluation, (r) => r.replay.realizedNetApy * 100);
  const cov = seriesOf(evaluation, (r) => r.replay.coverageDistribution.min);
  const cap = seriesOf(evaluation, (r) => r.replay.capitalAtWorkFraction as number | undefined);
  const apyMax = niceMax(Math.max(1, ...apy.flatMap((s) => s.points.map((p) => p.value))) * 1.1);

  return [
    {
      filename: `SRCLA-FIG1-apy-by-vault-size-${era}.svg`,
      svg: lineChart({
        title: `Figure 1 — Net APY by vault size (${era})`,
        yLabel: 'Realized net APY (%)',
        series: apy,
        yMax: apyMax,
        yFormat: (v) => `${v.toFixed(1)}%`,
        ...(warning === undefined ? {} : { warning }),
      }),
      caption:
        '**Figure 1 — Net APY by vault size.** Read this together with Figure 2: a ' +
        'yield curve alone cannot distinguish a policy that earns well from one that ' +
        'earns well by becoming unredeemable.' +
        (warning === undefined ? '' : ` **${warning}**`) + provenance,
    },
    {
      filename: `SRCLA-FIG2-coverage-by-vault-size-${era}.svg`,
      svg: lineChart({
        title: `Figure 2 — Stressed liquid coverage by vault size (${era})`,
        yLabel: 'Minimum stressed liquid coverage',
        series: cov,
        yMax: 1,
        yFormat: (v) => v.toFixed(2),
        floor: { value: s2Floor, label: `S2 release floor ${s2Floor}` },
      }),
      caption:
        '**Figure 2 — Stressed liquid coverage by vault size.** This is the paper\'s ' +
        'proposition in one picture. The policies that sit highest in Figure 1 at the ' +
        'largest vault size are the ones that fall to the bottom here.' + provenance,
    },
    {
      filename: `SRCLA-FIG3-capital-at-work-by-vault-size-${era}.svg`,
      svg: lineChart({
        title: `Figure 3 — Capital at work by vault size (${era})`,
        yLabel: 'Time-weighted capital at work',
        series: cap,
        yMax: 1,
        yFormat: (v) => v.toFixed(2),
      }),
      caption:
        '**Figure 3 — Capital at work by vault size.** Figure 1\'s yield decline is ' +
        'explained here rather than by worse execution: where a line falls, the vault ' +
        'is holding cash rather than earning a lower rate.' + provenance,
    },
  ];
}
