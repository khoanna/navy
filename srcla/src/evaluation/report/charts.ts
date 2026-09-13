/**
 * Figures for `SRCLA-REPORT.md`, emitted as standalone SVG files.
 *
 * WHY FILES AND NOT INLINE SVG. Inline `<svg>` in Markdown is stripped by
 * GitHub and by several editor previews, and a figure that silently vanishes
 * is worse than no figure. Separate `.svg` files referenced with `![](...)`
 * render everywhere and can be dropped straight into LaTeX or Word, which is
 * what a published version needs.
 *
 * WHY THE SWEEP IS THE INPUT. Every figure is drawn from a `FigureSweep` — the
 * same object written to `report/chart/SRCLA-FIGURE-SWEEP-<era>.json` — so the
 * published numbers and the pictures cannot drift apart, and a figure can be
 * redrawn from that file (`pnpm figures:render`) without replaying an era.
 *
 * STYLE. Drawn for a report printed on white. The categorical hues follow the
 * validated reference order (blue, orange, aqua, yellow, magenta), SRCLA takes
 * the first slot and the heaviest line, and the B2u diagnostic is a dashed
 * neutral grey because it is not a deployable comparator. Three of those hues
 * sit below 3:1 against white, so hue never carries identity alone: every
 * policy also has its own marker shape, and the legend names it. Markers are
 * drawn only at §11.1's registered tiers, which keeps sixteen sweep sizes
 * readable and shows at a glance which sizes any gate is scored on.
 *
 * A value axis starts above zero only when every value sits well clear of it
 * (`niceDomain`), and its first tick label says where it starts. The coverage
 * figure always starts at zero: its release floor is read against the whole
 * scale, and the two eras must be comparable at a glance.
 *
 * PURE: builds strings. The caller writes them.
 */
import { REGISTERED_TIERS, type RegisteredEvaluationResult } from '../kernel/harness.js';

const W = 900;
const OUTER = 24;
const PLOT_LEFT = 76;
const PLOT_RIGHT = W - 28;
const PLOT_HEIGHT = 320;
/** Space above the axis maximum, so a line at 100% is not drawn on the frame. */
const HEADROOM = 10;
const FONT = `'Noto Sans', 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif`;

const INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  grid: '#e7e6e1',
  axis: '#a8a79f',
  threshold: '#3d3c39',
  surface: '#ffffff',
  warningWash: '#fff6e0',
  warning: '#fab219',
} as const;

/**
 * An in-figure warning is 12.5px text inset from the left edge; about 110
 * characters is all one line holds inside the viewBox. A longer warning wraps
 * onto a second line at the word boundary nearest `WARNING_WRAP_AT`.
 */
const WARNING_ONE_LINE_MAX = 110;
const WARNING_WRAP_AT = 100;
const WARNING_FONT = 12.5;
const WARNING_LINE_HEIGHT = 18;

const LEGEND_COLUMNS = 3;
const LEGEND_ROW_HEIGHT = 22;
/** Width of a legend entry's line key, to the left of its label. */
const LEGEND_KEY = 34;

/**
 * A baseline whose line stays within this many pixels of SRCLA's at every
 * size is invisible under SRCLA's heavier line, so the figure names it.
 */
const OVERLAP_PX = 1.5;

/** An axis zooms in only when its smallest value is above this share of its largest. */
const ZOOM_RATIO = 0.4;

type Marker = 'circle' | 'square' | 'triangle' | 'triangle-down' | 'diamond' | 'ring';

/** The paper's name for each policy (§11.2), with enough description to read the figure alone. */
const POLICY: Record<string, { label: string; colour: string; width: number; marker: Marker; dash?: string }> = {
  srcla: { label: 'SRCLA (proposed)', colour: '#2a78d6', width: 3, marker: 'circle' },
  b1: { label: 'B1 · highest displayed rate', colour: '#eb6834', width: 2, marker: 'square' },
  b2: { label: 'B2 · capacity-aware, no uncertainty', colour: '#1baf7a', width: 2, marker: 'triangle' },
  b2u: { label: 'B2u · B2, no reserve (diagnostic)', colour: '#8a8883', width: 1.75, marker: 'ring', dash: '6 4' },
  b3: { label: 'B3 · B2 + movement-cost threshold', colour: '#eda100', width: 2, marker: 'diamond' },
  b4: { label: 'B4 · frozen robust allocation', colour: '#e87ba4', width: 2, marker: 'triangle-down' },
};

const styleOf = (policyId: string) =>
  POLICY[policyId] ?? { label: policyId.toUpperCase(), colour: '#52514e', width: 2, marker: 'circle' as Marker };

/** The policy's name without its description: `B2` from `B2 · capacity-aware, …`. */
const shortLabel = (policyId: string): string => styleOf(policyId).label.split(' ')[0]!;

const round12 = (v: number): number => Number(v.toPrecision(12));

/**
 * Round an axis maximum up to a value whose divisions read cleanly.
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

/** A tick step of 1, 2, 2.5 or 5 times a power of ten giving about five divisions. */
function tickStep(span: number): number {
  const raw = span / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= raw - 1e-12) return m * mag;
  }
  return 10 * mag;
}

/**
 * The value axis for data spanning `min`..`max`, with both ends on a tick.
 *
 * Starts at zero when asked to, or when the data comes anywhere near zero.
 * Otherwise it starts on the tick below the smallest value — one tick lower
 * still if that value would sit on the axis line — so a series living between
 * 2.6% and 3.7% fills the plot instead of its top fifth.
 */
export function niceDomain(min: number, max: number, includeZero: boolean): { min: number; max: number } {
  const lo = includeZero || min <= ZOOM_RATIO * max ? 0 : min;
  const span = max - lo;
  if (!(span > 0)) return { min: 0, max: niceMax(max) };
  const step = tickStep(span);
  let bottom = round12(Math.floor(lo / step + 1e-9) * step);
  if (bottom > 0 && min - bottom < step / 4) bottom = Math.max(0, round12(bottom - step));
  return { min: bottom, max: round12(Math.ceil(max / step - 1e-9) * step) };
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const f1 = (n: number): string => n.toFixed(1);

/** At most two lines: a long warning splits at the space nearest `WARNING_WRAP_AT`. */
function wrapWarning(text: string): string[] {
  if (text.length <= WARNING_ONE_LINE_MAX) return [text];
  let split = -1;
  for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1)) {
    if (split < 0 || Math.abs(i - WARNING_WRAP_AT) < Math.abs(split - WARNING_WRAP_AT)) split = i;
  }
  return split < 0 ? [text] : [text.slice(0, split), text.slice(split + 1)];
}

const usdShort = (usd: number): string => {
  if (usd >= 1e6) return `$${usd / 1e6}M`;
  if (usd >= 1e3) return `$${usd / 1e3}k`;
  return `$${usd}`;
};

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

function marker(kind: Marker, x: number, y: number, colour: string, size: number, attrs: string): string {
  const ring = `stroke="${INK.surface}" stroke-width="1.5"`;
  const s = size;
  switch (kind) {
    case 'circle':
      return `<circle ${attrs} cx="${f1(x)}" cy="${f1(y)}" r="${s}" fill="${colour}" ${ring}/>`;
    case 'square':
      return `<rect ${attrs} x="${f1(x - s * 0.85)}" y="${f1(y - s * 0.85)}" width="${f1(s * 1.7)}" height="${f1(s * 1.7)}" rx="1" fill="${colour}" ${ring}/>`;
    case 'triangle':
      return `<path ${attrs} d="M${f1(x)},${f1(y - s * 1.15)} L${f1(x + s)},${f1(y + s * 0.75)} L${f1(x - s)},${f1(y + s * 0.75)} Z" fill="${colour}" ${ring}/>`;
    case 'triangle-down':
      return `<path ${attrs} d="M${f1(x)},${f1(y + s * 1.15)} L${f1(x + s)},${f1(y - s * 0.75)} L${f1(x - s)},${f1(y - s * 0.75)} Z" fill="${colour}" ${ring}/>`;
    case 'diamond':
      return `<path ${attrs} d="M${f1(x)},${f1(y - s * 1.2)} L${f1(x + s * 1.2)},${f1(y)} L${f1(x)},${f1(y + s * 1.2)} L${f1(x - s * 1.2)},${f1(y)} Z" fill="${colour}" ${ring}/>`;
    case 'ring':
      return `<circle ${attrs} cx="${f1(x)}" cy="${f1(y)}" r="${s - 0.5}" fill="${INK.surface}" stroke="${colour}" stroke-width="2"/>`;
  }
}

export interface ChartSeries {
  policyId: string;
  /** `tier` is the vault size in whole USDC. */
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
  subtitle?: string;
  yLabel: string;
  series: ChartSeries[];
  /** Bottom of the value axis; zero when omitted. */
  yMin?: number;
  yMax: number;
  yFormat: (v: number) => string;
  floor?: { value: number; label: string };
  /**
   * A warning drawn INSIDE the figure. Captions are separated from images the
   * moment a figure is imported into LaTeX or Word, so a caveat that only
   * exists in the caption is a caveat the reader of the figure does not get.
   */
  warning?: string;
  /** Vault sizes (whole USDC) that get a marker; other points are line only. */
  markerTiers?: readonly number[];
}): string {
  const tiers = [...new Set(opts.series.flatMap((s) => s.points.map((p) => p.tier)))].sort((a, b) => a - b);
  if (tiers.length === 0) return '';
  const lo = tiers[0]!;
  const hi = tiers[tiers.length - 1]!;
  const yMin = opts.yMin ?? 0;
  const yScale = (PLOT_HEIGHT - HEADROOM) / (opts.yMax - yMin);
  /** Vault tiers span three decades, so the size axis is logarithmic. A linear
   *  axis puts 10k, 100k and 1M inside the first 10% of the width and hides
   *  exactly the range where the controller behaves well. */
  const xOf = (tier: number): number =>
    hi === lo
      ? (PLOT_LEFT + PLOT_RIGHT) / 2
      : PLOT_LEFT + ((Math.log10(tier) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (PLOT_RIGHT - PLOT_LEFT);

  const body: string[] = [];

  // Title block.
  const titleY = 34;
  body.push(`<text data-role="title" x="${OUTER}" y="${titleY}" font-size="18" font-weight="600" fill="${INK.primary}">${esc(opts.title)}</text>`);
  let cursor = titleY;
  if (opts.subtitle !== undefined) {
    cursor = titleY + 22;
    body.push(`<text data-role="subtitle" x="${OUTER}" y="${cursor}" font-size="13" fill="${INK.secondary}">${esc(opts.subtitle)}</text>`);
  }

  // Warning: a status note — tinted box, warning bar and icon; the text stays in ink.
  const warningLines = opts.warning === undefined ? [] : wrapWarning(opts.warning);
  if (warningLines.length > 0) {
    const boxTop = cursor + 14;
    const boxHeight = warningLines.length * WARNING_LINE_HEIGHT + 14;
    const iconX = OUTER + 20;
    const iconY = boxTop + boxHeight / 2;
    body.push(`<rect x="${OUTER}" y="${boxTop}" width="${W - 2 * OUTER}" height="${boxHeight}" rx="4" fill="${INK.warningWash}"/>`);
    body.push(`<rect x="${OUTER}" y="${boxTop}" width="4" height="${boxHeight}" fill="${INK.warning}"/>`);
    body.push(`<path d="M${iconX},${f1(iconY - 9)} L${iconX + 10},${f1(iconY + 8)} L${iconX - 10},${f1(iconY + 8)} Z" fill="${INK.warning}" stroke="${INK.primary}" stroke-width="1" stroke-linejoin="round"/>`);
    body.push(`<text x="${iconX}" y="${f1(iconY + 6)}" font-size="11" font-weight="700" text-anchor="middle" fill="${INK.primary}">!</text>`);
    warningLines.forEach((line, i) => {
      const y = boxTop + 7 + (i + 1) * WARNING_LINE_HEIGHT - 5;
      body.push(`<text data-role="warning-line" x="${OUTER + 40}" y="${y}" font-size="${WARNING_FONT}" fill="${INK.primary}">${esc(line)}</text>`);
    });
    cursor = boxTop + boxHeight;
  }

  // Legend: always present, three columns, in the series' own order.
  const legendTop = cursor + 26;
  const columnWidth = (W - 2 * OUTER) / LEGEND_COLUMNS;
  opts.series.forEach((s, i) => {
    const st = styleOf(s.policyId);
    const labelX = OUTER + (i % LEGEND_COLUMNS) * columnWidth + LEGEND_KEY;
    const y = legendTop + Math.floor(i / LEGEND_COLUMNS) * LEGEND_ROW_HEIGHT;
    const keyY = y - 4;
    body.push(`<line x1="${f1(labelX - LEGEND_KEY)}" y1="${keyY}" x2="${f1(labelX - 10)}" y2="${keyY}" stroke="${st.colour}" stroke-width="${st.width}" stroke-linecap="round"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
    body.push(marker(st.marker, labelX - 22, keyY, st.colour, s.policyId === 'srcla' ? 5 : 4.5, 'data-role="legend-marker"'));
    body.push(`<text data-role="legend-label" x="${f1(labelX)}" y="${y}" font-size="12"${s.policyId === 'srcla' ? ' font-weight="600"' : ''} fill="${INK.primary}">${esc(st.label)}</text>`);
  });
  cursor = legendTop + (Math.ceil(opts.series.length / LEGEND_COLUMNS) - 1) * LEGEND_ROW_HEIGHT;

  // A baseline that never leaves SRCLA's line cannot be seen, so say which.
  const srcla = opts.series.find((s) => s.policyId === 'srcla');
  const hidden =
    srcla === undefined
      ? []
      : opts.series.filter(
          (s) =>
            s !== srcla &&
            s.points.length > 0 &&
            s.points.every((p) => {
              const q = srcla.points.find((x) => x.tier === p.tier);
              return q !== undefined && Math.abs(p.value - q.value) * yScale <= OVERLAP_PX;
            }),
        );
  if (hidden.length > 0) {
    cursor += 22;
    body.push(`<text data-role="overlap-note" x="${OUTER}" y="${cursor}" font-size="12" fill="${INK.secondary}">${esc(`Hidden under the SRCLA line at every size: ${hidden.map((s) => shortLabel(s.policyId)).join(', ')}.`)}</text>`);
  }

  // Plot area.
  const plotTop = cursor + 20;
  const plotBottom = plotTop + PLOT_HEIGHT;
  const H = plotBottom + 62;
  const yOf = (v: number): number => plotBottom - (Math.max(yMin, Math.min(v, opts.yMax)) - yMin) * yScale;
  body.push(`<rect data-role="plot-area" x="${PLOT_LEFT}" y="${plotTop}" width="${PLOT_RIGHT - PLOT_LEFT}" height="${PLOT_HEIGHT}" fill="none"/>`);

  // Horizontal gridlines and value ticks.
  const step = tickStep(opts.yMax - yMin);
  for (let i = 0; yMin + i * step <= opts.yMax + step * 1e-9; i++) {
    // `i * step` carries binary noise (3 * 0.2 = 0.6000000000000001), which any
    // formatter that prints the value would put on the axis.
    const v = round12(yMin + i * step);
    const y = yOf(v);
    body.push(`<line x1="${PLOT_LEFT}" y1="${f1(y)}" x2="${PLOT_RIGHT}" y2="${f1(y)}" stroke="${i === 0 ? INK.axis : INK.grid}" stroke-width="1"/>`);
    body.push(`<text data-role="y-tick-label" x="${PLOT_LEFT - 10}" y="${f1(y + 4)}" font-size="12" text-anchor="end" fill="${INK.secondary}">${esc(opts.yFormat(v))}</text>`);
  }

  // Vault-size axis: labelled decades, a minor tick at each 2x-9x in between.
  for (let k = Math.floor(Math.log10(lo) + 1e-9); k <= Math.floor(Math.log10(hi) + 1e-9); k++) {
    const decade = 10 ** k;
    if (decade >= lo - 1e-9) {
      const x = xOf(decade);
      body.push(`<line x1="${f1(x)}" y1="${plotTop}" x2="${f1(x)}" y2="${plotBottom}" stroke="${INK.grid}" stroke-width="1"/>`);
      body.push(`<line x1="${f1(x)}" y1="${plotBottom}" x2="${f1(x)}" y2="${plotBottom + 6}" stroke="${INK.axis}" stroke-width="1"/>`);
      body.push(`<text data-role="x-tick-label" x="${f1(x)}" y="${plotBottom + 22}" font-size="12" text-anchor="middle" fill="${INK.secondary}">${esc(usdShort(decade))}</text>`);
    }
    for (let m = 2; m <= 9; m++) {
      const t = m * decade;
      if (t > lo && t < hi) {
        const x = xOf(t);
        body.push(`<line x1="${f1(x)}" y1="${plotBottom}" x2="${f1(x)}" y2="${plotBottom + 4}" stroke="${INK.axis}" stroke-width="1"/>`);
      }
    }
  }
  body.push(`<text x="${(PLOT_LEFT + PLOT_RIGHT) / 2}" y="${plotBottom + 48}" font-size="13" text-anchor="middle" fill="${INK.secondary}">Vault size (USDC, log scale)</text>`);
  const yMid = f1((plotTop + plotBottom) / 2);
  body.push(`<text x="22" y="${yMid}" font-size="13" text-anchor="middle" fill="${INK.secondary}" transform="rotate(-90 22 ${yMid})">${esc(opts.yLabel)}</text>`);

  // Threshold.
  if (opts.floor !== undefined) {
    const y = yOf(opts.floor.value);
    const labelY = y + 18 < plotBottom - 4 ? y + 17 : y - 8;
    body.push(`<line x1="${PLOT_LEFT}" y1="${f1(y)}" x2="${PLOT_RIGHT}" y2="${f1(y)}" stroke="${INK.threshold}" stroke-width="1.25" stroke-dasharray="6 4"/>`);
    body.push(`<text data-role="floor-label" x="${PLOT_LEFT + 8}" y="${f1(labelY)}" font-size="12" fill="${INK.primary}" stroke="${INK.surface}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(opts.floor.label)}</text>`);
  }

  // Series: baselines first, SRCLA last so it is never hidden under a baseline.
  const drawOrder = [...opts.series].sort((a, b) => Number(a.policyId === 'srcla') - Number(b.policyId === 'srcla'));
  const markerSet = new Set(opts.markerTiers ?? []);
  for (const s of drawOrder) {
    const st = styleOf(s.policyId);
    const pts = s.points.slice().sort((a, b) => a.tier - b.tier);
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f1(xOf(p.tier))},${f1(yOf(p.value))}`).join(' ');
    body.push(`<path data-role="series" data-policy="${esc(s.policyId)}" d="${d}" fill="none" stroke="${st.colour}" stroke-width="${st.width}" stroke-linejoin="round" stroke-linecap="round"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
  }
  for (const s of drawOrder) {
    const st = styleOf(s.policyId);
    for (const p of s.points) {
      if (!markerSet.has(p.tier)) continue;
      body.push(marker(st.marker, xOf(p.tier), yOf(p.value), st.colour, s.policyId === 'srcla' ? 5 : 4.5, `data-role="marker" data-policy="${esc(s.policyId)}"`));
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img">`,
    `<title>${esc(opts.title)}</title>`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="${INK.surface}"/>`,
    ...body,
    '</svg>',
  ].join('\n');
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

/** One policy at one vault size, as written to `SRCLA-FIGURE-SWEEP-<era>.json`. */
export interface FigureSweepRow {
  policyId: string;
  tierUsd: number;
  netApy: number;
  capitalAtWork: number | undefined;
  minStressedLiquidCoverage: number;
}

/** Everything a figure is drawn from. Persisted, so figures can be redrawn without a replay. */
export interface FigureSweep {
  era: string;
  /** Every Nth origin of the era was replayed for the figures. */
  stride: number;
  /** §11.5's S2 stressed-coverage release floor, drawn on the coverage figure. */
  s2CoverageFloor: number;
  /** The venue-failure warning for this era, or `null` when no venue was dry. */
  warning: string | null;
  rows: FigureSweepRow[];
}

/** The persisted sweep for one era, from the figure-only evaluation run. */
export function buildFigureSweep(
  era: string,
  stride: number,
  evaluation: RegisteredEvaluationResult,
  s2CoverageFloor: number,
  warning: string | undefined,
): FigureSweep {
  return {
    era,
    stride,
    s2CoverageFloor,
    warning: warning ?? null,
    rows: evaluation.results.map((r) => ({
      policyId: r.policy.id,
      tierUsd: Number(r.tier / 1_000_000n),
      netApy: r.replay.realizedNetApy,
      capitalAtWork: r.replay.capitalAtWorkFraction as number | undefined,
      minStressedLiquidCoverage: r.replay.minStressedLiquidCoverage,
    })),
  };
}

/** Per-policy series for the three figures: APY and capital at work in percent, coverage as a fraction. */
export function figureSeries(sweep: FigureSweep): { apy: ChartSeries[]; coverage: ChartSeries[]; capital: ChartSeries[] } {
  const pick = (value: (r: FigureSweepRow) => number | undefined): ChartSeries[] => {
    const out: ChartSeries[] = [];
    for (const id of PLOTTED) {
      const points = sweep.rows
        .filter((r) => r.policyId === id)
        .map((r) => ({ tier: r.tierUsd, value: value(r) }))
        .filter((p): p is { tier: number; value: number } => p.value !== undefined && Number.isFinite(p.value))
        .sort((a, b) => a.tier - b.tier);
      if (points.length > 0) out.push({ policyId: id, points });
    }
    return out;
  };
  return {
    apy: pick((r) => r.netApy * 100),
    coverage: pick((r) => r.minStressedLiquidCoverage),
    capital: pick((r) => (r.capitalAtWork === undefined ? undefined : r.capitalAtWork * 100)),
  };
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

const valuesOf = (series: ChartSeries[]): number[] => series.flatMap((s) => s.points.map((p) => p.value));

/**
 * The three figures the report's argument actually needs, in the order the
 * argument runs: what was earned, whether it could be withdrawn, and why the
 * earning fell off.
 */
export function reportFigures(sweep: FigureSweep): ReportFigure[] {
  const { era, stride, s2CoverageFloor } = sweep;
  const warning = sweep.warning ?? undefined;
  const sizes = new Set(sweep.rows.map((r) => r.tierUsd)).size;
  const markerTiers = REGISTERED_TIERS.map((t) => Number(t / 1_000_000n));
  const provenance =
    stride > 1
      ? ` Computed on every ${ordinal(stride)} origin of the era over ${sizes} vault ` +
        'sizes; §11.1\'s four registered tiers are unchanged and remain the only sizes any ' +
        'gate is scored on.'
      : '';
  const subtitle = [
    `Sealed era ${era}`,
    `${sizes} vault sizes${stride > 1 ? `, every ${ordinal(stride)} origin` : ''}`,
    `markers at the ${markerTiers.length} registered tiers`,
  ].join(' · ');
  const { apy, coverage, capital } = figureSeries(sweep);
  const apyAxis = niceDomain(Math.min(...valuesOf(apy)), Math.max(...valuesOf(apy)), false);
  const capitalAxis = niceDomain(Math.min(...valuesOf(capital)), Math.max(...valuesOf(capital)), false);

  return [
    {
      filename: `SRCLA-FIG1-apy-by-vault-size-${era}.svg`,
      svg: lineChart({
        title: 'Realized net APY by vault size',
        subtitle,
        yLabel: 'Realized net APY (%)',
        series: apy,
        yMin: apyAxis.min,
        yMax: apyAxis.max,
        yFormat: (v) => `${Number(v.toFixed(2))}%`,
        markerTiers,
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
        title: 'Stressed liquid coverage by vault size',
        subtitle,
        yLabel: 'Minimum stressed liquid coverage',
        series: coverage,
        yMax: 1,
        yFormat: (v) => v.toFixed(1),
        floor: { value: s2CoverageFloor, label: `S2 release floor (${s2CoverageFloor})` },
        markerTiers,
      }),
      caption:
        '**Figure 2 — Stressed liquid coverage by vault size.** This is the paper\'s ' +
        'proposition in one picture. The policies that sit highest in Figure 1 at the ' +
        'largest vault size are the ones that fall to the bottom here.' + provenance,
    },
    {
      filename: `SRCLA-FIG3-capital-at-work-by-vault-size-${era}.svg`,
      svg: lineChart({
        title: 'Capital at work by vault size',
        subtitle,
        yLabel: 'Time-weighted capital at work (%)',
        series: capital,
        yMin: capitalAxis.min,
        yMax: capitalAxis.max,
        yFormat: (v) => `${Math.round(v)}%`,
        markerTiers,
      }),
      caption:
        '**Figure 3 — Capital at work by vault size.** Figure 1\'s yield decline is ' +
        'explained here rather than by worse execution: where a line falls, the vault ' +
        'is holding cash rather than earning a lower rate.' + provenance,
    },
  ];
}
