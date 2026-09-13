/**
 * P37 C6 — is SRCLA's 1M yield gap to B4 visible on CALIBRATION data, and
 * does a single registered ablation explain it?
 *
 * The criterion is fixed in
 * docs/superpowers/specs/2026-09-13-srcla-p37-release-gates-design.md (C6)
 * BEFORE the sweep runs. This module applies it mechanically, so the decision
 * is read off the numbers rather than judged by hand. Pure: no I/O.
 *
 * UNITS: net APY as a plain fraction (0.0321 = 3.21%); tiers in USDC base
 * units (6 dp).
 */

import { eraFor } from './eras.js';
import type { TimeOrderedSnapshot } from './dataset.js';
import type { ReplaySnapshot } from './replay/replay.js';

/** Half the registered 43 bps non-inferiority margin. */
export const C6_GAP_THRESHOLD_APY = 0.00215;
/** The tier whose non-inferiority failed on heldout-c: 1,000,000 USDC. */
export const C6_DECISION_TIER = 1_000_000_000_000n;
export const C6_MIN_GAP_CLOSED = 0.5;
export const C6_S2_FLOOR = 0.95;
export const C6_MAX_CAPITAL_AT_WORK_DRIFT = 0.01;
export const C6_TIERS: readonly bigint[] = [10_000_000_000n, 100_000_000_000n, 1_000_000_000_000n];
export const C6_POLICY_IDS = ['srcla', 'b4', 'h1', 'h7'] as const;
export const C6_ABLATION_IDS = ['h1', 'h7'] as const;
export type C6AblationId = (typeof C6_ABLATION_IDS)[number];

/** Floating-point slack at the fixed boundaries; far below any reported digit. */
const EPS = 1e-12;

export interface C6Row {
  policyId: string;
  tier: bigint;
  netApy: number;
  capitalAtWork: number;
  minStressedCoverage: number;
}

export type C6Outcome = 'NO_GAP' | 'GAP_NO_QUALIFYING_COMPONENT' | 'GAP_COMPONENT_QUALIFIES';

export interface C6AblationVerdict {
  policyId: C6AblationId;
  netApy: number;
  /** (ablation − SRCLA) / (B4 − SRCLA); 0 when B4 does not lead. */
  gapClosedFraction: number;
  minStressedCoverage: number;
  capitalAtWorkDrift: number;
  qualifies: boolean;
  /** Every clause the ablation failed; empty exactly when it qualifies. */
  reasons: string[];
}

export interface C6Decision {
  outcome: C6Outcome;
  /** B4's net APY minus SRCLA's, at the 1M tier. */
  gapApy: number;
  srclaNetApy: number;
  b4NetApy: number;
  ablations: C6AblationVerdict[];
  qualifying: C6AblationId[];
}

function rowAtDecisionTier(rows: readonly C6Row[], policyId: string): C6Row {
  const found = rows.find((r) => r.policyId === policyId && r.tier === C6_DECISION_TIER);
  if (found === undefined) {
    throw new Error(
      `C6: no ${policyId} row at the ${C6_DECISION_TIER} tier — a missing run is never a decision`,
    );
  }
  return found;
}

export function decideCalibrationGap(rows: readonly C6Row[]): C6Decision {
  const srcla = rowAtDecisionTier(rows, 'srcla');
  const b4 = rowAtDecisionTier(rows, 'b4');
  const gapApy = b4.netApy - srcla.netApy;
  const gapExists = gapApy >= C6_GAP_THRESHOLD_APY - EPS;

  const ablations: C6AblationVerdict[] = C6_ABLATION_IDS.map((policyId) => {
    const a = rowAtDecisionTier(rows, policyId);
    const gapClosedFraction = gapApy > 0 ? (a.netApy - srcla.netApy) / gapApy : 0;
    const capitalAtWorkDrift = Math.abs(a.capitalAtWork - srcla.capitalAtWork);
    const reasons: string[] = [];
    if (!gapExists) reasons.push('no calibration gap to close');
    if (gapClosedFraction < C6_MIN_GAP_CLOSED - EPS) {
      reasons.push(`closes ${(gapClosedFraction * 100).toFixed(1)}% of the gap, below 50%`);
    }
    if (a.minStressedCoverage < C6_S2_FLOOR - EPS) {
      reasons.push(`min stressed coverage ${a.minStressedCoverage.toFixed(4)} is below 0.95`);
    }
    if (capitalAtWorkDrift > C6_MAX_CAPITAL_AT_WORK_DRIFT + EPS) {
      reasons.push(`capital at work drifts ${capitalAtWorkDrift.toFixed(4)} from SRCLA, above 0.01`);
    }
    return {
      policyId,
      netApy: a.netApy,
      gapClosedFraction,
      minStressedCoverage: a.minStressedCoverage,
      capitalAtWorkDrift,
      qualifies: reasons.length === 0,
      reasons,
    };
  });

  const qualifying = ablations.filter((v) => v.qualifies).map((v) => v.policyId);
  const outcome: C6Outcome = !gapExists
    ? 'NO_GAP'
    : qualifying.length > 0
      ? 'GAP_COMPONENT_QUALIFIES'
      : 'GAP_NO_QUALIFYING_COMPONENT';
  return { outcome, gapApy, srclaNetApy: srcla.netApy, b4NetApy: b4.netApy, ablations, qualifying };
}

export type HoldingsSnapshot = Pick<ReplaySnapshot, 'totalAssets' | 'holdingsBaseByMarket'>;

/** Resolution of a weight: six decimal places, exact in bigint before the float. */
const WEIGHT_SCALE = 1_000_000n;

/** Each venue's holding as a share of the vault's total assets at one origin. */
export function venueWeightsAt(s: HoldingsSnapshot): Record<string, number> {
  if (s.totalAssets <= 0n) return {};
  const out: Record<string, number> = {};
  for (const [marketId, held] of Object.entries(s.holdingsBaseByMarket)) {
    out[marketId] = Number((held * WEIGHT_SCALE) / s.totalAssets) / Number(WEIGHT_SCALE);
  }
  return out;
}

/** Mean weight per venue over every origin; an origin without the venue counts as zero. */
export function timeAveragedVenueWeights(snapshots: readonly HoldingsSnapshot[]): Record<string, number> {
  if (snapshots.length === 0) return {};
  const sums: Record<string, number> = {};
  for (const s of snapshots) {
    for (const [marketId, w] of Object.entries(venueWeightsAt(s))) {
      sums[marketId] = (sums[marketId] ?? 0) + w;
    }
  }
  return Object.fromEntries(Object.entries(sums).map(([m, v]) => [m, v / snapshots.length]));
}

/**
 * Split an era's origins into a warm-up (its first `warmupDays`) and the
 * evaluated remainder. The calibration era is the earliest data the backfill
 * holds, so its warm-up cannot come from before it the way `loadWarmup`
 * supplies one for later eras.
 */
export function splitWarmup(
  snapshots: readonly TimeOrderedSnapshot[],
  warmupDays: number,
): { warmup: TimeOrderedSnapshot[]; evaluated: TimeOrderedSnapshot[] } {
  if (snapshots.length === 0) {
    throw new Error('C6: the calibration era holds no origins; the backfill has not been run');
  }
  const cutoffMs = snapshots[0]!.timestamp.getTime() + warmupDays * 86_400_000;
  const warmup = snapshots.filter((s) => s.timestamp.getTime() < cutoffMs);
  const evaluated = snapshots.filter((s) => s.timestamp.getTime() >= cutoffMs);
  if (evaluated.length === 0) {
    throw new Error(`C6: a ${warmupDays}-day warm-up leaves nothing left to evaluate`);
  }
  return { warmup, evaluated };
}

/** Throw unless every origin lies in the calibration era. */
export function assertCalibrationOnly(snapshots: readonly { timestamp: Date }[], purpose: string): void {
  for (const s of snapshots) {
    const tag = eraFor(Math.floor(s.timestamp.getTime() / 1000));
    if (tag !== 'calibration') {
      throw new Error(
        `C6 (${purpose}): origin ${s.timestamp.toISOString()} is in era '${tag ?? 'none'}', not calibration — refusing`,
      );
    }
  }
}
