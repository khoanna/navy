/**
 * The report's figures: what a reader must be able to see in them.
 *
 * Each test names the defect it guards against. The previous renderer shipped
 * three of them in the published figures: tick labels at all sixteen sweep
 * sizes ran into each other past $1M, a 174-character warning was drawn past
 * the right edge of the figure, and the legend printed raw policy ids.
 */
import {
  figureSeries,
  lineChart,
  niceDomain,
  reportFigures,
  venueFailureWarning,
  type ChartSeries,
  type FigureSweep,
} from '../../../src/evaluation/report/charts.js';

const SWEEP_TIERS = [
  10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 750_000, 1_000_000, 1_500_000,
  2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_500_000, 8_000_000, 10_000_000,
];
const REGISTERED = [10_000, 100_000, 1_000_000, 10_000_000];
const POLICIES = ['srcla', 'b1', 'b2', 'b2u', 'b3', 'b4'];

const series: ChartSeries[] = POLICIES.map((policyId, i) => ({
  policyId,
  points: SWEEP_TIERS.map((tier, j) => ({ tier, value: 1 + i * 0.4 + j * 0.05 })),
}));

const LONG_WARNING = venueFailureWarning({ 'moonwell-usdc': { dryOrigins: 29, total: 100, maxApy: 0.9 } }, 17)!;

function chart(extra: Partial<Parameters<typeof lineChart>[0]> = {}): string {
  return lineChart({
    title: 'Realized net APY by vault size',
    subtitle: 'Sealed era heldout-c',
    yLabel: 'Realized net APY (%)',
    series,
    yMax: 5,
    yFormat: (v) => `${v}%`,
    markerTiers: REGISTERED,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// SVG readers. Deliberately independent of the renderer's own helpers.
// ---------------------------------------------------------------------------

const attr = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

interface SvgText {
  role: string | undefined;
  x: number;
  y: number;
  size: number;
  anchor: string;
  rotated: boolean;
  text: string;
}

function texts(svg: string): SvgText[] {
  return [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((m) => ({
    role: attr(m[1]!, 'data-role'),
    x: Number(attr(m[1]!, 'x')),
    y: Number(attr(m[1]!, 'y')),
    size: Number(attr(m[1]!, 'font-size')),
    anchor: attr(m[1]!, 'text-anchor') ?? 'start',
    rotated: attr(m[1]!, 'transform') !== undefined,
    text: m[2]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  }));
}

const byRole = (svg: string, role: string): SvgText[] => texts(svg).filter((t) => t.role === role);

/** A generous width estimate: 0.6em per character is wider than any sans in use. */
const estWidth = (t: SvgText): number => t.text.length * t.size * 0.6;

function extent(t: SvgText): { left: number; right: number } {
  const w = estWidth(t);
  if (t.anchor === 'middle') return { left: t.x - w / 2, right: t.x + w / 2 };
  if (t.anchor === 'end') return { left: t.x - w, right: t.x };
  return { left: t.x, right: t.x + w };
}

const viewBox = (svg: string): { width: number; height: number } => {
  const [, , w, h] = attr(svg.match(/<svg[^>]*>/)![0], 'viewBox')!.split(' ').map(Number);
  return { width: w!, height: h! };
};

function plotArea(svg: string): { top: number; bottom: number } {
  const tag = svg.match(/<rect[^>]*data-role="plot-area"[^>]*>/);
  if (tag === null) throw new Error('plot area not found');
  const top = Number(attr(tag[0], 'y'));
  return { top, bottom: top + Number(attr(tag[0], 'height')) };
}

// ---------------------------------------------------------------------------

describe('lineChart in-figure warning', () => {
  it('uses a warning as long as the one the report emits', () => {
    expect(LONG_WARNING.length).toBe(174);
  });

  it('wraps a 174-character warning onto two lines without losing any of it', () => {
    const lines = byRole(chart({ warning: LONG_WARNING }), 'warning-line');
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.text.length).toBeLessThan(110);
    expect(lines.map((l) => l.text).join(' ')).toBe(LONG_WARNING);
  });

  it('places the warning below the title and above the plot area', () => {
    const svg = chart({ warning: LONG_WARNING });
    const [title] = byRole(svg, 'title');
    const [first, second] = byRole(svg, 'warning-line');
    expect(first!.y).toBeGreaterThan(title!.y + 10);
    expect(second!.y - first!.y).toBeGreaterThanOrEqual(first!.size);
    expect(second!.y).toBeLessThan(plotArea(svg).top);
  });

  it('keeps a short warning on one line', () => {
    const lines = byRole(chart({ warning: 'WARNING: a short caveat.' }), 'warning-line');
    expect(lines.map((l) => l.text)).toEqual(['WARNING: a short caveat.']);
  });

  it('draws no warning when none is given', () => {
    expect(byRole(chart(), 'warning-line')).toHaveLength(0);
  });
});

describe('lineChart vault-size axis', () => {
  it('labels only the decades of a sixteen-size sweep', () => {
    expect(byRole(chart(), 'x-tick-label').map((t) => t.text)).toEqual(['$10k', '$100k', '$1M', '$10M']);
  });

  it('leaves every tick label clear of the next one', () => {
    const labels = byRole(chart(), 'x-tick-label').sort((a, b) => a.x - b.x);
    for (let i = 1; i < labels.length; i++) {
      expect(extent(labels[i - 1]!).right + 8).toBeLessThanOrEqual(extent(labels[i]!).left);
    }
  });
});

describe('lineChart markers', () => {
  it('marks each series only at the registered tiers', () => {
    const markers = [...chart().matchAll(/data-role="marker"[^>]*data-policy="([^"]+)"/g)].map((m) => m[1]);
    expect(markers).toHaveLength(POLICIES.length * REGISTERED.length);
    for (const p of POLICIES) expect(markers.filter((m) => m === p)).toHaveLength(REGISTERED.length);
  });
});

describe('lineChart legend', () => {
  it('names each series by its paper label, not its policy id', () => {
    const labels = byRole(chart(), 'legend-label').map((t) => t.text.split(' ')[0]);
    expect(labels).toEqual(['SRCLA', 'B1', 'B2', 'B2u', 'B3', 'B4']);
  });

  it('describes each baseline beyond its bare label', () => {
    for (const t of byRole(chart(), 'legend-label')) expect(t.text.length).toBeGreaterThan(8);
  });

  it('keeps legend entries on a row clear of each other', () => {
    const labels = byRole(chart(), 'legend-label');
    const rows = new Map<number, SvgText[]>();
    for (const l of labels) rows.set(l.y, [...(rows.get(l.y) ?? []), l]);
    expect(rows.size).toBeGreaterThan(1);
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      // The next entry's line key sits 34px left of its label.
      for (let i = 1; i < row.length; i++) expect(extent(row[i - 1]!).right + 8).toBeLessThanOrEqual(row[i]!.x - 34);
    }
  });
});

describe('lineChart layout', () => {
  it('keeps every horizontal label inside the figure, warning and floor included', () => {
    const svg = chart({ warning: LONG_WARNING, floor: { value: 0.95, label: 'S2 release floor (0.95)' }, yMax: 1 });
    const { width, height } = viewBox(svg);
    for (const t of texts(svg).filter((x) => !x.rotated)) {
      const { left, right } = extent(t);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(width);
      expect(t.y).toBeLessThanOrEqual(height);
    }
  });

  it('labels the release floor with its value, inside the plot area', () => {
    const svg = chart({ floor: { value: 0.95, label: 'S2 release floor (0.95)' }, yMax: 1 });
    const [label] = byRole(svg, 'floor-label');
    const { top, bottom } = plotArea(svg);
    expect(label!.text).toContain('0.95');
    expect(label!.y).toBeGreaterThan(top);
    expect(label!.y).toBeLessThan(bottom);
  });

  it('draws nothing for an empty series list', () => {
    expect(chart({ series: [] })).toBe('');
  });
});

describe('niceDomain', () => {
  // Values from the published sweeps: heldout-c APY, heldout-b APY, heldout-b
  // and heldout-c capital at work, then the same with zero forced.
  it.each([
    [2.624, 3.725, false, { min: 2.5, max: 3.75 }],
    [3.078, 34.152, false, { min: 0, max: 40 }],
    [40.7, 98.0, false, { min: 20, max: 100 }],
    [80.5, 99.6, false, { min: 75, max: 100 }],
    [80.5, 99.6, true, { min: 0, max: 100 }],
    [1, 1, false, { min: 0, max: 1 }],
  ])('frames %p..%p (zero forced: %p) as %p', (min, max, zero, want) => {
    expect(niceDomain(min, max, zero)).toEqual(want);
  });
});

describe('lineChart value axis', () => {
  it('starts the ticks at yMin when the axis does not start at zero', () => {
    const labels = byRole(chart({ yMin: 2.5, yMax: 3.75 }), 'y-tick-label').map((t) => t.text);
    expect(labels).toEqual(['2.5%', '2.75%', '3%', '3.25%', '3.5%', '3.75%']);
  });
});

describe('lineChart overlap note', () => {
  const at = (policyId: string, values: number[]): ChartSeries => ({
    policyId,
    points: REGISTERED.map((tier, i) => ({ tier, value: values[i]! })),
  });

  it('names a baseline drawn entirely under the SRCLA line, above the plot area', () => {
    const svg = chart({ yMax: 1, series: [at('srcla', [1, 1, 1, 1]), at('b2', [1, 1, 1, 1]), at('b4', [1, 1, 0.5, 0])] });
    const notes = byRole(svg, 'overlap-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toContain('B2');
    expect(notes[0]!.text).not.toContain('B4');
    expect(notes[0]!.y).toBeLessThan(plotArea(svg).top);
  });

  it('adds no note when every baseline departs from SRCLA somewhere', () => {
    const svg = chart({ yMax: 1, series: [at('srcla', [1, 1, 1, 1]), at('b3', [1, 1, 0.9, 1])] });
    expect(byRole(svg, 'overlap-note')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

const sweep = (warning: string | null): FigureSweep => ({
  era: 'heldout-b',
  stride: 3,
  s2CoverageFloor: 0.95,
  warning,
  rows: [
    { policyId: 'srcla', tierUsd: 10_000, netApy: 0.0335, capitalAtWork: 0.945, minStressedLiquidCoverage: 1 },
    { policyId: 'srcla', tierUsd: 10_000_000, netApy: 0.028, capitalAtWork: 0.805, minStressedLiquidCoverage: 0.97 },
    { policyId: 'b4', tierUsd: 10_000, netApy: 0.031, capitalAtWork: 0.99, minStressedLiquidCoverage: 1 },
    { policyId: 'b4', tierUsd: 10_000_000, netApy: 0.036, capitalAtWork: 0.99, minStressedLiquidCoverage: 0 },
  ],
});

describe('figureSeries', () => {
  it('plots APY and capital at work as percentages and coverage as a fraction, per policy and tier', () => {
    const { apy, coverage, capital } = figureSeries(sweep(null));
    const tidy = (s: ChartSeries[]) =>
      s.map((x) => ({ policyId: x.policyId, points: x.points.map((p) => [p.tier, Number(p.value.toFixed(6))]) }));
    expect(tidy(apy)).toEqual([
      { policyId: 'srcla', points: [[10_000, 3.35], [10_000_000, 2.8]] },
      { policyId: 'b4', points: [[10_000, 3.1], [10_000_000, 3.6]] },
    ]);
    expect(tidy(capital)).toEqual([
      { policyId: 'srcla', points: [[10_000, 94.5], [10_000_000, 80.5]] },
      { policyId: 'b4', points: [[10_000, 99], [10_000_000, 99]] },
    ]);
    expect(tidy(coverage)).toEqual([
      { policyId: 'srcla', points: [[10_000, 1], [10_000_000, 0.97]] },
      { policyId: 'b4', points: [[10_000, 1], [10_000_000, 0]] },
    ]);
  });
});

describe('reportFigures', () => {
  it('writes the three figures under the filenames the report links to', () => {
    expect(reportFigures(sweep(null)).map((f) => f.filename)).toEqual([
      'SRCLA-FIG1-apy-by-vault-size-heldout-b.svg',
      'SRCLA-FIG2-coverage-by-vault-size-heldout-b.svg',
      'SRCLA-FIG3-capital-at-work-by-vault-size-heldout-b.svg',
    ]);
  });

  it('carries a venue-failure warning on the yield figure and its caption, where the caveat applies', () => {
    const [apy, coverage, capital] = reportFigures(sweep(LONG_WARNING));
    expect(byRole(apy!.svg, 'warning-line')).toHaveLength(2);
    expect(apy!.caption).toContain(LONG_WARNING);
    expect(byRole(coverage!.svg, 'warning-line')).toHaveLength(0);
    expect(byRole(capital!.svg, 'warning-line')).toHaveLength(0);
  });

  it('draws the sweep S2 floor on the coverage figure', () => {
    const [, coverage] = reportFigures(sweep(null));
    expect(byRole(coverage!.svg, 'floor-label')[0]!.text).toContain('0.95');
  });
});
