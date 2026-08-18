/**
 * Decision Cycle Integration
 *
 * End-to-end integration of the complete SRCLA decision cycle:
 * 1. Cold-start eligibility check
 * 2. Reserve calculation
 * 3. Forecast generation
 * 4. Cost gate evaluation
 * 5. Allocation optimization
 */

import { ColdStartEnforcer } from '../../regime/cold-start.js';
import { ReserveOptimizer, type ReserveConfig, type StressScenario } from '../../reserve/reserve.js';
import { CostGate } from '../../decision/cost-gate.js';
import { MovementType } from '../../decision/cost-gate-types.js';

/**
 * Input to the decision cycle
 */
export interface DecisionCycleInput {
  /** Vault state */
  vault: {
    totalAssets: bigint;
    idle: bigint;
  };
  /** Available markets */
  markets: Array<{
    marketId: string;
    cash: bigint;
    borrows: bigint;
    supplyRate: bigint;
    capacity: bigint;
  }>;
  /** Evaluation config */
  config: {
    coldStartDays: number;
    minObservations: number;
    minReserveBps: bigint;
  };
  /** Historical data for forecasting */
  historicalData: {
    observationCount: Map<string, number>;
    firstObservation: Map<string, Date>;
    withdrawalHistory: Map<string, bigint[]>;
  };
}

/**
 * Result from a decision cycle run
 */
export interface DecisionCycleResult {
  /** Proposed allocations per market */
  allocations: Map<string, bigint>;
  /** Remaining idle funds */
  idle: bigint;
  /** Calculated reserve */
  reserve: bigint;
  /** Pass/fail status for each gate */
  passed: {
    coldStart: boolean;
    costGate: boolean;
    reserve: boolean;
  };
  /** Any errors encountered */
  errors: string[];
  /** Detailed market eligibility */
  marketEligibility: Map<string, {
    eligible: boolean;
    reason: string;
    effectiveCapacity: bigint;
  }>;
}

/**
 * Cold-start eligibility result
 */
interface ColdStartResult {
  eligible: boolean;
  reason: string;
}

/**
 * Check cold-start eligibility for a market
 */
function checkColdStartEligibility(
  _marketId: string,
  obsCount: number,
  firstObs: Date,
  now: Date,
  minDays: number,
  minObservations: number
): ColdStartResult {
  // Check minimum observations
  if (obsCount < minObservations) {
    return {
      eligible: false,
      reason: `INSUFFICIENT_OBSERVATIONS: ${obsCount} < ${minObservations}`,
    };
  }

  // Check minimum days
  const daysSinceFirst = (now.getTime() - firstObs.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceFirst < minDays) {
    return {
      eligible: false,
      reason: `COLD_START_PERIOD: ${Math.floor(daysSinceFirst)} < ${minDays} days`,
    };
  }

  return { eligible: true, reason: 'ELIGIBLE' };
}

/**
 * Calculate dynamic reserve requirement
 */
function calculateDynamicReserve(
  totalAssets: bigint,
  withdrawalHistory: bigint[],
  options: { quantilePercentile: number }
): { optimal: bigint; floor: bigint; quantile: bigint; stress: bigint } {
  const reserveConfig: ReserveConfig = {
    minReserveBps: 500n, // 5% floor
    stressBufferBps: 250n,
    withdrawalHorizonHours: 24,
  };

  const optimizer = new ReserveOptimizer(reserveConfig);

  // Default stress scenarios
  const scenarios: StressScenario[] = [
    {
      name: 'normal',
      probability: 0.95,
      withdrawalRate: 0.01, // 1% per hour
      durationHours: 24,
    },
    {
      name: 'stress',
      probability: 0.05,
      withdrawalRate: 0.05, // 5% per hour
      durationHours: 24,
    },
  ];

  const floor = optimizer.minReserve(totalAssets);
  const quantile = optimizer.quantileReserve(totalAssets, withdrawalHistory, options.quantilePercentile);
  const stress = optimizer.stressReserve(totalAssets, scenarios);

  return {
    optimal: optimizer.optimalReserve(totalAssets, scenarios, withdrawalHistory, options.quantilePercentile),
    floor,
    quantile,
    stress,
  };
}

/**
 * Run a complete decision cycle
 *
 * This function integrates:
 * - Cold-start eligibility checks
 * - Reserve calculation
 * - Forecast generation (simplified)
 * - Cost gate evaluation
 * - Allocation optimization
 */
export async function runDecisionCycle(input: DecisionCycleInput): Promise<DecisionCycleResult> {
  const errors: string[] = [];
  const now = new Date();

  // Initialize cold-start enforcer
  const coldStartEnforcer = new ColdStartEnforcer({
    minObservationDays: input.config.coldStartDays,
    capacityReductionFactor: 50,
    reserveIncreaseFactor: 150,
    minCompletedOutcomes: 10,
    allowReducedDeployment: true,
  });

  // 1. Cold-start check
  const coldStartResults = new Map<string, ColdStartResult>();
  const marketEligibility = new Map<string, {
    eligible: boolean;
    reason: string;
    effectiveCapacity: bigint;
  }>();

  for (const market of input.markets) {
    const obsCount = input.historicalData.observationCount.get(market.marketId) ?? 0;
    const firstObs = input.historicalData.firstObservation.get(market.marketId) ?? now;

    const status = checkColdStartEligibility(
      market.marketId,
      obsCount,
      firstObs,
      now,
      input.config.coldStartDays,
      input.config.minObservations
    );

    coldStartResults.set(market.marketId, status);

    // Calculate effective capacity considering cold start
    const effectiveCapacity = coldStartEnforcer.getEffectiveCapacity(market.marketId, market.capacity);

    marketEligibility.set(market.marketId, {
      eligible: status.eligible,
      reason: status.reason,
      effectiveCapacity,
    });

    if (!status.eligible) {
      errors.push(`Market ${market.marketId}: ${status.reason}`);
    }
  }

  // 2. Reserve calculation
  const allWithdrawals = [...input.historicalData.withdrawalHistory.values()].flat();
  const reserve = calculateDynamicReserve(input.vault.totalAssets, allWithdrawals, {
    quantilePercentile: 0.95,
  });

  // 3. Forecast (simplified - uses current rate as estimate)
  // In production, this would use the SRCLA forecast module
  void input.markets.map((m) => ({
    marketId: m.marketId,
    currentRate: m.supplyRate,
    lowerBound: m.supplyRate * 90n / 100n, // 90% of current rate as conservative estimate
  }));

  // 4. Cost gate evaluation
  const costGate = new CostGate({
    gasPriceWei: 30_000_000_000n, // 30 gwei
    ethPriceUsdc: 3_500_000_000n, // $3500 ETH
  });

  const deployable = input.vault.totalAssets - reserve.optimal - input.vault.idle;
  const costGatePassed = deployable > 0n;

  // 5. Optimization - allocate to eligible markets by rate
  const allocations = new Map<string, bigint>();
  let remaining = deployable > 0n ? deployable : 0n;

  const sorted = [...input.markets]
    .filter((m) => coldStartResults.get(m.marketId)?.eligible ?? false)
    .sort((a, b) => (b.supplyRate > a.supplyRate ? 1 : b.supplyRate < a.supplyRate ? -1 : 0));

  for (const market of sorted) {
    if (remaining === 0n) break;

    const eligibility = marketEligibility.get(market.marketId)!;
    const effectiveCap = eligibility.effectiveCapacity;
    const amount = remaining < effectiveCap ? remaining : effectiveCap;

    // Check cost gate for this allocation
    const gainParams = {
      amount,
      currentRate: 0n, // From idle
      targetRate: market.supplyRate,
      horizonSeconds: 604800n, // 7 days
      destinationRateAfter: 0n,
    };

    const context = {
      movementId: `deploy-${market.marketId}`,
      movementType: MovementType.DEPLOY,
      sourceAdapter: null,
      targetAdapter: market.marketId,
      gainParams,
      totalAssets: input.vault.totalAssets,
      recentTurnover: 0n,
      timestamp: now,
      blockHash: '0x' + '0'.repeat(64),
      configDigest: '0x' + '0'.repeat(64),
    };

    const decision = costGate.evaluate(context);

    if (decision.passGate) {
      allocations.set(market.marketId, amount);
      remaining -= amount;
    } else {
      errors.push(`Market ${market.marketId}: COST_GATE_FAILED - ${decision.reason}`);
    }
  }

  return {
    allocations,
    idle: remaining + input.vault.idle,
    reserve: reserve.optimal,
    passed: {
      coldStart: coldStartResults.size > 0 && [...coldStartResults.values()].some((v) => v.eligible),
      costGate: costGatePassed,
      reserve: reserve.optimal > 0n,
    },
    errors,
    marketEligibility,
  };
}

/**
 * Simulate multiple decision cycles over time
 */
export async function simulateDecisionCycles(
  inputs: DecisionCycleInput[],
  onCycle?: (index: number, result: DecisionCycleResult) => void
): Promise<DecisionCycleResult[]> {
  const results: DecisionCycleResult[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const result = await runDecisionCycle(inputs[i]!);
    results.push(result);
    onCycle?.(i, result);
  }

  return results;
}
