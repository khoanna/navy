#!/usr/bin/env tsx
/**
 * Redraw the report figures from the persisted figure sweeps, without
 * replaying an era.
 *
 * `pnpm phase4:run` writes `report/chart/SRCLA-FIGURE-SWEEP-<era>.json` and
 * draws the figures from that same object. This script repeats only the
 * drawing step, so a renderer change reaches the report in seconds rather than
 * after a three-hour run -- and the numbers drawn are exactly the ones the run
 * published.
 *
 * Usage (from srcla/):
 *   pnpm figures:render                 # every sweep in ../report/chart -> SVGs in ../report/figures
 *   pnpm figures:render --png           # also write 3x PNGs for Word/LaTeX (needs Chrome or Chromium)
 *   pnpm figures:render --chart-dir <dir> --figures-dir <dir> --chrome <path>
 */
import { spawnSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';

import { reportFigures, type FigureSweep } from '../src/evaluation/report/charts.js';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const PNG_SCALE = 3;

function loadSweep(path: string): FigureSweep {
  const sweep = JSON.parse(readFileSync(path, 'utf8')) as Partial<FigureSweep>;
  // A sweep without these fields predates them. Drawing it anyway would drop a
  // venue-failure warning or a release floor from the figure without a trace.
  for (const field of ['era', 'stride', 's2CoverageFloor', 'warning', 'rows'] as const) {
    if (!(field in sweep)) {
      throw new Error(`${path} has no '${field}' field; re-run pnpm phase4:run to regenerate it`);
    }
  }
  return sweep as FigureSweep;
}

function findChrome(): string {
  const candidates = [arg('chrome'), process.env.CHROME_BIN, 'google-chrome', 'chromium', 'chromium-browser'];
  for (const c of candidates) {
    if (c !== undefined && spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) return c;
  }
  throw new Error('--png needs Chrome or Chromium: pass --chrome <path> or set CHROME_BIN');
}

function rasterize(chrome: string, svgPath: string, svg: string): string {
  const [, , width, height] = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number);
  const pngPath = svgPath.replace(/\.svg$/, '.png');
  const run = spawnSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      `--force-device-scale-factor=${PNG_SCALE}`,
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      `file://${svgPath}`,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  if (run.status !== 0) throw new Error(`Chrome failed on ${svgPath}: ${run.stderr}`);
  return pngPath;
}

function main(): void {
  const chartDir = resolve(arg('chart-dir') ?? '../report/chart');
  const figuresDir = resolve(arg('figures-dir') ?? '../report/figures');
  const png = process.argv.includes('--png');
  const chrome = png ? findChrome() : undefined;

  const sweeps = readdirSync(chartDir)
    .filter((f) => /^SRCLA-FIGURE-SWEEP-.+\.json$/.test(f))
    .sort();
  if (sweeps.length === 0) throw new Error(`no SRCLA-FIGURE-SWEEP-*.json in ${chartDir}`);

  mkdirSync(figuresDir, { recursive: true });
  for (const file of sweeps) {
    const sweep = loadSweep(join(chartDir, file));
    for (const figure of reportFigures(sweep)) {
      const svgPath = join(figuresDir, figure.filename);
      writeFileSync(svgPath, figure.svg + '\n');
      const written = [basename(svgPath)];
      if (chrome !== undefined) written.push(basename(rasterize(chrome, svgPath, figure.svg)));
      console.log(`[figures] ${sweep.era}: ${written.join(', ')}`);
    }
  }
}

main();
