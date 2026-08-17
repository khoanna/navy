export interface ReserveConfig {
  /** Minimum reserve as basis points (e.g., 500 = 5%) */
  minReserveBps: bigint;
  /** Additional stress buffer in basis points */
  stressBufferBps: bigint;
  /** Withdrawal horizon in hours for stress calculations */
  withdrawalHorizonHours: number;
}

export interface StressScenario {
  name: string;
  /** Probability of scenario occurring (0-1) */
  probability: number;
  /** Withdrawal rate per hour as decimal (e.g., 0.01 = 1% per hour) */
  withdrawalRate: number;
  /** Duration of scenario in hours */
  durationHours: number;
}

export interface StressResult {
  scenario: string;
  passed: boolean;
  requiredReserve: bigint;
  shortfall: bigint;
  coverage: number;
}

/**
 * 3-Component Dynamic Reserve per SRCLA §8.1
 *
 * Components:
 * 1. Floor: minimum reserve = totalAssets * floorBps / 10000
 * 2. Quantile: 95th percentile of withdrawal history
 * 3. Stress: max(over scenarios: withdrawalRate * duration * probability * totalAssets)
 *
 * optimalReserve = max(floor, quantile, stress)
 */
export class ReserveOptimizer {
  private config: ReserveConfig;

  constructor(config: ReserveConfig) {
    this.config = config;
  }

  /**
   * Component 1: Floor Reserve
   * Minimum reserve based on floor basis points
   */
  minReserve(totalAssets: bigint): bigint {
    return (totalAssets * this.config.minReserveBps) / 10000n;
  }

  /**
   * Component 2: Quantile Reserve
   * Returns the specified percentile of withdrawal history
   * Falls back to floor if no history
   */
  quantileReserve(
    totalAssets: bigint,
    withdrawalHistory: bigint[],
    percentile: number
  ): bigint {
    if (withdrawalHistory.length === 0) {
      return this.minReserve(totalAssets);
    }

    // Sort withdrawals ascending
    const sorted = [...withdrawalHistory].sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    // Calculate index for percentile
    // Using linear interpolation between points for accuracy
    const index = (sorted.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper || upper >= sorted.length) {
      return sorted[lower] ?? this.minReserve(totalAssets);
    }

    // Linear interpolation
    const fraction = index - lower;
    const lowerValue = Number(sorted[lower]);
    const upperValue = Number(sorted[upper]);
    const interpolated = lowerValue + fraction * (upperValue - lowerValue);

    return BigInt(Math.round(interpolated));
  }

  /**
   * Component 3: Stress Reserve
   * Maximum required reserve across all stress scenarios
   */
  stressReserve(totalAssets: bigint, scenarios: StressScenario[]): bigint {
    if (scenarios.length === 0) {
      return this.minReserve(totalAssets);
    }

    let maxRequired = 0n;

    for (const scenario of scenarios) {
      const required = this.requiredReserveForScenario(totalAssets, scenario);
      if (required > maxRequired) {
        maxRequired = required;
      }
    }

    return maxRequired;
  }

  /**
   * Combined 3-Component Optimal Reserve
   * Returns max(floor, quantile, stress)
   *
   * Signature options:
   * - optimalReserve(totalAssets, scenarios) - legacy 2-arg (quantile=empty)
   * - optimalReserve(totalAssets, scenarios, withdrawalHistory) - 3-arg
   * - optimalReserve(totalAssets, scenarios, withdrawalHistory, quantilePercentile) - 4-arg
   */
  optimalReserve(
    totalAssets: bigint,
    scenarios: StressScenario[],
    withdrawalHistory?: bigint[],
    quantilePercentile: number = 0.95
  ): bigint {
    // Component 1: Floor
    const floor = this.minReserve(totalAssets);

    // Component 2: Quantile (95th percentile of withdrawal history)
    const quantile = this.quantileReserve(
      totalAssets,
      withdrawalHistory ?? [],
      quantilePercentile
    );

    // Component 3: Stress (max across scenarios)
    const stress = this.stressReserve(totalAssets, scenarios);

    // Return maximum of all 3 components
    let maxReserve = floor;
    if (quantile > maxReserve) maxReserve = quantile;
    if (stress > maxReserve) maxReserve = stress;
    return maxReserve;
  }

  /**
   * Calculate required reserve for a single stress scenario
   * Formula: totalAssets * withdrawalRate * durationHours * probability
   */
  private requiredReserveForScenario(
    totalAssets: bigint,
    scenario: StressScenario
  ): bigint {
    // withdrawalRate is per-hour as fraction (e.g., 0.01 = 1% per hour)
    // Calculate total withdrawals: rate * hours * totalAssets
    // totalAssets is in raw USDC units (6 decimals)
    // Use float to calculate total withdrawal fraction, then apply to totalAssets
    const totalFraction = scenario.withdrawalRate * scenario.durationHours;
    const totalWithdrawals = BigInt(Math.floor(totalFraction * 1e6)) * totalAssets / 1_000_000n;

    // Weight by probability
    const weighted = totalWithdrawals * BigInt(Math.floor(scenario.probability * 10000)) / 10000n;

    return weighted;
  }

  /**
   * Stress test: verify reserve coverage against multiple scenarios
   */
  stressTest(
    totalAssets: bigint,
    reserve: bigint,
    scenarios: StressScenario[]
  ): { passed: boolean; results: StressResult[] } {
    const results: StressResult[] = [];
    let allPassed = true;

    for (const scenario of scenarios) {
      // withdrawalRate is per-hour as fraction (e.g., 0.01 = 1% per hour)
      // Calculate total withdrawals: rate * hours * totalAssets
      const totalFraction = scenario.withdrawalRate * scenario.durationHours;
      const withdrawals = BigInt(Math.floor(totalFraction * 1e6)) * totalAssets / 1_000_000n;

      // Avoid division by zero
      if (withdrawals === 0n) {
        results.push({
          scenario: scenario.name,
          passed: true,
          requiredReserve: 0n,
          shortfall: 0n,
          coverage: Infinity,
        });
        continue;
      }

      const coverage = Number(reserve) / Number(withdrawals);
      const passed = coverage >= 1;

      if (!passed) allPassed = false;

      results.push({
        scenario: scenario.name,
        passed,
        requiredReserve: withdrawals,
        shortfall: passed ? 0n : withdrawals - reserve,
        coverage,
      });
    }

    return { passed: allPassed, results };
  }
}
