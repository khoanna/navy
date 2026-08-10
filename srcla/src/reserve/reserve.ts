export interface ReserveConfig {
  minReserveBps: bigint;
  stressBufferBps: bigint;
  withdrawalHorizonHours: number;
}

export interface StressScenario {
  name: string;
  probability: number;
  withdrawalRate: number;
  durationHours: number;
}

export interface StressResult {
  scenario: string;
  passed: boolean;
  requiredReserve: bigint;
  shortfall: bigint;
  coverage: number;
}

export class ReserveOptimizer {
  private config: ReserveConfig;

  constructor(config: ReserveConfig) {
    this.config = config;
  }

  minReserve(totalAssets: bigint): bigint {
    return (totalAssets * this.config.minReserveBps) / 10000n;
  }

  optimalReserve(totalAssets: bigint, scenarios: StressScenario[]): bigint {
    const min = this.minReserve(totalAssets);

    let stressRequired = min;

    for (const scenario of scenarios) {
      const required = this.requiredReserveForScenario(totalAssets, scenario);
      if (required > stressRequired) {
        stressRequired = required;
      }
    }

    return stressRequired;
  }

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

    const weighted = totalWithdrawals * BigInt(Math.floor(scenario.probability * 10000)) / 10000n;

    return weighted;
  }

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
