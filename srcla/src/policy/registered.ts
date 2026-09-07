/**
 * Machine-readable mirror of srcla-paper.md Appendix B (v0.5).
 * Changing a value here without amending the paper is a conformance break.
 */

export const REGISTERED_HORIZONS_SECONDS = [86_400, 604_800, 1_209_600] as const;
export type HorizonSeconds = (typeof REGISTERED_HORIZONS_SECONDS)[number];

export const REGISTERED_COVERAGE_TARGETS = [0.9, 0.95, 0.99] as const;
export type CoverageTarget = (typeof REGISTERED_COVERAGE_TARGETS)[number];

export const REGISTERED_METHODS = ['rolling', 'ew-residual', 'arx'] as const;
export type ForecastMethod = (typeof REGISTERED_METHODS)[number];

/** §11.1 — exactly these four, in USDC base units (6 decimals). */
export const REGISTERED_TIERS_BASE = [
  10_000_000_000n,
  100_000_000_000n,
  1_000_000_000_000n,
  10_000_000_000_000n,
] as const;

export const ABLATION_IDS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'] as const;
export type AblationId = (typeof ABLATION_IDS)[number];

export const BASELINE_IDS = ['B0', 'B1', 'B2', 'B2u', 'B3', 'B4', 'B5'] as const;
export type BaselineId = (typeof BASELINE_IDS)[number];

export const SNAPSHOT_CADENCE_SECONDS = 900;
export const DECISION_CADENCE_SECONDS = 3600;

/**
 * Window inspected while diagnosing v0.4. It is design data: the manifest must
 * place it inside the calibration era and never inside held-out.
 */
export const BURNED_WINDOW = {
  startIso: '2026-05-26T00:00:00.000Z',
  endIso: '2026-08-23T23:59:59.999Z',
} as const;
