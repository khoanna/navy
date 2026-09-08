/**
 * Risk metrics: max drawdown, expected shortfall, withdrawal success
 */

export interface RiskMetrics {
  maxDrawdown: number;
  expectedShortfall: number;   // CVaR at 5%
  /**
   * Fraction of ATTEMPTED redemptions that filled, or `null` when none were
   * attempted.
   *
   * It used to be `withdrawals.length > 0 ? successful/length : 1`, which
   * scored an empty set a perfect 1.0 and fed a >= 0.99 release gate — so
   * the gate passed precisely because the property had never been tested.
   * `null` is not a number and cannot clear a numeric threshold; callers are
   * forced to say what an unmeasured rate means.
   */
  withdrawalSuccessRate: number | null;
  stressedCoverage: number;
}

export interface WithdrawalAttempt {
  requested: bigint;
  granted: bigint;
}

export interface AssetSnapshot {
  assets: bigint;
}

/**
 * Calculate risk metrics from asset history
 */
export function calculateRiskMetrics(
  snapshots: AssetSnapshot[],
  withdrawals: WithdrawalAttempt[],
): RiskMetrics {
  if (snapshots.length === 0) {
    return {
      maxDrawdown: 0,
      expectedShortfall: 0,
      withdrawalSuccessRate: withdrawalSuccessRate(withdrawals),
      stressedCoverage: 1,
    };
  }

  // Max drawdown
  let peak = snapshots[0]!.assets;
  let maxDrawdown = 0;

  for (const snapshot of snapshots) {
    if (snapshot.assets > peak) {
      peak = snapshot.assets;
    }
    if (peak > 0n) {
      const dd = Number(peak - snapshot.assets) / Number(peak);
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  // Expected shortfall (CVaR at 5%)
  const returns = calculateDailyReturns(snapshots);
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoffIndex = Math.max(1, Math.floor(sorted.length * 0.05));
  const tailReturns = sorted.slice(0, cutoffIndex);
  const expectedShortfall = tailReturns.length > 0
    ? tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length
    : 0;

  return {
    maxDrawdown,
    expectedShortfall,
    withdrawalSuccessRate: withdrawalSuccessRate(withdrawals),
    stressedCoverage: 1 - maxDrawdown,
  };
}

/**
 * Measured redemption fill rate. A redemption counts as filled when at least
 * 99% of the requested assets were paid out. Returns `null` — never 1 — for
 * an empty attempt set: "no redemption was ever attempted" is not evidence
 * that redemptions succeed.
 *
 * A zero-asset request is not an attempt and is ignored entirely; counting it
 * as a failure would let a malformed schedule fail a safety gate, and
 * counting it as a success would reintroduce the vacuity.
 */
export function withdrawalSuccessRate(withdrawals: WithdrawalAttempt[]): number | null {
  const attempts = withdrawals.filter((w) => w.requested > 0n);
  if (attempts.length === 0) return null;
  const successful = attempts.filter((w) => w.granted >= (w.requested * 99n) / 100n).length;
  return successful / attempts.length;
}

function calculateDailyReturns(snapshots: AssetSnapshot[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!.assets;
    const curr = snapshots[i]!.assets;
    if (prev > 0n) {
      returns.push(Number(curr - prev) / Number(prev));
    }
  }
  return returns;
}
