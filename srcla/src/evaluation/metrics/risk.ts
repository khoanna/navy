/**
 * Risk metrics: max drawdown, expected shortfall, withdrawal success
 */

export interface RiskMetrics {
  maxDrawdown: number;
  expectedShortfall: number;   // CVaR at 5%
  withdrawalSuccessRate: number;
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
    return { maxDrawdown: 0, expectedShortfall: 0, withdrawalSuccessRate: 1, stressedCoverage: 1 };
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

  // Withdrawal success rate
  let successful = 0;
  for (const w of withdrawals) {
    // Success if granted >= 99% of requested
    if (w.requested > 0n && w.granted >= (w.requested * 99n) / 100n) {
      successful++;
    }
  }

  return {
    maxDrawdown,
    expectedShortfall,
    withdrawalSuccessRate: withdrawals.length > 0 ? successful / withdrawals.length : 1,
    stressedCoverage: 1 - maxDrawdown,
  };
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
