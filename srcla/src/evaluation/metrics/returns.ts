/**
 * Return metrics: APY, total return, gross/net
 */

export interface ReturnMetrics {
  realizedNetApy: number;
  totalReturn: number;
  annualizedReturn: number;
  grossApy: number;
  netApyAfterCosts: number;
}

export interface SnapshotWithTimestamp {
  assets: bigint;
  timestamp: Date;
}

/**
 * Calculate return metrics from snapshots
 */
export function calculateReturnMetrics(
  snapshots: SnapshotWithTimestamp[],
  totalCosts: bigint,
  initialInvestment: bigint,
): ReturnMetrics {
  if (snapshots.length < 2 || initialInvestment === 0n) {
    return { realizedNetApy: 0, totalReturn: 0, annualizedReturn: 0, grossApy: 0, netApyAfterCosts: 0 };
  }

  const start = snapshots[0]!.assets;
  const end = snapshots[snapshots.length - 1]!.assets;

  const totalReturn = Number(end - start) / Number(initialInvestment);

  // Clamp: if net end < start (e.g., gas costs > yield), return floor of -100%
  // This avoids NaN from Math.pow on negative bases
  if (totalReturn <= -1) return { realizedNetApy: -1, totalReturn: -1, annualizedReturn: -1, grossApy: -1, netApyAfterCosts: -1 };

  // Annualize only if we have positive return
  const startTime = snapshots[0]!.timestamp.getTime();
  const endTime = snapshots[snapshots.length - 1]!.timestamp.getTime();
  const years = (endTime - startTime) / (365.25 * 24 * 60 * 60 * 1000);

  let annualizedReturn = 0;
  if (years > 0 && totalReturn > -1) {
    const base = 1 + totalReturn;
    // Guard against negative base for fractional exponent
    if (base > 0) {
      annualizedReturn = Math.pow(base, 1 / years) - 1;
    }
  }

  return {
    realizedNetApy: annualizedReturn,
    totalReturn,
    annualizedReturn,
    grossApy: annualizedReturn + Number(totalCosts) / Number(initialInvestment),
    netApyAfterCosts: annualizedReturn,
  };
}
