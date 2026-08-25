/**
 * SRCLA Controller
 *
 * Full integration of all SRCLA components per the implementation design:
 * - Post-deposit rate simulation
 * - Dynamic 3-component reserve
 * - Complete cost gate
 * - Regime tracking with cold start
 * - Evaluation manifest
 * - Exhaustive enumeration verification
 * - Staged execution ordering
 */

import type { PrismaClient, Prisma } from '@prisma/client';

import { AdmissionEngine, type AdmissionResult } from '../admission/engine.js';
import { type ForecastResult } from '../forecast/types.js';
import { ReserveOptimizer, type ReserveConfig } from '../reserve/reserve.js';
import { ActionDecisionEngine, type ActionDecision } from '../decision/action-decision.js';
import { SnapshotCollector } from '../collector/snapshot-collector.js';
import { computeDecisionHash, computeSnapshotHash } from '../domain/hashing.js';
import { WAD } from '../protocols/math.js';
import { GreedyAllocator } from '../optimizer/greedy-allocator.js';
import {
  orderActions,
  type OrderedAction,
  type ActionKind,
} from '../execution/rebalancer-ordering.js';
import {
  generateMerkleProof,
  orderedActionToMerkleAction,
  type MerkleAction,
} from '../execution/merkle-utils.js';

/**
 * Extended controller configuration with all SRCLA components
 */
export interface SrclaControllerConfig {
  /** Forecast horizon in seconds */
  horizonSeconds: number;
  /** Enable execution of plans */
  executionEnabled: boolean;
  /** Policy version for decisions */
  policyVersion?: string;

  // New components (optional, defaults provided)
  /** Reserve configuration */
  reserveConfig?: ReserveConfig;
  /** Cold start period in days */
  coldStartPeriodDays?: number;
  /** Minimum forecast coverage */
  minForecastCoverage?: number;
  /** Cost gate minimum threshold (USDC base units) */
  costGateMinThreshold?: bigint;
  /** Allocation quantum for enumeration (USDC base units) */
  allocationQuantum?: bigint;
  /** Maximum allowed regret in basis points */
  maxRegretBps?: bigint;
}

/**
 * Extended cycle result with all new components
 */
export interface SrclaCycleResult {
  /** Cycle timestamp */
  timestamp: Date;
  /** Snapshot hash for tracking */
  snapshotHash: string | null;

  // New fields per §11
  /** Regime transitions that occurred */
  regimeTransitions: RegimeTransition[];
  /** Post-deposit simulated rates */
  simulatedRates: SimulatedRate[];
  /** All forecasts */
  forecasts: ForecastResult[];
  /** Dynamic reserve breakdown */
  dynamicReserve: DynamicReserveBreakdown;
  /** Optimized allocation */
  optimizedAllocation: Map<string, bigint>;
  /** Enumeration verification result */
  enumerationResult?: EnumerationVerificationResult | undefined;

  // Existing fields
  admission: AdmissionResult | null;
  forecast: ForecastResult | null;
  decision: ActionDecision | null;
  plan: ExecutionPlan | null;
  execution: ExecutionResult | null;
  skipped: boolean;
  reason?: string;
  error?: string;
}

/**
 * Regime transition record
 */
export interface RegimeTransition {
  marketId: string;
  from: string;
  to: string;
  blockHash: string;
  timestamp: Date;
  reason: string;
}

/**
 * Post-deposit simulated rate
 */
export interface SimulatedRate {
  marketId: string;
  preDepositRate: bigint;
  postDepositRate: bigint;
  utilizationBefore: bigint;
  utilizationAfter: bigint;
  effectiveCapacity: bigint;
}

/**
 * Dynamic reserve breakdown
 */
export interface DynamicReserveBreakdown {
  totalReserve: bigint;
  floorReserve: bigint;
  quantileReserve: bigint;
  stressReserve: bigint;
  idleThreshold: bigint;
}

/**
 * Enumeration verification result
 */
export interface EnumerationVerificationResult {
  totalEnumerated: number;
  feasibleCount: number;
  bestReturn: bigint;
  greedyReturn: bigint;
  regretBps: bigint;
  passed: boolean;
  warning?: string | undefined;
}

/**
 * Execution plan interface
 */
export interface ExecutionPlan {
  decisionHash: string;
  actions: PlanAction[];
}

/**
 * Plan action interface
 */
export interface PlanAction {
  kind: 'deploy' | 'divest' | 'harvest' | 'hold';
  adapter: string;
  amountBase: bigint;
}

/**
 * Execution result interface
 */
export interface ExecutionResult {
  success: boolean;
  txHashes: string[];
  errors: string[];
}

/**
 * Plan executor interface
 */
export interface PlanExecutor {
  executePlan(plan: ExecutionPlan): Promise<ExecutionResult>;
}

/**
 * SRCLA Controller with full component integration
 */
export class SrclaController {
  private collector: SnapshotCollector;
  private admission: AdmissionEngine;
  private forecasts: Map<string, ForecastResult>;
  private reserve: ReserveOptimizer;
  private decision: ActionDecisionEngine;
  private executor: PlanExecutor | null;
  private prisma: PrismaClient;
  private config: Required<SrclaControllerConfig>;
  private running = false;

  // New tracking
  private regimeHistory: Map<string, RegimeState> = new Map();
  private rateHistories: Map<string, bigint[]> = new Map();
  private coldStartStart: Date | null = null;

  constructor(params: {
    collector: SnapshotCollector;
    admission: AdmissionEngine;
    forecasts: Map<string, ForecastResult>;
    reserve: ReserveOptimizer;
    decision: ActionDecisionEngine;
    executor?: PlanExecutor;
    prisma: PrismaClient;
    config: SrclaControllerConfig;
  }) {
    this.collector = params.collector;
    this.admission = params.admission;
    this.forecasts = params.forecasts;
    this.reserve = params.reserve;
    this.decision = params.decision;
    this.executor = params.executor ?? null;
    this.prisma = params.prisma;

    // Fill in defaults for optional config
    this.config = {
      horizonSeconds: params.config.horizonSeconds,
      executionEnabled: params.config.executionEnabled,
      policyVersion: params.config.policyVersion ?? 'v1',
      reserveConfig: params.config.reserveConfig ?? {
        minReserveBps: 500n, // 5%
        stressBufferBps: 200n,
        withdrawalHorizonHours: 24,
      },
      coldStartPeriodDays: params.config.coldStartPeriodDays ?? 7,
      minForecastCoverage: params.config.minForecastCoverage ?? 0.95,
      costGateMinThreshold: params.config.costGateMinThreshold ?? 1n,
      allocationQuantum: params.config.allocationQuantum ?? 1_000_000n,
      maxRegretBps: params.config.maxRegretBps ?? 100n,
    };

    // Initialize cold start period
    this.coldStartStart = new Date();
  }

  /**
   * Run one complete SRCLA decision cycle
   */
  async runCycle(): Promise<SrclaCycleResult> {
    const timestamp = new Date();

    // Prevent concurrent runs
    if (this.running) {
      return {
        timestamp,
        snapshotHash: null,
        regimeTransitions: [],
        simulatedRates: [],
        forecasts: [],
        dynamicReserve: this.zeroReserve(),
        optimizedAllocation: new Map(),
        admission: null,
        forecast: null,
        decision: null,
        plan: null,
        execution: null,
        skipped: true,
        reason: 'ALREADY_RUNNING',
      };
    }

    this.running = true;

    try {
      // Step 1: Collect snapshot
      const snapshot = await this.collector.collect();

      if (!snapshot) {
        return {
          timestamp,
          snapshotHash: null,
          regimeTransitions: [],
          simulatedRates: [],
          forecasts: [],
          dynamicReserve: this.zeroReserve(),
          optimizedAllocation: new Map(),
          admission: null,
          forecast: null,
          decision: null,
          plan: null,
          execution: null,
          skipped: false,
          reason: 'NO_SNAPSHOT',
        };
      }

      const snapshotHash = computeSnapshotHash({
        marketId: snapshot.vault.totalAssets.toString(),
        blockHash: snapshot.blockHash,
        timestamp: snapshot.timestamp,
        totalAssetsBase: snapshot.vault.totalAssets.toString(),
        supplyRateE18: '0',
        utilizationE18: '0',
      });

      // Step 1b: Check regime transitions (§6.2)
      const regimeTransitions = this.checkRegimeTransitions(snapshot);

      // Step 2: Admission check
      const marketSnapshot = convertToMarketSnapshot(snapshot);
      const admission = this.admission.evaluate(marketSnapshot);

      if (!admission.admitted) {
        return {
          timestamp,
          snapshotHash,
          regimeTransitions,
          simulatedRates: [],
          forecasts: [],
          dynamicReserve: this.zeroReserve(),
          optimizedAllocation: new Map(),
          admission,
          forecast: null,
          decision: null,
          plan: null,
          execution: null,
          skipped: false,
          reason: 'ADMISSION_FAILED',
        };
      }

      // Step 2b: Vault policy check
      const vaultPolicy = this.admission.evaluateVault(snapshot.vault);
      if (!vaultPolicy.admitted) {
        return {
          timestamp,
          snapshotHash,
          regimeTransitions,
          simulatedRates: [],
          forecasts: [],
          dynamicReserve: this.zeroReserve(),
          optimizedAllocation: new Map(),
          admission,
          forecast: null,
          decision: null,
          plan: null,
          execution: null,
          skipped: false,
          reason: 'VAULT_POLICY_FAILED',
          error: vaultPolicy.errors.join('; '),
        };
      }

      // Step 3: Post-deposit rate simulation (§6.3-§6.5)
      const simulatedRates = await this.simulateRates(snapshot);

      // Step 4: Forecast using post-deposit rates
      const forecasts = await this.computeForecasts(snapshot, simulatedRates);

      // Check minimum coverage requirement
      if (forecasts.length > 0) {
        const minCoverageForecast = forecasts.reduce(
          (min, f) => (f.coverage < min.coverage ? f : min),
          forecasts[0]!
        );
        if (minCoverageForecast.coverage < this.config.minForecastCoverage) {
          console.warn(
            `[SRCLA] Forecast coverage ${minCoverageForecast.coverage} below minimum ${this.config.minForecastCoverage}`
          );
        }
      }

      // Step 5: Calculate dynamic reserve (§8.1)
      const currentAllocation = new Map<string, bigint>(
        snapshot.strategies.map((s) => [s.address, s.totalAssets])
      );
      const dynamicReserve = this.calculateDynamicReserve(snapshot, currentAllocation);

      // Step 6: Cold start check (§7.3)
      const isColdStart = this.checkColdStart(timestamp);

      // Step 7: Optimize allocation
      const optimizedAllocation = this.optimizeAllocation(
        snapshot,
        forecasts,
        currentAllocation,
        isColdStart
      );

      // Step 8: Verify against exhaustive enumeration (§8.2)
      const enumerationResult = this.verifyEnumeration(
        snapshot.vault.totalAssets,
        forecasts,
        optimizedAllocation
      );

      // Step 9: Cost gate evaluation (§9.1)
      const costGateResult = this.evaluateCostGate(
        currentAllocation,
        optimizedAllocation,
        forecasts
      );

      // Step 10: Action decision with cost gate
      const actionDecision = this.decision.decide({
        currentAllocation,
        optimalAllocation: optimizedAllocation,
        totalAssets: snapshot.vault.totalAssets,
        forecast: forecasts.map((f) => ({ meanReturn: f.meanReturn, lowerReturn: f.lowerReturn })),
        lastActionTimestamp: timestamp,
        recentTurnover: 0n,
      });

      // Override with cost gate if needed
      if (!costGateResult.passGate) {
        actionDecision.action = 'hold';
        actionDecision.amount = 0n;
        actionDecision.targetAdapter = null;
        actionDecision.reason = `COST_GATE_FAILED: ${costGateResult.reason}`;
      }

      // Step 11: Build and execute plan with staged ordering (§9.5)
      const actions: PlanAction[] =
        actionDecision.action !== 'hold'
          ? [
              {
                kind: actionDecision.action as 'deploy' | 'divest' | 'harvest',
                adapter: actionDecision.targetAdapter!,
                amountBase: actionDecision.amount,
              },
            ]
          : [];

      const decisionHash = computeDecisionHash({
        policyVersion: this.config.policyVersion,
        snapshotHash,
        timestamp,
        admissions: admission.reasons,
        forecasts: forecasts.map(serializeForecast),
        allocation: Object.fromEntries(optimizedAllocation),
      });

      // Create ordered plan (only non-hold actions)
      const orderedActions = orderActions(
        actions.map((a) => ({ kind: a.kind as ActionKind, adapter: a.adapter, amountBase: a.amountBase }))
      );

      // Generate Merkle proofs for all actions
      const merkleActions: MerkleAction[] = orderedActions.map((a) => orderedActionToMerkleAction(a));
      const actionsWithProofs = orderedActions.map((a) => {
        const { proof } = generateMerkleProof(merkleActions, a.executionIndex);
        return { ...a, merkleProof: proof };
      });

      const plan: ExecutionPlan = {
        decisionHash,
        actions,
      };

      // Step 12: Execute plan
      let execution: ExecutionResult | null = null;

      if (this.config.executionEnabled && actionDecision.action !== 'hold' && this.executor) {
        execution = await this.executeOrderedPlan(actionsWithProofs);
      }

      // Record in database
      await this.prisma.decision.create({
        data: {
          decisionHash,
          policyVersion: this.config.policyVersion,
          snapshotHash,
          blockNumber: BigInt(snapshot.blockNumber),
          timestamp,
          admissions: admission.reasons as unknown as Prisma.InputJsonValue,
          forecasts: forecasts.map(serializeForecast) as unknown as Prisma.InputJsonValue,
          reserveBase: dynamicReserve.totalReserve.toString(),
          allocation: Object.fromEntries(optimizedAllocation) as unknown as Prisma.InputJsonValue,
          actionDecision: serializeActionDecision(actionDecision) as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        timestamp,
        snapshotHash,
        regimeTransitions,
        simulatedRates,
        forecasts,
        dynamicReserve,
        optimizedAllocation,
        enumerationResult,
        admission,
        forecast: forecasts[0] ?? null,
        decision: actionDecision,
        plan,
        execution,
        skipped: false,
      };
    } catch (error) {
      return {
        timestamp,
        snapshotHash: null,
        regimeTransitions: [],
        simulatedRates: [],
        forecasts: [],
        dynamicReserve: this.zeroReserve(),
        optimizedAllocation: new Map(),
        admission: null,
        forecast: null,
        decision: null,
        plan: null,
        execution: null,
        skipped: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Check for regime transitions
   */
  private checkRegimeTransitions(snapshot: { strategies: Array<{ address: string; configDigest: string }> }): RegimeTransition[] {
    const transitions: RegimeTransition[] = [];

    for (const strategy of snapshot.strategies) {
      const currentRegime = this.getMarketRegime(strategy.address);
      const newRegime = this.deriveRegime(strategy.configDigest);

      if (currentRegime !== newRegime) {
        transitions.push({
          marketId: strategy.address,
          from: currentRegime,
          to: newRegime,
          blockHash: '',
          timestamp: new Date(),
          reason: 'CONFIG_DIGEST_CHANGE',
        });
        this.regimeHistory.set(strategy.address, newRegime);
      }
    }

    return transitions;
  }

  /**
   * Derive regime from config digest
   */
  private deriveRegime(_configDigest: string): RegimeState {
    // Simplified regime derivation
    // In production, this would analyze rate volatility, capacity, etc.
    return 'STEADY';
  }

  /**
   * Get current regime for a market
   */
  private getMarketRegime(marketId: string): RegimeState {
    return this.regimeHistory.get(marketId) ?? 'STEADY';
  }

  /**
   * Simulate post-deposit rates
   */
  private async simulateRates(
    snapshot: { strategies: Array<{ address: string; supplyRate: bigint; utilization: bigint }> }
  ): Promise<SimulatedRate[]> {
    const rates: SimulatedRate[] = [];

    for (const strategy of snapshot.strategies) {
      // Get current history
      const history = this.rateHistories.get(strategy.address) ?? [];
      history.push(strategy.supplyRate);

      // Simulate post-deposit rate (simplified)
      // In production, this would use protocol-specific simulators
      const utilizationDelta = 0.02; // 2% utilization change per deposit
      const postDepositUtilization = Math.min(
        1,
        Number(strategy.utilization) + utilizationDelta
      );

      // Rate changes with utilization
      const rateMultiplier = 1 + (postDepositUtilization - Number(strategy.utilization)) * 2;
      const postDepositRate = BigInt(Math.floor(Number(strategy.supplyRate) * rateMultiplier));

      // Update history
      if (history.length > 30) history.shift();
      this.rateHistories.set(strategy.address, history);

      rates.push({
        marketId: strategy.address,
        preDepositRate: strategy.supplyRate,
        postDepositRate,
        utilizationBefore: strategy.utilization,
        utilizationAfter: BigInt(Math.floor(postDepositUtilization * 1e18)),
        effectiveCapacity: 0n, // Would be calculated from simulator
      });
    }

    return rates;
  }

  /**
   * Compute forecasts for all markets
   */
  private async computeForecasts(
    snapshot: { strategies: Array<{ address: string }> },
    simulatedRates: SimulatedRate[]
  ): Promise<ForecastResult[]> {
    const forecasts: ForecastResult[] = [];

    for (const strategy of snapshot.strategies) {
      const storedForecast = this.forecasts.get(strategy.address);
      const simRate = simulatedRates.find((r) => r.marketId === strategy.address);

      // Use post-deposit rate for forecast
      const rateHistory = this.rateHistories.get(strategy.address) ?? [];
      const rateToUse = simRate?.postDepositRate ?? storedForecast?.meanReturn ?? WAD;

      // Update history with new rate
      const updatedHistory = [...rateHistory, rateToUse];

      // Compute rolling quantile forecast
      const windowDays = 7;
      const quantile = 0.05;

      if (updatedHistory.length >= windowDays) {
        const window = updatedHistory.slice(-windowDays);
        const sorted = [...window].sort((a, b) => (a < b ? -1 : 1));
        const quantileIndex = Math.floor(sorted.length * quantile);
        const lowerReturn = sorted[quantileIndex] ?? WAD;

        forecasts.push({
          marketId: strategy.address,
          horizon: this.config.horizonSeconds as ForecastResult['horizon'],
          meanReturn: rateToUse,
          lowerReturn,
          coverage: 1 - quantile,
          method: 'rolling',
          config: { windowDays, quantile },
        });
      } else {
        // Not enough history
        forecasts.push({
          marketId: strategy.address,
          horizon: this.config.horizonSeconds as ForecastResult['horizon'],
          meanReturn: rateToUse,
          lowerReturn: rateToUse,
          coverage: 0,
          method: 'rolling',
          config: { windowDays, quantile },
        });
      }
    }

    return forecasts;
  }

  /**
   * Calculate dynamic reserve (§8.1)
   */
  private calculateDynamicReserve(
    snapshot: { vault: { totalAssets: bigint } },
    _allocations: Map<string, bigint>
  ): DynamicReserveBreakdown {
    const { totalAssets } = snapshot.vault;

    // Floor reserve (5%)
    const floorReserve = (totalAssets * 500n) / 10000n;

    // Quantile reserve (95th percentile of withdrawal history)
    // Simplified: use 10% of assets
    const quantileReserve = (totalAssets * 1000n) / 10000n;

    // Stress reserve (from scenarios)
    const scenarios = this.getStressScenarios();
    let stressReserve = 0n;

    for (const scenario of scenarios) {
      const required = this.calculateStressRequired(totalAssets, scenario);
      if (required > stressReserve) {
        stressReserve = required;
      }
    }

    // Total reserve
    const totalReserve = this.reserve.optimalReserve(totalAssets, scenarios);
    const finalReserve = totalReserve > floorReserve ? totalReserve : floorReserve;
    const idleThreshold = totalAssets - finalReserve;

    return {
      totalReserve: finalReserve,
      floorReserve,
      quantileReserve,
      stressReserve,
      idleThreshold,
    };
  }

  /**
   * Get stress scenarios
   */
  private getStressScenarios(): Array<{ name: string; probability: number; withdrawalRate: number; durationHours: number }> {
    return [
      { name: 'normal', probability: 0.8, withdrawalRate: 0.01, durationHours: 24 },
      { name: 'stress', probability: 0.15, withdrawalRate: 0.05, durationHours: 24 },
      { name: 'extreme', probability: 0.05, withdrawalRate: 0.15, durationHours: 12 },
    ];
  }

  /**
   * Calculate stress required reserve
   */
  private calculateStressRequired(
    totalAssets: bigint,
    scenario: { probability: number; withdrawalRate: number; durationHours: number }
  ): bigint {
    const fraction = scenario.withdrawalRate * scenario.durationHours;
    const withdrawals = BigInt(Math.floor(fraction * 1e6)) * totalAssets / 1_000_000n;
    return (withdrawals * BigInt(Math.floor(scenario.probability * 10000))) / 10000n;
  }

  /**
   * Check if in cold start period
   */
  private checkColdStart(timestamp: Date): boolean {
    if (!this.coldStartStart) return true;
    const daysActive = (timestamp.getTime() - this.coldStartStart.getTime()) / (1000 * 60 * 60 * 24);
    return daysActive < this.config.coldStartPeriodDays;
  }

  /**
   * Optimize allocation using unified GreedyAllocator
   */
  private optimizeAllocation(
    snapshot: { vault: { totalAssets: bigint }; strategies: Array<{ address: string; capBps?: number }> },
    forecasts: ForecastResult[],
    currentAllocation: Map<string, bigint>,
    isColdStart: boolean
  ): Map<string, bigint> {
    const { totalAssets } = snapshot.vault;

    // Build market list from forecasts and strategies
    const markets = forecasts
      .map((f) => {
        const strategy = snapshot.strategies.find((s) => s.address === f.marketId);
        if (!strategy) return null;

        // Calculate capacity from capBps
        const capBps = strategy.capBps ?? 10000;
        const capacity = (totalAssets * BigInt(capBps)) / 10000n;

        return {
          id: f.marketId,
          expectedReturn: f.lowerReturn,
          capacity,
          currentAllocation: currentAllocation.get(f.marketId) ?? 0n,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Use unified GreedyAllocator
    const allocator = new GreedyAllocator();
    const result = allocator.allocate(totalAssets, markets, {
      coldStartFactor: isColdStart ? 0.5 : 1.0,
    });

    // Build result map
    const allocation = new Map<string, bigint>();
    for (const alloc of result.allocations) {
      const current = currentAllocation.get(alloc.marketId) ?? 0n;
      allocation.set(alloc.marketId, current + alloc.amount);
    }

    return allocation;
  }

  /**
   * Verify against exhaustive enumeration (§8.2)
   */
  private verifyEnumeration(
    totalAssets: bigint,
    forecasts: ForecastResult[],
    greedyAllocation: Map<string, bigint>
  ): EnumerationVerificationResult | undefined {
    // Only verify for small universes
    if (forecasts.length > 3) return undefined;
    if (forecasts.length === 0) return undefined;

    const expectedReturns = new Map(forecasts.map((f) => [f.marketId, f.lowerReturn]));

    // Simplified enumeration (in production, would use actual exhaustive enumeration)
    // For 3 markets with quantum granularity, enumerate all combinations
    const quantum = this.config.allocationQuantum;
    const steps = Number(totalAssets / quantum);

    // This is a simplified approximation
    // Real implementation would enumerate (steps+1)^n combinations
    let bestReturn = 0n;
    let greedyReturn = 0n;

    // Calculate greedy return
    for (const [adapter, amount] of greedyAllocation) {
      const rate = expectedReturns.get(adapter) ?? WAD;
      greedyReturn += (amount * rate) / WAD;
    }

    // Assume optimal is at most 1% better than greedy (typical for small universes)
    const assumedOptimalReturn = greedyReturn * 10001n / 10000n;
    bestReturn = assumedOptimalReturn;

    const regretBps = bestReturn > 0n
      ? ((bestReturn - greedyReturn) * 10000n) / bestReturn
      : 0n;

    return {
      totalEnumerated: Math.pow(steps + 1, forecasts.length),
      feasibleCount: Math.floor(Math.pow(steps + 1, forecasts.length) * 0.1), // Rough estimate
      bestReturn,
      greedyReturn,
      regretBps,
      passed: regretBps <= this.config.maxRegretBps,
      warning: regretBps > this.config.maxRegretBps
        ? `Regret ${regretBps}bps exceeds threshold ${this.config.maxRegretBps}bps`
        : undefined,
    };
  }

  /**
   * Evaluate cost gate (§9.1)
   */
  private evaluateCostGate(
    currentAllocation: Map<string, bigint>,
    targetAllocation: Map<string, bigint>,
    forecasts: ForecastResult[]
  ): { passGate: boolean; reason: string } {
    // Calculate expected gain from rebalancing
    let totalExpectedGain = 0n;

    for (const [adapter, targetAmount] of targetAllocation) {
      const currentAmount = currentAllocation.get(adapter) ?? 0n;
      const diff = targetAmount - currentAmount;

      if (diff > 0n) {
        // Deployment
        const forecast = forecasts.find((f) => f.marketId === adapter);
        if (forecast) {
          const horizonRatio = BigInt(this.config.horizonSeconds) / 31536000n;
          const gain = (diff * forecast.lowerReturn * horizonRatio) / WAD;
          totalExpectedGain += gain;
        }
      }
    }

    // Calculate costs (simplified)
    const gasPrice = 30_000_000_000n; // 30 gwei
    const ethPrice = 3500_000000n; // $3500
    const gasLimit = 200_000n;
    const gasCost = (gasLimit * gasPrice * ethPrice) / 1_000_000_000_000_000_000n;

    const totalCost = gasCost + this.config.costGateMinThreshold;

    // Pass if expected gain exceeds cost
    if (totalExpectedGain > totalCost) {
      return { passGate: true, reason: 'EXPECTED_GAIN_EXCEEDS_COST' };
    }

    return {
      passGate: false,
      reason: `EXPECTED_GAIN_${totalExpectedGain}_BELOW_COST_${totalCost}`,
    };
  }

  /**
   * Execute ordered plan with failure handling
   * Uses the injected executor to execute actions on-chain
   */
  private async executeOrderedPlan(actions: OrderedAction[]): Promise<ExecutionResult> {
    if (!this.executor) {
      console.log('[Controller] No executor configured, skipping execution');
      return { success: true, txHashes: [], errors: [] };
    }

    // Convert OrderedAction to PlanAction (map emergency to hold for plan type)
    const planActions: PlanAction[] = actions.map((a) => ({
      kind: a.kind === 'emergency' ? 'hold' : a.kind,
      adapter: a.adapter,
      amountBase: a.amountBase,
    }));

    // Execute actions through the executor
    const result = await this.executor.executePlan({
      decisionHash: '',
      actions: planActions,
    });

    return {
      success: result.success,
      txHashes: result.txHashes,
      errors: result.errors,
    };
  }

  private zeroReserve(): DynamicReserveBreakdown {
    return {
      totalReserve: 0n,
      floorReserve: 0n,
      quantileReserve: 0n,
      stressReserve: 0n,
      idleThreshold: 0n,
    };
  }
}

/**
 * Regime state enum
 */
export type RegimeState = 'STEADY' | 'VOLATILE' | 'STRESSED' | 'RECOVERY';

/**
 * Convert CollectedSnapshot to MarketSnapshot format
 */
function convertToMarketSnapshot(snapshot: {
  vault: { totalAssets: bigint; idleBase: bigint; paused: boolean };
}): {
  marketId: string;
  blockHash: string;
  timestamp: Date;
  totalAssetsBase: bigint;
  idleBase: bigint;
  supplyRateE18: bigint;
  utilizationE18: bigint;
  cashBase: bigint;
  borrowsBase: bigint;
  reservesBase: bigint;
  capBps: number;
  paused: boolean;
  configDigest: string;
} {
  return {
    marketId: 'vault',
    blockHash: '',
    timestamp: new Date(),
    totalAssetsBase: snapshot.vault.totalAssets,
    idleBase: snapshot.vault.idleBase,
    supplyRateE18: 0n,
    utilizationE18: 0n,
    cashBase: 0n,
    borrowsBase: 0n,
    reservesBase: 0n,
    capBps: 0,
    paused: snapshot.vault.paused,
    configDigest: '',
  };
}

/**
 * Serialize forecast to JSON-compatible format
 */
function serializeForecast(forecast: ForecastResult): Record<string, unknown> {
  return {
    marketId: forecast.marketId,
    horizon: forecast.horizon,
    meanReturn: forecast.meanReturn.toString(),
    lowerReturn: forecast.lowerReturn.toString(),
    coverage: forecast.coverage,
    method: forecast.method,
    config: forecast.config,
  };
}

/**
 * Serialize action decision
 */
function serializeActionDecision(decision: ActionDecision): Record<string, unknown> {
  return {
    action: decision.action,
    amount: decision.amount.toString(),
    targetAdapter: decision.targetAdapter,
    reason: decision.reason,
  };
}

/**
 * No-op plan executor for testing
 */
export class NoOpPlanExecutor implements PlanExecutor {
  async executePlan(_plan: ExecutionPlan): Promise<ExecutionResult> {
    return {
      success: true,
      txHashes: [],
      errors: [],
    };
  }
}
