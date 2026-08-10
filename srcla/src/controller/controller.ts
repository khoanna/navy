import type { PrismaClient, Prisma } from '@prisma/client';

import { AdmissionEngine, type AdmissionResult } from '../admission/engine.js';
import { type ForecastResult } from '../forecast/types.js';
import { ReserveOptimizer } from '../reserve/reserve.js';
import { ActionDecisionEngine, type ActionDecision } from '../decision/action-decision.js';
import { SnapshotCollector } from '../collector/snapshot-collector.js';
import { computeDecisionHash, computeSnapshotHash } from '../domain/hashing.js';
import { WAD } from '../protocols/math.js';

export interface ControllerConfig {
  horizonSeconds: number;
  executionEnabled: boolean;
  policyVersion?: string;
}

export interface CycleResult {
  timestamp: Date;
  snapshotHash: string | null;
  admission: AdmissionResult | null;
  forecast: ForecastResult | null;
  decision: ActionDecision | null;
  plan: ExecutionPlan | null;
  execution: ExecutionResult | null;
  skipped: boolean;
  reason?: string;
  error?: string;
}

export interface ExecutionPlan {
  decisionHash: string;
  actions: PlanAction[];
}

export interface PlanAction {
  kind: 'deploy' | 'divest' | 'harvest' | 'hold';
  adapter: string;
  amountBase: bigint;
}

export interface ExecutionResult {
  success: boolean;
  txHashes: string[];
  errors: string[];
}

/**
 * Hourly orchestration controller
 * Runs: collect -> admit -> forecast -> reserve -> decide -> plan -> execute
 */
export class Controller {
  private collector: SnapshotCollector;
  private admission: AdmissionEngine;
  private forecast: ForecastResult[];
  private reserve: ReserveOptimizer;
  private decision: ActionDecisionEngine;
  private executor: PlanExecutor;
  private prisma: PrismaClient;
  private config: ControllerConfig;
  private running = false;

  constructor(params: {
    collector: SnapshotCollector;
    admission: AdmissionEngine;
    forecast: ForecastResult[];
    reserve: ReserveOptimizer;
    decision: ActionDecisionEngine;
    executor: PlanExecutor;
    prisma: PrismaClient;
    config: ControllerConfig;
  }) {
    this.collector = params.collector;
    this.admission = params.admission;
    this.forecast = params.forecast;
    this.reserve = params.reserve;
    this.decision = params.decision;
    this.executor = params.executor;
    this.prisma = params.prisma;
    this.config = params.config;
  }

  /**
   * Run one decision cycle
   */
  async runCycle(): Promise<CycleResult> {
    const timestamp = new Date();

    // Prevent concurrent runs
    if (this.running) {
      return {
        timestamp,
        snapshotHash: null,
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
          admission: null,
          forecast: null,
          decision: null,
          plan: null,
          execution: null,
          skipped: false,
          reason: 'NO_SNAPSHOT',
        };
      }

      // Compute snapshot hash for tracking
      const snapshotHash = computeSnapshotHash({
        marketId: snapshot.vault.totalAssets.toString(),
        blockHash: snapshot.blockHash,
        timestamp: snapshot.timestamp,
        totalAssetsBase: snapshot.vault.totalAssets.toString(),
        supplyRateE18: '0',
        utilizationE18: '0',
      });

      // Step 2: Admission check - convert CollectedSnapshot to MarketSnapshot format
      const marketSnapshot = convertToMarketSnapshot(snapshot);
      const admission = this.admission.evaluate(marketSnapshot);

      if (!admission.admitted) {
        return {
          timestamp,
          snapshotHash,
          admission,
          forecast: null,
          decision: null,
          plan: null,
          execution: null,
          skipped: false,
          reason: 'ADMISSION_FAILED',
        };
      }

      // Step 3: Forecast for each strategy
      const forecasts: ForecastResult[] = [];
      for (const strategy of snapshot.strategies) {
        const strategyForecast = this.forecast.find((f) => f.marketId === strategy.address);
        if (strategyForecast) {
          forecasts.push(strategyForecast);
        } else {
          // Create a placeholder forecast if none exists
          forecasts.push({
            marketId: strategy.address,
            horizon: 86400 as const,
            meanReturn: WAD, // 1.0 = 100% return
            lowerReturn: WAD,
            coverage: 0.95,
            method: 'placeholder',
            config: {},
          });
        }
      }

      // If no forecasts, create a default one
      if (forecasts.length === 0) {
        forecasts.push({
          marketId: 'default',
          horizon: 86400 as const,
          meanReturn: WAD,
          lowerReturn: WAD,
          coverage: 0.95,
          method: 'default',
          config: {},
        });
      }

      // Step 4: Reserve calculation
      const optimalReserve = this.reserve.optimalReserve(snapshot.vault.totalAssets, []);

      // Step 5: Action decision
      const currentAllocation = new Map<string, bigint>(
        snapshot.strategies.map((s) => [s.address, s.totalAssets])
      );

      const actionDecision = this.decision.decide({
        currentAllocation,
        optimalAllocation: new Map(), // From optimizer (placeholder)
        totalAssets: snapshot.vault.totalAssets,
        forecast: forecasts.map((f) => ({ meanReturn: f.meanReturn, lowerReturn: f.lowerReturn })),
        lastActionTimestamp: timestamp,
        recentTurnover: 0n,
      });

      // Step 6: Build plan
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
        policyVersion: this.config.policyVersion ?? 'v1',
        snapshotHash,
        timestamp,
        admissions: admission.reasons,
        forecasts: forecasts.map(serializeForecast),
        allocation: {},
      });

      const plan: ExecutionPlan = {
        decisionHash,
        actions,
      };

      // Step 7: Execute (if enabled)
      let execution: ExecutionResult | null = null;

      if (this.config.executionEnabled && actionDecision.action !== 'hold') {
        execution = await this.executor.executePlan(plan);
      }

      // Store decision record in Prisma
      await this.prisma.decision.create({
        data: {
          decisionHash,
          policyVersion: this.config.policyVersion ?? 'v1',
          snapshotHash,
          blockNumber: BigInt(snapshot.blockNumber),
          timestamp,
          admissions: admission.reasons as unknown as Prisma.InputJsonValue,
          forecasts: forecasts.map(serializeForecast) as unknown as Prisma.InputJsonValue,
          reserveBase: optimalReserve.toString(),
          allocation: {} as unknown as Prisma.InputJsonValue,
          actionDecision: serializeActionDecision(actionDecision) as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        timestamp,
        snapshotHash,
        admission,
        forecast: selectBestMethodFromForecasts(forecasts),
        decision: actionDecision,
        plan,
        execution,
        skipped: false,
      };
    } catch (error) {
      return {
        timestamp,
        snapshotHash: null,
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
}

/**
 * Convert CollectedSnapshot to MarketSnapshot format for admission engine
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
 * Serialize forecast to JSON-compatible format (convert BigInt to string)
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
 * Serialize action decision to JSON-compatible format (convert BigInt to string)
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
 * Select the best forecast from a list (by coverage)
 */
function selectBestMethodFromForecasts(forecasts: ForecastResult[]): ForecastResult | null {
  if (forecasts.length === 0) return null;
  return forecasts.reduce((best, current) =>
    current.coverage > best.coverage ? current : best
  );
}

/**
 * Plan executor interface
 * Implemented in execution/executor.ts
 */
export interface PlanExecutor {
  executePlan(plan: ExecutionPlan): Promise<ExecutionResult>;
}

/**
 * Create a minimal plan executor for testing or fallback
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
