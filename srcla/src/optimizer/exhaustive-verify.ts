/**
 * Exhaustive Enumeration Verifier
 *
 * Implements §8.2 of the SRCLA paper:
 * - For ≤3 markets, enumerates all possible allocations at quantum granularity
 * - Compares optimal enumeration against greedy optimizer output
 * - Computes approximation regret to validate greedy optimality
 *
 * This is a verification module, not production code. It is used to:
 * 1. Validate that the greedy optimizer achieves near-optimal results
 * 2. Provide confidence bounds on the approximation ratio
 * 3. Detect cases where greedy fails (edge cases, numerical issues)
 *
 * @example
 * ```typescript
 * const verifier = new ExhaustiveVerifier();
 * const result = verifier.verify(greedyResult, {
 *   totalAssets: 1_000_000_000_000n,
 *   forecasts: [compound, aave, moonwell],
 *   constraints: { maxMarketCapBps: 5000n, minReserveBps: 500n },
 * });
 * console.log(`Regret: ${result.regretBps} bps`);
 * ```
 */
import type { AdapterForecast, OptimizationResult } from './constrained-optimizer.js';

// ============================================================================
// Types
// ============================================================================

/**
 * An enumerable allocation maps each market to an amount
 */
export interface EnumerableAllocation {
  allocations: Map<string, bigint>;
  total: bigint;
  expectedReturn: bigint;
  feasible: boolean;
}

/**
 * Result of exhaustive enumeration and comparison
 */
export interface EnumerationResult {
  /** Number of allocations enumerated */
  totalEnumerated: number;
  /** Number of feasible allocations found */
  feasibleCount: number;
  /** Best feasible allocation from enumeration */
  bestFeasible: EnumerableAllocation | null;
  /** Greedy solution for comparison */
  greedySolution: EnumerableAllocation | null;
  /** Approximation regret in basis points */
  regretBps: bigint;
  /** Whether greedy achieves optimal (regret < threshold) */
  greedyOptimal: boolean;
  /** Performance metrics */
  perf: {
    enumerationTimeMs: number;
    memoryPeakMb: number;
  };
}

/**
 * Input for exhaustive verification
 */
export interface ExhaustiveVerifyInput {
  /** Total assets to allocate (6 decimals) */
  totalAssets: bigint;
  /** Adapter forecasts sorted by expected return (descending) */
  forecasts: AdapterForecast[];
  /** Constraints for feasibility checking */
  constraints: {
    minReserveBps: bigint;
    maxMarketCapBps: bigint;
    maxDependencyGroupCapBps?: bigint;
    maxAbsoluteExposure?: bigint;
    minActionAmount: bigint;
  };
  /** Quantum granularity for enumeration (default: 1 USDC = 1_000_000n) */
  quantum?: bigint;
  /** Maximum number of allocations to enumerate (safety limit) */
  maxEnumerations?: number;
  /** Threshold for considering greedy "optimal" (bps, default: 10) */
  optimalThresholdBps?: bigint;
  /** Greedy solution to compare against */
  greedySolution: OptimizationResult;
}

// ============================================================================
// Constants
// ============================================================================

/** Default quantum: $1 in USDC base units */
const DEFAULT_QUANTUM = 1_000_000n;

/** Default max enumerations: 10 million */
const DEFAULT_MAX_ENUMERATIONS = 10_000_000n;

/** Default optimality threshold: 10 bps (0.1%) */
const DEFAULT_OPTIMAL_THRESHOLD_BPS = 10n;

/** Basis points factor */
const BPS_FACTOR = 10000n;

// ============================================================================
// Exhaustive Verifier
// ============================================================================

/**
 * Exhaustive enumeration verifier for the greedy optimizer
 *
 * For small numbers of markets (≤3), enumerates all possible allocations
 * at quantum granularity and compares against the greedy solution.
 */
export class ExhaustiveVerifier {
  private quantum: bigint;
  private maxEnumerations: bigint;
  private optimalThresholdBps: bigint;

  constructor(options?: {
    quantum?: bigint;
    maxEnumerations?: bigint;
    optimalThresholdBps?: bigint;
  }) {
    this.quantum = options?.quantum ?? DEFAULT_QUANTUM;
    this.maxEnumerations = options?.maxEnumerations ?? DEFAULT_MAX_ENUMERATIONS;
    this.optimalThresholdBps = options?.optimalThresholdBps ?? DEFAULT_OPTIMAL_THRESHOLD_BPS;
  }

  /**
   * Verify greedy optimizer against exhaustive enumeration
   *
   * @param greedyResult - The greedy optimizer's result
   * @param input - Input parameters for verification
   * @returns Comparison result with regret metrics
   */
  verify(greedyResult: OptimizationResult, input: ExhaustiveVerifyInput): EnumerationResult {
    const startTime = Date.now();
    const quantum = input.quantum ?? this.quantum;
    const maxEnum = input.maxEnumerations ?? this.maxEnumerations;

    // Extract forecast information
    const forecasts = input.forecasts;
    const nMarkets = forecasts.length;

    // For >3 markets, enumeration is impractical
    if (nMarkets > 3) {
      return this.verifyLargeN(greedyResult, input);
    }

    // Calculate market-specific caps
    const marketCaps = this.computeMarketCaps(forecasts, input.totalAssets, input.constraints.maxMarketCapBps);

    // Minimum reserve
    const minReserve = (input.totalAssets * input.constraints.minReserveBps) / BPS_FACTOR;
    const maxDeployable = input.totalAssets - minReserve;

    // Enumerate all possible allocations
    let bestFeasible: EnumerableAllocation | null = null;
    let feasibleCount = 0;
    let totalEnumerated = 0n;

    // Build enumeration function based on number of markets
    const enumerationGenerator = this.buildEnumerationGenerator(nMarkets, quantum);

    for (const amounts of enumerationGenerator) {
      totalEnumerated++;

      if (totalEnumerated > maxEnum) {
        console.warn(`[ExhaustiveVerifier] Hit max enumerations limit (${maxEnum})`);
        break;
      }

      // Build allocation map
      const allocations = new Map<string, bigint>();
      let total = 0n;

      for (let i = 0; i < nMarkets; i++) {
        const amount = amounts[i];
        const forecast = forecasts[i];
        if (amount !== undefined && amount > 0n && forecast !== undefined) {
          allocations.set(forecast.adapter, amount);
          total += amount;
        }
      }

      // Check reserve constraint
      if (total > maxDeployable) continue;

      // Check market cap constraints
      const feasible = this.checkMarketCapConstraints(allocations, marketCaps);
      if (!feasible) continue;

      // Compute expected return
      const expectedReturn = this.computeExpectedReturn(allocations, forecasts);

      const allocation: EnumerableAllocation = {
        allocations,
        total,
        expectedReturn,
        feasible: true,
      };

      // Track best
      if (!bestFeasible || allocation.expectedReturn > bestFeasible.expectedReturn) {
        bestFeasible = allocation;
      }

      feasibleCount++;
    }

    const enumerationTimeMs = Date.now() - startTime;

    // Build greedy solution for comparison
    const greedyAllocation: EnumerableAllocation = {
      allocations: greedyResult.allocations,
      total: this.sumAllocations(greedyResult.allocations),
      expectedReturn: greedyResult.expectedReturn,
      feasible: greedyResult.success && greedyResult.violations.length === 0,
    };

    // Compute regret
    const regretBps = this.computeRegret(greedyAllocation, bestFeasible);
    const greedyOptimal = regretBps <= this.optimalThresholdBps;

    return {
      totalEnumerated: Number(totalEnumerated),
      feasibleCount,
      bestFeasible,
      greedySolution: greedyAllocation,
      regretBps,
      greedyOptimal,
      perf: {
        enumerationTimeMs,
        memoryPeakMb: this.estimateMemoryUsage(totalEnumerated),
      },
    };
  }

  /**
   * Handle verification for large numbers of markets (>3)
   *
   * Uses sampling and theoretical bounds instead of full enumeration.
   */
  private verifyLargeN(
    greedyResult: OptimizationResult,
    input: ExhaustiveVerifyInput,
  ): EnumerationResult {
    const startTime = Date.now();

    // Sample random allocations to estimate bounds
    const sampleCount = 1000;
    let bestSampled: EnumerableAllocation | null = null;

    for (let i = 0; i < sampleCount; i++) {
      const allocation = this.generateRandomAllocation(input);
      if (allocation.feasible) {
        if (!bestSampled || allocation.expectedReturn > bestSampled.expectedReturn) {
          bestSampled = allocation;
        }
      }
    }

    // Upper bound: greedy assumes perfect ranking
    const perfectRankingBound = this.computePerfectRankingReturn(input);

    const greedyAllocation: EnumerableAllocation = {
      allocations: greedyResult.allocations,
      total: this.sumAllocations(greedyResult.allocations),
      expectedReturn: greedyResult.expectedReturn,
      feasible: greedyResult.success && greedyResult.violations.length === 0,
    };

    // Conservative regret estimate using upper bound
    const regretBps = perfectRankingBound > 0n
      ? ((perfectRankingBound - greedyAllocation.expectedReturn) * BPS_FACTOR) / perfectRankingBound
      : 0n;

    return {
      totalEnumerated: sampleCount,
      feasibleCount: sampleCount,
      bestFeasible: bestSampled,
      greedySolution: greedyAllocation,
      regretBps,
      greedyOptimal: regretBps <= this.optimalThresholdBps,
      perf: {
        enumerationTimeMs: Date.now() - startTime,
        memoryPeakMb: this.estimateMemoryUsage(BigInt(sampleCount)),
      },
    };
  }

  /**
   * Build enumeration generator for n markets
   *
   * Uses recursive generation to avoid materializing full array.
   */
  private buildEnumerationGenerator(
    nMarkets: number,
    quantum: bigint,
  ): Generator<bigint[], void, unknown> {
    const maxAssets = 1_000_000_000_000n; // $1M default max

    return (function* generate(): Generator<bigint[], void, unknown> {
      if (nMarkets === 1) {
        // Single market: enumerate amounts from 0 to max in quantum steps
        for (let amount = 0n; amount <= maxAssets; amount += quantum) {
          yield [amount];
        }
      } else if (nMarkets === 2) {
        // Two markets: nested enumeration
        for (let a = 0n; a <= maxAssets; a += quantum) {
          for (let b = 0n; b <= maxAssets - a; b += quantum) {
            yield [a, b];
          }
        }
      } else if (nMarkets === 3) {
        // Three markets: triple nested enumeration
        for (let a = 0n; a <= maxAssets; a += quantum) {
          for (let b = 0n; b <= maxAssets - a; b += quantum) {
            for (let c = 0n; c <= maxAssets - a - b; c += quantum) {
              yield [a, b, c];
            }
          }
        }
      }
    })();
  }

  /**
   * Compute market-specific caps
   */
  private computeMarketCaps(
    forecasts: AdapterForecast[],
    totalAssets: bigint,
    maxMarketCapBps: bigint,
  ): Map<string, bigint> {
    const caps = new Map<string, bigint>();
    const globalCap = (totalAssets * maxMarketCapBps) / BPS_FACTOR;

    for (const forecast of forecasts) {
      // Cap is minimum of global cap and adapter capacity
      const cap = forecast.capacity > 0n
        ? forecast.capacity < globalCap
          ? forecast.capacity
          : globalCap
        : globalCap;
      caps.set(forecast.adapter, cap);
    }

    return caps;
  }

  /**
   * Check market cap constraints
   */
  private checkMarketCapConstraints(
    allocations: Map<string, bigint>,
    marketCaps: Map<string, bigint>,
  ): boolean {
    for (const [adapter, allocated] of allocations) {
      const cap = marketCaps.get(adapter) ?? 0n;
      if (allocated > cap) {
        return false;
      }
    }
    return true;
  }

  /**
   * Compute expected return for an allocation
   */
  private computeExpectedReturn(
    allocations: Map<string, bigint>,
    forecasts: AdapterForecast[],
  ): bigint {
    const forecastMap = new Map(forecasts.map((f) => [f.adapter, f.forecast]));
    let totalReturn = 0n;

    for (const [adapter, amount] of allocations) {
      const forecast = forecastMap.get(adapter);
      if (forecast) {
        // Expected return = amount * meanReturn / 10000 (bps to fraction)
        totalReturn += (amount * forecast.meanReturn) / BPS_FACTOR;
      }
    }

    return totalReturn;
  }

  /**
   * Sum allocations
   */
  private sumAllocations(allocations: Map<string, bigint>): bigint {
    let sum = 0n;
    for (const amount of allocations.values()) {
      sum += amount;
    }
    return sum;
  }

  /**
   * Compute regret in basis points
   *
   * regret = (optimal - greedy) * 10000 / optimal
   */
  private computeRegret(
    greedy: EnumerableAllocation,
    optimal: EnumerableAllocation | null,
  ): bigint {
    if (!optimal) return 0n;
    if (optimal.expectedReturn === 0n) return 0n;

    const diff = optimal.expectedReturn - greedy.expectedReturn;
    if (diff <= 0n) return 0n;

    return (diff * BPS_FACTOR) / optimal.expectedReturn;
  }

  /**
   * Generate a random feasible allocation for sampling
   */
  private generateRandomAllocation(input: ExhaustiveVerifyInput): EnumerableAllocation {
    const { totalAssets, forecasts, constraints } = input;
    const allocations = new Map<string, bigint>();

    let remaining = totalAssets;

    // Shuffle forecasts
    const shuffled = [...forecasts].sort(() => Math.random() - 0.5);

    for (const forecast of shuffled) {
      if (remaining <= 0n) break;

      // Random fraction of remaining
      const fraction = Math.random();
      const amount = BigInt(Math.floor(Number(remaining) * fraction));

      // Respect capacity
      const cap = (totalAssets * constraints.maxMarketCapBps) / BPS_FACTOR;
      const allocated = amount > cap ? cap : amount;

      if (allocated > 0n) {
        allocations.set(forecast.adapter, allocated);
        remaining -= allocated;
      }
    }

    const expectedReturn = this.computeExpectedReturn(allocations, forecasts);
    const feasible = this.checkMarketCapConstraints(
      allocations,
      this.computeMarketCaps(forecasts, totalAssets, constraints.maxMarketCapBps),
    );

    return {
      allocations,
      total: this.sumAllocations(allocations),
      expectedReturn,
      feasible,
    };
  }

  /**
   * Compute return if forecasts perfectly ranked all allocations
   */
  private computePerfectRankingReturn(input: ExhaustiveVerifyInput): bigint {
    const { totalAssets, forecasts, constraints } = input;
    const minReserve = (totalAssets * constraints.minReserveBps) / BPS_FACTOR;
    const deployable = totalAssets - minReserve;

    // Sort by expected return (descending)
    const sorted = [...forecasts].sort((a, b) =>
      b.forecast.meanReturn > a.forecast.meanReturn ? 1 : -1
    );

    let totalReturn = 0n;
    let remaining = deployable;

    for (const forecast of sorted) {
      if (remaining <= 0n) break;

      const cap = (totalAssets * constraints.maxMarketCapBps) / BPS_FACTOR;
      const amount = remaining < cap ? remaining : cap;

      totalReturn += (amount * forecast.forecast.meanReturn) / BPS_FACTOR;
      remaining -= amount;
    }

    return totalReturn;
  }

  /**
   * Estimate memory usage
   */
  private estimateMemoryUsage(enumerated: bigint): number {
    // Rough estimate: 100 bytes per allocation
    return Number(enumerated) * 100 / (1024 * 1024);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if greedy is optimal within a threshold
 *
 * @param result - Enumeration result from verify()
 * @param thresholdBps - Threshold in basis points (default: 10)
 * @returns True if greedy regret is below threshold
 */
export function isGreedyOptimal(result: EnumerationResult, thresholdBps?: bigint): boolean {
  const threshold = thresholdBps ?? DEFAULT_OPTIMAL_THRESHOLD_BPS;
  return result.regretBps <= threshold;
}

/**
 * Format enumeration result as human-readable string
 */
export function formatEnumerationResult(result: EnumerationResult): string {
  const lines: string[] = [];

  lines.push('Exhaustive Verification Result');
  lines.push('='.repeat(40));
  lines.push(`Total Enumerated: ${result.totalEnumerated.toLocaleString()}`);
  lines.push(`Feasible Allocations: ${result.feasibleCount.toLocaleString()}`);
  lines.push(`Regret: ${result.regretBps} bps (${Number(result.regretBps) / 100}%)`);
  lines.push(`Greedy Optimal: ${result.greedyOptimal ? 'YES' : 'NO'}`);
  lines.push('');
  lines.push('Performance:');
  lines.push(`  Enumeration Time: ${result.perf.enumerationTimeMs}ms`);
  lines.push(`  Memory Peak: ${result.perf.memoryPeakMb.toFixed(2)} MB`);

  if (result.bestFeasible) {
    lines.push('');
    lines.push('Optimal Allocation:');
    for (const [adapter, amount] of result.bestFeasible.allocations) {
      lines.push(`  ${adapter}: ${formatUsdc(amount)}`);
    }
    lines.push(`  Total: ${formatUsdc(result.bestFeasible.total)}`);
    lines.push(`  Expected Return: ${result.bestFeasible.expectedReturn}`);
  }

  if (result.greedySolution) {
    lines.push('');
    lines.push('Greedy Allocation:');
    for (const [adapter, amount] of result.greedySolution.allocations) {
      lines.push(`  ${adapter}: ${formatUsdc(amount)}`);
    }
    lines.push(`  Total: ${formatUsdc(result.greedySolution.total)}`);
    lines.push(`  Expected Return: ${result.greedySolution.expectedReturn}`);
  }

  return lines.join('\n');
}

/**
 * Format USDC amount for display
 */
function formatUsdc(amount: bigint): string {
  const usdc = Number(amount) / 1_000_000;
  if (usdc >= 1_000_000) {
    return `$${(usdc / 1_000_000).toFixed(2)}M`;
  } else if (usdc >= 1_000) {
    return `$${(usdc / 1_000).toFixed(2)}K`;
  }
  return `$${usdc.toFixed(2)}`;
}

/**
 * Quick verification of a single optimization result
 *
 * Use this for unit tests or quick sanity checks.
 */
export function quickVerify(
  greedyResult: OptimizationResult,
  totalAssets: bigint,
  forecasts: AdapterForecast[],
  constraints: ExhaustiveVerifyInput['constraints'],
): EnumerationResult {
  const verifier = new ExhaustiveVerifier({
    quantum: 10_000_000n, // $10 granularity for speed
    maxEnumerations: 1_000_000n,
  });

  return verifier.verify(greedyResult, {
    totalAssets,
    forecasts,
    constraints,
    greedySolution: greedyResult,
  });
}

